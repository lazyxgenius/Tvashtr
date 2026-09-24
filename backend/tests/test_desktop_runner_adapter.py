"""M-subs-desktop — the ``desktop-runner`` engine adapter (the control-plane half of the runner).

It enqueues a node job for the owner's Tvashtr Desktop, waits durably for the result, applies the
returned git patch to the run workspace (honouring the node's pull scope) and hands the walk the
same ``AgentRunResult`` an OpenHands node would. DBOS-safe: idempotent on (run, node, iteration),
a recovery re-execution never double-dispatches or double-applies. A Desktop that stops checking in
fails the node with the readable offline error.
"""

import subprocess
import threading
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.engines.base import AgentTask, DesktopJobSpec
from tvashtr.engines.desktop_runner_adapter import OFFLINE_ERROR, DesktopRunnerAdapter
from tvashtr.engines.registry import resolve_adapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.main import app
from tvashtr.models import DesktopNodeJob, Run, RunEvent


@pytest.fixture(autouse=True)
def _fast_runner(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(s, "desktop_runner_offline_seconds", 3.0)


def _account() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    resp = c.post(
        "/api/auth/register",
        json={"email": f"adapter-{uuid.uuid4().hex}@tvashtr.local", "password": "adapter-pass-1"},
    )
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _run_for(owner_id) -> str:
    run_id = str(uuid.uuid4())
    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea="adapter test",
                workflow_id=run_id,
                status="running",
                desktop_target=True,
                desktop_subscriptions=["claude"],
            )
        )
    return run_id


def _workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / ".gitignore").write_text("REPORT.md\nREVIEW_VERDICT.json\n")
    (ws / "README.md").write_text("# demo\n")
    return ws


def _patch_creating(tmp_path: Path, files: dict[str, str]) -> str:
    """A real ``git diff --binary`` patch, exactly as the Desktop runner produces it."""
    repo = tmp_path / f"patch-{uuid.uuid4().hex[:6]}"
    repo.mkdir()
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
    subprocess.run([*g, "init", "-q"], cwd=repo, check=True)
    (repo / "README.md").write_text("# demo\n")
    subprocess.run([*g, "add", "-A"], cwd=repo, check=True)
    subprocess.run([*g, "commit", "-q", "-m", "base"], cwd=repo, check=True)
    for name, content in files.items():
        (repo / name).write_text(content)
    subprocess.run([*g, "add", "-A", "-f"], cwd=repo, check=True)
    return subprocess.run(
        [*g, "diff", "--cached", "--binary", "HEAD"],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _task(ws, run_id, owner, *, node="n1", iteration=1, pull_paths=None, invocation_id=7):
    return AgentTask(
        instruction="Create hello.txt and REPORT.md",
        workspace_dir=str(ws),
        model="anthropic/claude-sonnet-5",
        pull_paths=pull_paths,
        desktop=DesktopJobSpec(
            run_id=run_id,
            node_id=node,
            iteration=iteration,
            invocation_id=invocation_id,
            owner_id=str(owner),
            provider="claude",
        ),
    )


def _run_adapter_in_thread(task):
    box: dict = {}

    def go():
        box["result"] = DesktopRunnerAdapter().run(
            task,
            on_event=make_run_event_sink(task.desktop.run_id, task.desktop.invocation_id),
        )

    t = threading.Thread(target=go, daemon=True)
    t.start()
    return t, box


def _claim(c: TestClient, provider="claude", timeout=5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = c.post("/api/desktop-runner/claim", json={"providers": [provider]}).json()["job"]
        if job:
            return job
        time.sleep(0.05)
    raise AssertionError("no job was enqueued")


def test_registry_resolves_the_desktop_runner_lazily():
    assert isinstance(resolve_adapter("desktop-runner"), DesktopRunnerAdapter)


def test_happy_path_applies_the_patch_and_returns_the_cli_final_text(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})  # the Desktop is online
    t, box = _run_adapter_in_thread(_task(ws, run_id, owner))

    job = _claim(c)
    patch = _patch_creating(tmp_path, {"hello.txt": "hi\n", "REPORT.md": "# Report\n"})
    c.post(
        f"/api/desktop-runner/jobs/{job['id']}/events",
        json={
            "events": [
                {"seq": 0, "kind": "message", "payload": {"source": "claude", "text": "working"}}
            ]
        },
    )
    resp = c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={
            "status": "completed",
            "final_text": "Wrote hello.txt",
            "patch": patch,
            "usage": {"prompt_tokens": 11, "completion_tokens": 4, "total_tokens": 15},
        },
    )
    assert resp.status_code == 200, resp.text
    t.join(10)
    r = box["result"]
    assert r.status == "completed", r.error
    assert r.summary == "Wrote hello.txt"
    assert sorted(r.files_changed) == ["REPORT.md", "hello.txt"]
    assert (r.prompt_tokens, r.completion_tokens, r.total_tokens) == (11, 4, 15)
    assert r.cost_usd == 0.0, "nothing is billed per token on a subscription"
    assert (ws / "hello.txt").read_text() == "hi\n"
    assert (ws / "REPORT.md").read_text() == "# Report\n"
    with db.session_scope() as session:
        texts = [
            str(e.payload.get("text", ""))
            for e in session.execute(select(RunEvent).where(RunEvent.run_id == run_id)).scalars()
        ]
    assert any("Tvashtr Desktop" in t_ for t_ in texts), texts
    assert "working" in texts


