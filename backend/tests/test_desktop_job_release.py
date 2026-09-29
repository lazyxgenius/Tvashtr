"""``POST /api/desktop-runner/jobs/{job_id}/release`` (desktop-app.md §3, DT-45 / DB-7).

Desktop quitting or restarting to update hands its claimed job back to the queue: owner-scoped
(another owner's job is a 404), only a claimed job (else 409), one note in the node's run log, the
relaunched runner re-claims it, and a Desktop that never comes back still fails the node offline.
"""

import threading
import time
import uuid
from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.engines.base import AgentTask, DesktopJobSpec
from tvashtr.engines.desktop_runner_adapter import OFFLINE_ERROR, DesktopRunnerAdapter
from tvashtr.engines.run_event_sink import make_run_event_sink
from tvashtr.main import app
from tvashtr.models import DesktopNodeJob, Run, RunEvent

RELEASED = "Tvashtr Desktop restarted — this step starts again when it's back."


@pytest.fixture(autouse=True)
def _fast_runner(client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(s, "desktop_runner_offline_seconds", 3.0)


def _account() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    resp = c.post(
        "/api/auth/register",
        json={"email": f"release-{uuid.uuid4().hex}@tvashtr.local", "password": "release-pass-1"},
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
                idea="release test",
                workflow_id=run_id,
                status="running",
                desktop_target=True,
                desktop_subscriptions=["claude"],
            )
        )
    return run_id


def _job(owner_id, run_id, workspace, *, invocation_id=5151) -> str:
    return desktop_jobs.enqueue_job(
        owner_id=owner_id,
        run_id=run_id,
        node_id="node-r",
        iteration=1,
        invocation_id=invocation_id,
        provider="claude",
        model="anthropic/claude-sonnet-5",
        instruction="Create hello.txt",
        workspace_dir=str(workspace),
        sidecars=["REPORT.md", "REVIEW_VERDICT.json"],
    )


def _claim(c: TestClient, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
        if job:
            return job
        time.sleep(0.05)
    raise AssertionError("no job to claim")


def _job_row(job_id: str) -> DesktopNodeJob:
    with db.session_scope() as session:
        row = session.get(DesktopNodeJob, uuid.UUID(job_id))
        session.expunge(row)
        return row


def _notes(run_id: str, invocation_id: int) -> list[str]:
    with db.session_scope() as session:
        rows = session.execute(
            select(RunEvent.payload)
            .where(RunEvent.run_id == run_id, RunEvent.invocation_id == invocation_id)
            .order_by(RunEvent.seq)
        ).scalars()
        return [p.get("text") for p in rows if isinstance(p, dict)]


def test_release_requeues_a_claimed_job_with_one_note_and_it_is_claimed_again(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    job_id = _job(owner, run_id, tmp_path)
    assert _claim(c)["id"] == job_id

    resp = c.post(f"/api/desktop-runner/jobs/{job_id}/release")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"job_id": job_id, "status": "queued"}
    row = _job_row(job_id)
    assert row.status == "queued"
    assert row.claimed_at is None
    assert row.heartbeat_at is None
    assert _notes(run_id, 5151).count(RELEASED) == 1

    # The provider is no longer blocked: the relaunched runner claims the same job at once.
    again = _claim(c)
    assert again["id"] == job_id
    assert _job_row(job_id).status == "claimed"

    # A second restart adds a second note (its own seq, not dropped as a duplicate).
    assert c.post(f"/api/desktop-runner/jobs/{job_id}/release").status_code == 200
    assert _notes(run_id, 5151).count(RELEASED) == 2


def _say(c: TestClient, job_id: str, *texts: str) -> None:
    events = [
        {"seq": i, "kind": "message", "payload": {"source": "claude", "text": t}}
        for i, t in enumerate(texts)
    ]
    resp = c.post(f"/api/desktop-runner/jobs/{job_id}/events", json={"events": events})
    assert resp.status_code == 200 and resp.json()["cancelled"] is False, resp.text


def test_a_reclaimed_job_keeps_both_attempts_events_in_order(tmp_path):
    # The relaunched runner restarts seq at 0: its events must not collide with (and be dropped
    # as duplicates of) the killed attempt's, and the release note sits between the two.
    c, owner = _account()
    run_id = _run_for(owner)
    job_id = _job(owner, run_id, tmp_path)
    _claim(c)
    _say(c, job_id, "first 0", "first 1")
    assert c.post(f"/api/desktop-runner/jobs/{job_id}/release").status_code == 200
    _claim(c)
    _say(c, job_id, "second 0", "second 1", "second 2")
    _say(c, job_id, "second 0")  # a runner retry of the same batch still dedups
    assert c.post(f"/api/desktop-runner/jobs/{job_id}/release").status_code == 200
    _claim(c)
    _say(c, job_id, "third 0")

    assert _notes(run_id, 5151) == [
        "first 0",
        "first 1",
        RELEASED,
        "second 0",
        "second 1",
        "second 2",
        RELEASED,
        "third 0",
    ]


def test_release_is_owner_scoped(tmp_path):
    alice, alice_id = _account()
    bob, _ = _account()
    job_id = _job(alice_id, _run_for(alice_id), tmp_path)
    _claim(alice)
    for cid in (job_id, str(uuid.uuid4()), "not-a-uuid"):
        resp = bob.post(f"/api/desktop-runner/jobs/{cid}/release")
        assert resp.status_code == 404
        assert resp.json() == {"detail": "job not found"}
    assert _job_row(job_id).status == "claimed", "another owner changed nothing"


def test_release_of_a_job_that_is_not_claimed_is_409(tmp_path):
    c, owner = _account()
    job_id = _job(owner, _run_for(owner), tmp_path)
    resp = c.post(f"/api/desktop-runner/jobs/{job_id}/release")
    assert resp.status_code == 409
    assert resp.json() == {"detail": "This job isn't running on Tvashtr Desktop."}


def test_release_needs_a_session(unauth_client):
    assert unauth_client.post(f"/api/desktop-runner/jobs/{uuid.uuid4()}/release").status_code == 401


def test_a_released_job_whose_desktop_never_returns_still_fails_offline(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "desktop_runner_offline_seconds", 0.6)
    c, owner = _account()
    run_id = _run_for(owner)
    ws = Path(tmp_path) / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "README.md").write_text("# demo\n")
    task = AgentTask(
        instruction="Create hello.txt",
        workspace_dir=str(ws),
        model="anthropic/claude-sonnet-5",
        desktop=DesktopJobSpec(
            run_id=run_id,
            node_id="n-off",
            iteration=1,
            invocation_id=6161,
            owner_id=str(owner),
            provider="claude",
        ),
    )
    box: dict = {}

    def go():
        box["result"] = DesktopRunnerAdapter().run(task, on_event=make_run_event_sink(run_id, 6161))

    c.post("/api/desktop-runner/claim", json={"providers": []})
    t = threading.Thread(target=go, daemon=True)
    t.start()
    job = _claim(c)
    assert c.post(f"/api/desktop-runner/jobs/{job['id']}/release").status_code == 200
    # …and Desktop never comes back: no claim, no heartbeat.
    t.join(10)
    assert box["result"].status == "failed"
    assert box["result"].error == OFFLINE_ERROR
    assert _job_row(job["id"]).status == "expired"


