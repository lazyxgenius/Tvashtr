"""M-desk-6 (brief prompts/m-desk-6.md): a "Tests pass" check Tvashtr runs itself (T1), honest
Desktop agents (T2), the Done time fixed at Ship (S2) and a never-pushed GitHub run's Changes (S3).
T2, S2 and S3 were written first and failed on dac9afc4."""

import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from test_activity import _at, _build, _inv, _node, _run

from tvashtr import db
from tvashtr.config import get_settings
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentTask, DesktopJobSpec
from tvashtr.engines.desktop_runner_adapter import DesktopRunnerAdapter
from tvashtr.main import app
from tvashtr.models import Run

FILE_TOOLS_ONLY = (
    "On this computer you have file tools only — you can't run commands, so don't ask for "
    "command or test output. If the team has a Tests check, Tvashtr runs the tests in its own "
    "sandbox and passes you the result."
)


# ---------------------------------------------------------------- T2: honest Desktop agents


@pytest.fixture
def _fast_runner(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "desktop_runner_poll_seconds", 0.05)
    monkeypatch.setattr(s, "desktop_runner_offline_seconds", 3.0)


def _desktop_account() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    resp = c.post(
        "/api/auth/register",
        json={"email": f"desk6-{uuid.uuid4().hex}@tvashtr.local", "password": "desk6-pass-1"},
    )
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def _desktop_run(owner_id) -> str:
    run_id = str(uuid.uuid4())
    with db.session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(build_two_node_team()),
                owner_id=owner_id,
                idea="desk6 test",
                workflow_id=run_id,
                status="running",
                desktop_target=True,
                desktop_subscriptions=["claude"],
            )
        )
    return run_id


@pytest.mark.usefixtures("_fast_runner")
def test_t2_every_desktop_job_is_told_it_has_file_tools_only(tmp_path):
    """A Desktop job's instruction carries the file-tools-only line (server-side, once)."""
    c, owner = _desktop_account()
    run_id = _desktop_run(owner)
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    task = AgentTask(
        instruction="Review the change and write REVIEW_VERDICT.json",
        workspace_dir=str(ws),
        model="anthropic/claude-sonnet-5",
        desktop=DesktopJobSpec(
            run_id=run_id,
            node_id="n-rev",
            iteration=1,
            invocation_id=7,
            owner_id=str(owner),
            provider="claude",
        ),
    )
    c.post("/api/desktop-runner/claim", json={"providers": []})  # the Desktop is online
    threading.Thread(target=lambda: DesktopRunnerAdapter().run(task), daemon=True).start()
    deadline, job = time.time() + 5, None
    while time.time() < deadline and not job:
        job = c.post("/api/desktop-runner/claim", json={"providers": ["claude"]}).json()["job"]
        time.sleep(0.05)
    assert job, "no job was enqueued"
    assert job["instruction"].startswith("Review the change and write REVIEW_VERDICT.json")
    assert job["instruction"].endswith("\n\n" + FILE_TOOLS_ONLY)
    assert job["instruction"].count(FILE_TOOLS_ONLY) == 1
    with session_scope() as session:  # end the job's wait so the adapter thread returns
        session.execute(update(Run).where(Run.id == uuid.UUID(run_id)).values(status="cancelled"))


# ---------------------------------------------------------------- S2: the Done time stays put


def test_s2_the_done_time_is_written_once_at_ship_not_moved_by_the_memory_save():
    """The walk finalizes the run, saves its memories, then closes Ship; a read in between wrote
    "Done in 37m 16s" (Ship still open) and every later read "Done in 37m 36s". The run's finish
    is its Ship step's close, so the end lines wait for it and are then fixed."""
    pm, eng = _node("pm", x=0), _node("engineer", x=200)
    ship = _node("ship", kind="terminal", x=400, config={"terminal_kind": "ship"})
    nodes = [pm, eng, ship]
    done = [_inv(1, pm, end=30), _inv(2, eng, start=40, end=2230)]
    shipped = dict(pr_url="https://github.com/lazyxgenius/trade_mcp/pull/53", ship_branch="b")
    # Finalized: the run reads completed while Ship is still open (the memory save runs).
    first = _build(
        _run("completed", **shipped), nodes, [*done, _inv(3, ship, status="running", start=2236)]
    )
    assert [ln["kind"] for ln in first["lines"]].count("done") == 0
    assert all(ln["id"] not in ("run:done", "run:pr") for ln in first["lines"])
    assert first["summary"] is None and first["settled"] is False
    # 20 s later the memory save is over and Ship is closed; a later write changes nothing.
    closed = [*done, _inv(3, ship, start=2236, end=2256, outcome="shipped")]
    for run in (_run("completed", **shipped), _run("completed", updated_at=_at(9000), **shipped)):
        reply = _build(run, nodes, closed)
        assert reply["settled"] is True
        assert [ln["id"] for ln in reply["lines"]][-2:] == ["run:pr", "run:done"]
        assert reply["lines"][-1]["text"] == "Done in 37m 36s · $1.12"
        assert reply["lines"][-1]["at"] == _at(2256).isoformat()
        assert reply["summary"]["elapsed_s"] == 2256


# ---------------------------------------------------------------- S3: a never-pushed GitHub run


@pytest.mark.parametrize("status", ["failed", "cancelled"])
def test_s3_a_github_run_that_never_pushed_does_not_ask_github(client, monkeypatch, status):
    from test_hosted_github_run import _make_hosted_run

    from tvashtr.control_plane import github_app

    def never(*a, **k):
        raise AssertionError("GitHub was asked")

    monkeypatch.setattr(github_app, "_http", never)
    monkeypatch.setattr(github_app, "get_installation_token", never)
    rid = _make_hosted_run()
    with session_scope() as session:  # stopped before Ship: a branch name, no commit, no PR
        session.execute(
            update(Run)
            .where(Run.id == rid)
            .values(status=status, repo_path="/gone/clone", ship_branch=f"tvashtr/{rid}")
        )
    body = client.get(f"/api/runs/{rid}/diff").json()
    assert body["not_pushed"] is True
    assert body["files"] == [] and body["total"] == 0
    assert "github_error" not in body