def test_pull_scope_is_honoured_like_the_sandboxed_adapters(tmp_path):
    """An edits-off node (pull scope REPORT.md + verdict) never lets its other edits through."""
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    t, box = _run_adapter_in_thread(
        _task(ws, run_id, owner, pull_paths=("REPORT.md", "REVIEW_VERDICT.json"))
    )
    job = _claim(c)
    patch = _patch_creating(tmp_path, {"hello.txt": "hi\n", "REPORT.md": "# Spec\n"})
    c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={"status": "completed", "final_text": "spec written", "patch": patch},
    )
    t.join(10)
    assert box["result"].status == "completed"
    assert box["result"].files_changed == ["REPORT.md"]
    assert (ws / "REPORT.md").read_text() == "# Spec\n"
    assert not (ws / "hello.txt").exists()


def test_a_failed_cli_run_fails_the_node_with_the_runner_error(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    t, box = _run_adapter_in_thread(_task(ws, run_id, owner))
    job = _claim(c)
    c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={
            "status": "failed",
            "final_text": "",
            "patch": "",
            "error": "Claude Code exited with code 1",
        },
    )
    t.join(10)
    assert box["result"].status == "failed"
    assert "Claude Code exited with code 1" in box["result"].error


def test_desktop_going_offline_mid_node_fails_it_with_the_readable_error(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "desktop_runner_offline_seconds", 0.6)
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    t, box = _run_adapter_in_thread(_task(ws, run_id, owner))
    job = _claim(c)
    # …and then the Desktop quits: no more events, no result.
    t.join(10)
    assert box["result"].status == "failed"
    assert (
        box["result"].error
        == OFFLINE_ERROR
        == "Tvashtr Desktop went offline — reopen it and retry."
    )
    with db.session_scope() as session:
        assert session.get(DesktopNodeJob, uuid.UUID(job["id"])).status == "expired"
    late = c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={"status": "completed", "final_text": "too late", "patch": ""},
    )
    assert late.status_code == 409


def test_no_desktop_at_all_fails_the_queued_node_offline(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "desktop_runner_offline_seconds", 0.4)
    _, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    t, box = _run_adapter_in_thread(_task(ws, run_id, owner))
    t.join(10)
    assert box["result"].status == "failed"
    assert box["result"].error == OFFLINE_ERROR


def test_second_job_for_the_same_subscription_waits_and_says_so(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    busy = desktop_jobs.enqueue_job(
        owner_id=owner,
        run_id=run_id,
        node_id="other",
        iteration=1,
        invocation_id=99,
        provider="claude",
        model="anthropic/claude-sonnet-5",
        instruction="busy",
        workspace_dir=str(ws),
        sidecars=[],
    )
    assert _claim(c)["id"] == busy
    t, box = _run_adapter_in_thread(_task(ws, run_id, owner, invocation_id=8))
    deadline = time.time() + 5
    waiting = False
    while time.time() < deadline and not waiting:
        c.post("/api/desktop-runner/claim", json={"providers": []})  # keep the Desktop fresh
        with db.session_scope() as session:
            waiting = any(
                "Waiting for your Claude subscription — one job at a time"
                in str(e.payload.get("text"))
                for e in session.execute(
                    select(RunEvent).where(RunEvent.run_id == run_id, RunEvent.invocation_id == 8)
                ).scalars()
            )
        time.sleep(0.05)
    assert waiting, "the node log says it is waiting its turn"
    c.post(
        f"/api/desktop-runner/jobs/{busy}/result",
        json={"status": "completed", "final_text": "", "patch": ""},
    )
    job = _claim(c)
    c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={"status": "completed", "final_text": "second", "patch": ""},
    )
    t.join(10)
    assert box["result"].status == "completed"
    assert box["result"].summary == "second"


