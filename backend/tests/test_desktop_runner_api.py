"""M-subs-desktop — the secret-free, session-authenticated, OWNER-SCOPED Desktop runner endpoints.

``POST /api/desktop-runner/claim`` (heartbeat + claim), ``GET …/jobs/{id}/snapshot``,
``POST …/jobs/{id}/events`` and ``POST …/jobs/{id}/result``. A runner only ever sees its own
owner's jobs; at most one job per provider per owner runs at a time; any body carrying a
token/cookie/api-key-like field is rejected (the same guard as the status mirror).
"""

import io
import tarfile
import uuid
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update

from tvashtr import db
from tvashtr.control_plane import desktop_jobs
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.main import app
from tvashtr.models import DesktopNodeJob, DesktopRunnerHeartbeat, Run, RunEvent


def _account() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"runner-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "runner-pass-1"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _run_for(owner_id: uuid.UUID, status: str = "running") -> str:
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=owner_id,
                idea="runner test",
                workflow_id=run_id,
                status=status,
                desktop_target=True,
                desktop_subscriptions=["claude", "grok"],
            )
        )
    return run_id


def _job(owner_id, run_id, workspace, *, provider="claude", node="node-a", iteration=1) -> str:
    return desktop_jobs.enqueue_job(
        owner_id=owner_id,
        run_id=run_id,
        node_id=node,
        iteration=iteration,
        invocation_id=4242,
        provider=provider,
        model="anthropic/claude-sonnet-5" if provider == "claude" else "xai/grok-4.7",
        instruction="Create hello.txt",
        workspace_dir=str(workspace),
        sidecars=["REPORT.md", "REVIEW_VERDICT.json"],
    )


def test_claim_is_the_heartbeat_and_drives_runner_fresh():
    c, owner = _account()
    c.put(
        "/api/engines/subscriptions/claude",
        json={"connected": True, "state": "connected", "source": "harness"},
    )
    subs = {s["provider"]: s for s in c.get("/api/engines/subscriptions").json()["subscriptions"]}
    assert subs["claude"]["connected"] is True
    assert subs["claude"]["runner_fresh"] is False, "no Desktop runner has polled yet"

    resp = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"job": None}
    subs = {s["provider"]: s for s in c.get("/api/engines/subscriptions").json()["subscriptions"]}
    assert subs["claude"]["runner_fresh"] is True
    assert subs["grok"]["runner_fresh"] is False, "not connected ⇒ never fresh"
    assert subs["codex"]["runner_fresh"] is False

    # A heartbeat older than the freshness window no longer counts.
    with db.session_scope() as session:
        session.execute(
            update(DesktopRunnerHeartbeat)
            .where(DesktopRunnerHeartbeat.owner_id == owner)
            .values(last_seen_at=datetime.now(UTC) - timedelta(minutes=10))
        )
    subs = {s["provider"]: s for s in c.get("/api/engines/subscriptions").json()["subscriptions"]}
    assert subs["claude"]["runner_fresh"] is False


def test_claim_hands_out_only_the_owners_own_jobs(tmp_path):
    alice, alice_id = _account()
    bob, _ = _account()
    job_id = _job(alice_id, _run_for(alice_id), tmp_path)

    assert bob.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json() == {
        "job": None
    }
    got = alice.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
    assert got["id"] == job_id
    assert got["provider"] == "claude"
    assert got["model"] == "anthropic/claude-sonnet-5"
    assert got["instruction"] == "Create hello.txt"
    assert got["sidecars"] == ["REPORT.md", "REVIEW_VERDICT.json"]
    assert "workspace_dir" not in got, "server paths never leave the server"
    # Another owner can't read, feed or finish it.
    assert bob.get(f"/api/desktop-runner/jobs/{job_id}/snapshot").status_code == 404
    assert (
        bob.post(f"/api/desktop-runner/jobs/{job_id}/events", json={"events": []}).status_code
        == 404
    )
    assert (
        bob.post(
            f"/api/desktop-runner/jobs/{job_id}/result",
            json={"status": "completed", "final_text": "x", "patch": ""},
        ).status_code
        == 404
    )


def test_one_running_job_per_provider_per_owner(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    first = _job(owner, run_id, tmp_path, node="n1")
    second = _job(owner, run_id, tmp_path, node="n2")
    grok = _job(owner, run_id, tmp_path, node="n3", provider="grok")

    assert (
        c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]["id"]
        == first
    )
    # Claude is busy: the second Claude job waits even if the runner asks for claude again…
    assert c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json() == {
        "job": None
    }
    # …while Grok is independent.
    assert (
        c.post("/api/desktop-runner/claim", json={"providers": ["claude", "grok"]}).json()["job"][
            "id"
        ]
        == grok
    )
    done = c.post(
        f"/api/desktop-runner/jobs/{first}/result",
        json={"status": "completed", "final_text": "ok", "patch": ""},
    )
    assert done.status_code == 200, done.text
    assert (
        c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]["id"]
        == second
    )