def test_a_released_long_running_job_waits_for_desktop_instead_of_failing_not_connected(tmp_path):
    """Independent review (revamp-finish): a busy runner polls with ``providers=[]`` (its only
    plan is running the job), so after a release the adapter's queued-branch "not connected" rule
    used to expire any job older than ``desktop_runner_offline_seconds`` about one poll later —
    the step never started again when Desktop came back."""
    c, owner = _account()
    run_id = _run_for(owner)
    ws = Path(tmp_path) / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    (ws / "README.md").write_text("# demo\n")
    task = AgentTask(
        instruction="Create hello.txt",
        workspace_dir=str(ws),
        model="anthropic/claude-sonnet-5",
        desktop=DesktopJobSpec(
            run_id=run_id,
            node_id="n-long",
            iteration=1,
            invocation_id=7171,
            owner_id=str(owner),
            provider="claude",
        ),
    )
    box: dict = {}

    def go():
        box["result"] = DesktopRunnerAdapter().run(task, on_event=make_run_event_sink(run_id, 7171))

    t = threading.Thread(target=go, daemon=True)
    t.start()
    job = _claim(c)
    # What the real runner sends while its only plan is busy with this job (runner.cjs
    # freeProviders).
    c.post("/api/desktop-runner/claim", json={"providers": []})
    # The step has been running longer than the offline window.
    with db.session_scope() as session:
        row = session.get(DesktopNodeJob, uuid.UUID(job["id"]))
        row.created_at = row.created_at - timedelta(seconds=60)

    assert c.post(f"/api/desktop-runner/jobs/{job['id']}/release").status_code == 200
    time.sleep(0.6)  # ~12 adapter polls
    assert _job_row(job["id"]).status == "queued", _job_row(job["id"]).error
    assert "result" not in box

    # The relaunched Desktop claims the same job.
    assert _claim(c)["id"] == job["id"]
    desktop_jobs.expire_job(job["id"], OFFLINE_ERROR)  # end the adapter loop
    t.join(10)