def test_recovery_re_execution_never_redispatches_or_double_applies(tmp_path):
    """DBOS re-runs a step whose completion was never recorded: the job row is found, the patch is
    NOT applied twice (even if the crash hit between applying and recording it)."""
    c, owner = _account()
    run_id = _run_for(owner)
    ws = _workspace(tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    task = _task(ws, run_id, owner)
    t, box = _run_adapter_in_thread(task)
    job = _claim(c)
    patch = _patch_creating(tmp_path, {"hello.txt": "hi\n"})
    c.post(
        f"/api/desktop-runner/jobs/{job['id']}/result",
        json={"status": "completed", "final_text": "done", "patch": patch},
    )
    t.join(10)
    assert box["result"].status == "completed"

    # Simulate the crash window: the patch is on disk but "applied" was never recorded.
    with db.session_scope() as session:
        session.execute(
            update(DesktopNodeJob)
            .where(DesktopNodeJob.id == uuid.UUID(job["id"]))
            .values(applied_at=None)
        )
    again = DesktopRunnerAdapter().run(task)
    assert again.status == "completed"
    assert again.files_changed == ["hello.txt"]
    assert (ws / "hello.txt").read_text() == "hi\n"
    with db.session_scope() as session:
        jobs = (
            session.execute(select(DesktopNodeJob).where(DesktopNodeJob.run_id == run_id))
            .scalars()
            .all()
        )
        assert len(jobs) == 1, "no second dispatch"


def test_recovery_onto_another_fly_machine_serves_and_patches_the_new_workspace(
    tmp_path, monkeypatch
):
    """M-subs-prod: machine A queued the job and died; DBOS recovers the workflow onto machine B,
    whose ``ensure_run_workspace`` re-materialized the workspace, and the adapter re-enters for the
    same (run, node, iteration). The runner's snapshot must come from B's copy (A's is gone) and
    the patch must land in B's workspace — one job, never a second dispatch."""
    c, owner = _account()
    run_id = _run_for(owner)
    c.post("/api/desktop-runner/claim", json={"providers": []})
    ws_a = tmp_path / "a"
    ws_a.mkdir()
    monkeypatch.setenv("FLY_MACHINE_ID", "machine-a")
    job_id = desktop_jobs.enqueue_job(  # what machine A's adapter did before it died
        owner_id=owner,
        run_id=run_id,
        node_id="n1",
        iteration=1,
        invocation_id=7,
        provider="claude",
        model="anthropic/claude-sonnet-5",
        instruction="Create hello.txt and REPORT.md",
        workspace_dir=str(ws_a / "ws"),
        sidecars=[],
    )
    assert _claim(c)["id"] == job_id  # the runner claimed it before A died

    monkeypatch.setenv("FLY_MACHINE_ID", "machine-b")
    ws_b = _workspace(tmp_path)  # B's re-materialized copy
    t, box = _run_adapter_in_thread(_task(ws_b, run_id, owner))
    deadline = time.time() + 5
    while time.time() < deadline:
        with db.session_scope() as session:
            if session.get(DesktopNodeJob, uuid.UUID(job_id)).workspace_machine_id == "machine-b":
                break
        time.sleep(0.05)
    snap = c.get(f"/api/desktop-runner/jobs/{job_id}/snapshot")
    assert snap.status_code == 200, snap.text
    assert "fly-replay" not in snap.headers
    c.post(
        f"/api/desktop-runner/jobs/{job_id}/result",
        json={
            "status": "completed",
            "final_text": "done",
            "patch": _patch_creating(tmp_path, {"hello.txt": "hi\n"}),
        },
    )
    t.join(10)
    assert box["result"].status == "completed", box["result"].error
    assert (ws_b / "hello.txt").read_text() == "hi\n"
    with db.session_scope() as session:
        rows = session.execute(select(DesktopNodeJob).where(DesktopNodeJob.run_id == run_id))
        assert len(rows.scalars().all()) == 1, "no second dispatch"