def test_snapshot_is_a_tarball_of_the_workspace_without_git(tmp_path):
    ws = tmp_path / "ws"
    (ws / ".git").mkdir(parents=True)
    (ws / ".git" / "config").write_text("[core]\n")
    (ws / "src").mkdir()
    (ws / "src" / "app.py").write_text("print('hi')\n")
    (ws / "README.md").write_text("# demo\n")
    c, owner = _account()
    job_id = _job(owner, _run_for(owner), ws)
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})

    resp = c.get(f"/api/desktop-runner/jobs/{job_id}/snapshot")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/gzip"
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        names = sorted(n.lstrip("./") for n in tar.getnames() if n not in (".", "./"))
    assert "README.md" in names and "src/app.py" in names
    assert not any(n == ".git" or n.startswith(".git/") for n in names)


def test_events_land_in_the_nodes_run_log_and_are_the_job_heartbeat(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner)
    job_id = _job(owner, run_id, tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    resp = c.post(
        f"/api/desktop-runner/jobs/{job_id}/events",
        json={
            "events": [
                {"seq": 0, "kind": "message", "payload": {"source": "claude", "text": "hello"}},
                {
                    "seq": 1,
                    "kind": "action",
                    "payload": {"tool_name": "Write", "thought": "", "action": "{}"},
                },
            ]
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "cancelled": False}
    # Re-posting the same batch (a runner retry) never duplicates rows.
    c.post(
        f"/api/desktop-runner/jobs/{job_id}/events",
        json={
            "events": [
                {"seq": 0, "kind": "message", "payload": {"source": "claude", "text": "hello"}}
            ]
        },
    )
    with db.session_scope() as session:
        rows = (
            session.execute(
                select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.seq)
            )
            .scalars()
            .all()
        )
        assert [(r.kind, r.invocation_id) for r in rows] == [("message", 4242), ("action", 4242)]
        assert rows[0].payload == {"source": "claude", "text": "hello"}
        job = session.get(DesktopNodeJob, uuid.UUID(job_id))
        assert job.heartbeat_at is not None


def test_runner_bodies_carrying_secrets_are_rejected(tmp_path):
    c, owner = _account()
    job_id = _job(owner, _run_for(owner), tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    poisoned = [
        ("/api/desktop-runner/claim", {"providers": ["claude"], "api_key": "sk-x"}),
        ("/api/desktop-runner/claim", {"providers": ["claude"], "cookies": "tv_session=1"}),
        (
            f"/api/desktop-runner/jobs/{job_id}/events",
            {"events": [{"seq": 0, "kind": "message", "payload": {"text": "x", "token": "t"}}]},
        ),
        (
            f"/api/desktop-runner/jobs/{job_id}/events",
            {"events": [], "authorization": "Bearer x"},
        ),
        (
            f"/api/desktop-runner/jobs/{job_id}/result",
            {"status": "completed", "final_text": "x", "patch": "", "oauth_token": "sk-ant-oat01"},
        ),
        (
            f"/api/desktop-runner/jobs/{job_id}/result",
            {"status": "completed", "final_text": "x", "patch": "", "usage": {"access_token": "t"}},
        ),
        (
            f"/api/desktop-runner/jobs/{job_id}/result",
            {"status": "completed", "final_text": "x", "patch": "", "unexpected_field": 1},
        ),
    ]
    for path, body in poisoned:
        resp = c.post(path, json=body)
        assert resp.status_code == 422, (path, body, resp.status_code, resp.text)
    with db.session_scope() as session:
        assert session.get(DesktopNodeJob, uuid.UUID(job_id)).status == "claimed"


def test_result_is_stored_once_and_a_late_result_is_refused(tmp_path):
    c, owner = _account()
    job_id = _job(owner, _run_for(owner), tmp_path)
    c.post("/api/desktop-runner/claim", json={"providers": ["claude"]})
    ok = c.post(
        f"/api/desktop-runner/jobs/{job_id}/result",
        json={
            "status": "completed",
            "final_text": "Wrote hello.txt",
            "patch": "diff --git a/hello.txt b/hello.txt\n",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
    )
    assert ok.status_code == 200, ok.text
    again = c.post(
        f"/api/desktop-runner/jobs/{job_id}/result",
        json={"status": "failed", "final_text": "", "patch": "", "error": "late"},
    )
    assert again.status_code == 409
    with db.session_scope() as session:
        job = session.get(DesktopNodeJob, uuid.UUID(job_id))
        assert job.status == "completed"
        assert job.result_text == "Wrote hello.txt"
        assert job.usage == {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}


def test_jobs_of_a_cancelled_run_are_never_handed_out(tmp_path):
    c, owner = _account()
    run_id = _run_for(owner, status="cancelled")
    job_id = _job(owner, run_id, tmp_path)
    assert c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json() == {
        "job": None
    }
    with db.session_scope() as session:
        assert session.get(DesktopNodeJob, uuid.UUID(job_id)).status == "expired"


def test_enqueue_is_idempotent_on_run_node_iteration(tmp_path):
    _, owner = _account()
    run_id = _run_for(owner)
    a = _job(owner, run_id, tmp_path, node="n1", iteration=2)
    b = _job(owner, run_id, tmp_path, node="n1", iteration=2)
    assert a == b
    with db.session_scope() as session:
        assert (
            len(
                session.execute(select(DesktopNodeJob).where(DesktopNodeJob.run_id == run_id))
                .scalars()
                .all()
            )
            == 1
        )
