"""M-desk-6 (brief prompts/m-desk-6.md): a "Tests pass" check Tvashtr runs itself (T1), honest
Desktop agents (T2), the Done time fixed at Ship (S2) and a never-pushed GitHub run's Changes (S3).
T2, S2 and S3 were written first and failed on dac9afc4."""

import threading
import time
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from test_activity import _at, _build, _inv, _node, _run
from test_context_compiler import _compile

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


# ---------------------------------------------------------------- T1: the "Tests pass" check

PASS_OUT = "....\n42 passed in 6.1s\n"
FAIL_OUT = "\n".join(f"line {i}" for i in range(1, 21)) + "\n1 failed, 41 passed in 6.3s\n"


@pytest.fixture
def _sandbox(monkeypatch):
    """The run's sandbox answers from a script: ``calls`` records each command it was given."""
    from tvashtr.control_plane import hidden_checks

    calls, answers = [], []

    def fake_execute(run_id, workspace, command, mode, limit_s):
        calls.append({"command": command, "mode": mode, "limit_s": limit_s, "ws": workspace})
        answer = answers.pop(0) if answers else (0, PASS_OUT, False)
        if isinstance(answer, BaseException):
            raise answer
        return answer

    monkeypatch.setattr(hidden_checks, "_execute", fake_execute)
    s = get_settings()
    monkeypatch.setattr(s, "hosted_mode", False)
    monkeypatch.setattr(s, "agent_sandbox_mode", "docker")
    return calls, answers


def _check(workspace, command="pip install -r requirements.txt && pytest -q", mode="brownfield"):
    from tvashtr.control_plane.guardrails import guardrail_gate_step

    return guardrail_gate_step("r1", "n-chk", "tests_pass", workspace, {"command": command}, mode)


def test_t1_tests_pass_is_a_guardrail_kind():
    from tvashtr.control_plane.guardrails import GUARDRAIL_GATE_KINDS

    assert "tests_pass" in GUARDRAIL_GATE_KINDS


def test_t1_a_passing_command_approves_with_its_last_line(_sandbox, tmp_path):
    calls, answers = _sandbox
    answers.append((0, PASS_OUT, False))
    out = _check(str(tmp_path))
    assert out["resolution"] == "approved"
    assert out["reasons"] == "42 passed in 6.1s"
    assert "Tests (run by Tvashtr in its sandbox): passed — 42 passed in 6.1s" in out["note"]
    # Through M9's runner: the run's sandbox, the repo's root, the 10-minute cap, the run's mode.
    assert calls == [
        {
            "command": "pip install -r requirements.txt && pytest -q",
            "mode": "brownfield",
            "limit_s": 600,
            "ws": str(tmp_path),
        }
    ]


def test_t1_a_failing_command_rejects_with_the_last_12_lines(_sandbox, tmp_path):
    _, answers = _sandbox
    answers.append((1, FAIL_OUT, False))
    out = _check(str(tmp_path))
    assert out["resolution"] == "rejected"
    lines = out["reasons"].split("\n")
    assert len(lines) == 12
    assert lines[0] == "line 10" and lines[-1] == "1 failed, 41 passed in 6.3s"
    assert out["note"].endswith(out["reasons"])
    assert "failed" in out["note"]


def test_t1_tests_that_time_out_are_rejected(_sandbox, tmp_path):
    _, answers = _sandbox
    answers.append((None, "collected 3 items\n", True))
    out = _check(str(tmp_path))
    assert out["resolution"] == "rejected"
    assert out["reasons"].split("\n")[-1] == "The tests didn't finish in 10 minutes."


@pytest.mark.parametrize(
    "case",
    ["sandbox_failed", "hosted_no_sandbox", "no_command", "no_workspace"],
)
def test_t1_tests_that_could_not_run_pass_on_with_a_note(_sandbox, monkeypatch, tmp_path, case):
    """Never a false pass and never a loop the Engineer can't fix: approved, with the reason."""
    calls, answers = _sandbox
    ws, command = str(tmp_path), "pytest -q"
    if case == "sandbox_failed":
        answers.append(RuntimeError("the sandbox failed while running the check"))
    elif case == "hosted_no_sandbox":
        monkeypatch.setattr(get_settings(), "hosted_mode", True)
        monkeypatch.setattr(get_settings(), "agent_sandbox_mode", "local")
        monkeypatch.setenv("FLY_MACHINE_ID", "m-1")
    elif case == "no_command":
        command = "   "
    else:
        ws = None
    out = _check(ws, command)
    assert out["resolution"] == "approved"
    assert out["reasons"].startswith("Couldn't run the tests: ")
    assert "couldn't run" in out["note"]
    if case != "sandbox_failed":
        assert calls == []


def test_t1_the_output_never_shows_a_secret(_sandbox, tmp_path):
    """Invariant 7: a key the tests print is masked in what the run view and the agent see."""
    planted = "sk-proj-PLANTEDtestkey0123456789abcdef"
    _, answers = _sandbox
    answers.append((1, f"E   requests failed: OPENAI_API_KEY={planted}\nFAILED test_x\n", False))
    out = _check(str(tmp_path))
    assert planted not in out["reasons"] and planted not in out["note"]
    assert "••••" in out["reasons"]


def test_t1_a_local_dev_check_runs_in_a_copy_of_the_workspace(monkeypatch, tmp_path):
    """LOCAL (dev) runs a command in place; the Tests check runs it in a copy, so nothing it builds
    (caches, installs) can ship with the run."""
    monkeypatch.setattr(get_settings(), "hosted_mode", False)
    monkeypatch.setattr(get_settings(), "agent_sandbox_mode", "local")
    (tmp_path / "test_ok.py").write_text("print('ok')\n")
    out = _check(str(tmp_path), "touch built.txt && python3 test_ok.py && echo '1 passed'")
    assert out["resolution"] == "approved" and out["reasons"] == "1 passed"
    assert not (tmp_path / "built.txt").exists()


def test_t1_a_rejected_check_is_the_next_agents_rework_notes():
    """The failing lines become the Engineer's rework round exactly as a Reviewer's reasons do."""
    from tvashtr.control_plane.guardrails import check_note

    note = check_note("failed", "Tests (run by Tvashtr in its sandbox): failed — the last 2 lines "
                      "of their output:\nFAILED test_tema\n1 failed, 41 passed")  # fmt: skip
    text = _compile(iteration=2, reviewer_feedback=note).instruction
    assert "--- REVISION REQUESTED (round 2) ---" in text
    assert "FAILED test_tema\n1 failed, 41 passed" in text
    assert "revise it IN PLACE" in text
    assert "[tvashtr-check:" not in text


def test_t1_a_passed_check_is_one_line_in_the_next_agents_context():
    from tvashtr.control_plane.guardrails import check_note

    line = "Tests (run by Tvashtr in its sandbox): passed — 42 passed in 6.1s"
    compiled = _compile(
        iteration=1, reviewer_feedback=check_note("passed", line), emits_outcome=True
    )
    assert line in compiled.instruction
    assert "REVISION REQUESTED" not in compiled.instruction
    assert "[tvashtr-check:" not in compiled.instruction
    # A Reviewer's own notes are worded exactly as before.
    plain = _compile(iteration=2, reviewer_feedback="Handle an empty list")
    assert "The Reviewer reviewed your previous attempt" in plain.instruction


def test_t1_a_secret_scan_rejection_tells_the_next_agent_what_was_found(tmp_path):
    from tvashtr.control_plane.guardrails import guardrail_gate_step

    planted = "AKIA1234567890ABCDEF"
    (tmp_path / "creds.env").write_text(f"AWS_ACCESS_KEY_ID={planted}\n")
    out = guardrail_gate_step("r1", "n", "secret_leak_scan", str(tmp_path), {})
    assert out["resolution"] == "rejected"
    assert "creds.env" in out["note"] and "aws-access-key-id" in out["note"]
    assert planted not in out["note"]


# ---- the REAL walk: Engineer -> Tests pass -> Reviewer -> Ship


def _tests_team() -> dict:
    """The review-loop team (PM -> spec gate -> Engineer <-> Reviewer -> Ship) with a Tests pass
    check between the Engineer and the Reviewer (rejected -> back to the Engineer)."""
    from sqlalchemy import select

    from tvashtr.control_plane.teams import build_review_loop_team
    from tvashtr.models import AgentNode, Edge

    team = build_review_loop_team()
    with session_scope() as session:
        nodes = session.execute(
            select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team))
        ).scalars().all()  # fmt: skip
        by_role = {n.role_name: n for n in nodes}
        eng, rev = by_role["engineer"], by_role["reviewer"]
        chk = AgentNode(
            team_graph_id=uuid.UUID(team),
            role_name="gate",
            kind="gate",
            position={"x": 500, "y": 0},
            config={"gate_kind": "tests_pass", "title": "", "description": "",
                    "command": "pip install -r requirements.txt && pytest -q"},
        )  # fmt: skip
        session.add(chk)
        session.flush()
        old = session.execute(
            select(Edge).where(Edge.source_node_id == eng.id, Edge.target_node_id == rev.id)
        ).scalar_one()
        session.delete(old)
        session.add_all(
            [
                Edge(team_graph_id=uuid.UUID(team), source_node_id=eng.id,
                     target_node_id=chk.id, edge_type="work", conditions=None),
                Edge(team_graph_id=uuid.UUID(team), source_node_id=chk.id,
                     target_node_id=rev.id, edge_type="work", conditions={"when": "approved"}),
                Edge(team_graph_id=uuid.UUID(team), source_node_id=chk.id,
                     target_node_id=eng.id, edge_type="work", conditions={"when": "rejected"}),
            ]
        )  # fmt: skip
        return {"team": team, "chk": str(chk.id)}


def test_t1_the_walk_reworks_on_the_failing_lines_then_the_reviewer_sees_the_pass(
    client, monkeypatch, tmp_path, _sandbox
):
    from conftest import auth_user_id, entry_report_result
    from dbos import DBOS, SetWorkflowID
    from sqlalchemy import select, text

    from tvashtr.control_plane import team_run
    from tvashtr.models import AgentInvocation

    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "0")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    calls, answers = _sandbox
    answers.extend([(1, FAIL_OUT, False), (0, PASS_OUT, False)])
    ws = tmp_path / "ws"
    ws.mkdir()
    init_workspace_repo(str(ws))
    got = {"engineer": [], "reviewer": []}

    def fake_agent(run_id, node_prompt, model, iteration, idea, prd_text, workspace_dir, vkey,
                   reviewer_feedback, emits_outcome, budget, invocation_id=None,
                   edits_allowed=True, **kwargs):  # fmt: skip
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        role = "reviewer" if emits_outcome else "engineer"
        got[role].append((iteration, reviewer_feedback))
        if emits_outcome:
            return {"status": "completed", "outcome": "approved", "reasons": "Tests passed; good",
                    "prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2,
                    "cost_usd": 0.0}  # fmt: skip
        (Path(workspace_dir) / "tema.py").write_text(f"round {iteration}\n")
        return {"status": "completed", "outcome": None, "reasons": None, "prompt_tokens": 1,
                "completion_tokens": 1, "total_tokens": 2, "cost_usd": 0.0}  # fmt: skip

    monkeypatch.setattr(team_run, "engineer_setup_step", lambda run_id: str(ws))
    monkeypatch.setattr(team_run, "agent_run_step", fake_agent)
    ids = _tests_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(id=uuid.UUID(run_id), team_graph_id=uuid.UUID(ids["team"]),
                owner_id=auth_user_id(), idea="Add a TEMA indicator", workflow_id=run_id,
                status="running")
        )  # fmt: skip
    with SetWorkflowID(run_id):
        result = DBOS.start_workflow(team_run.run_team, "Add a TEMA indicator").get_result()

    assert result["status"] == "completed"
    # The Engineer reworked on the failing lines (round 2) — exactly as on a Reviewer's notes.
    assert [it for it, _ in got["engineer"]] == [1, 2]
    assert got["engineer"][0][1] is None
    assert "1 failed, 41 passed in 6.3s" in got["engineer"][1][1]
    # The Reviewer got the passing line.
    assert len(got["reviewer"]) == 1
    assert "passed — 42 passed in 6.1s" in got["reviewer"][0][1]
    with session_scope() as session:
        rows = session.execute(
            select(AgentInvocation.outcome, AgentInvocation.outcome_detail)
            .where(AgentInvocation.run_id == run_id,
                   AgentInvocation.node_id == uuid.UUID(ids["chk"]))
            .order_by(AgentInvocation.iteration)
        ).all()  # fmt: skip
    assert [r.outcome for r in rows] == ["rejected", "approved"]
    assert rows[1].outcome_detail == "42 passed in 6.1s"
    assert len(calls) == 2

    # A recovered walk replays the recorded check — the command doesn't run again.
    with session_scope() as session:
        session.execute(
            text("update dbos.workflow_status set status = 'CANCELLED' where workflow_uuid = :w"),
            {"w": run_id},
        )
    before = len(got["engineer"])
    assert DBOS.resume_workflow(run_id).get_result()["status"] == "completed"
    assert len(got["engineer"]) > before  # the walk really ran again (the fakes aren't recorded)
    assert len(calls) == 2  # …but the recorded check replayed: its command didn't run twice


# ---- authoring: the gate drawer's Save and the team file


def _blank_with_gate(client) -> tuple[str, str]:
    tid = client.post("/api/teams", json={"template": "blank", "name": "Tests check"}).json()[
        "team_graph_id"
    ]
    gate = client.post(f"/api/teams/{tid}/nodes", json={"node_kind": "gate"}).json()
    return tid, gate["id"]


def test_t1_saving_a_tests_check_keeps_its_command(client):
    tid, gid = _blank_with_gate(client)
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{gid}",
        json={"gate_kind": "tests_pass", "command": "  pip install -e . && pytest -q  "},
    )
    assert resp.status_code == 200, resp.text
    node = next(n for n in client.get(f"/api/teams/{tid}/graph").json()["nodes"] if n["id"] == gid)
    assert node["config"]["gate_kind"] == "tests_pass"
    assert node["config"]["command"] == "pip install -e . && pytest -q"


@pytest.mark.parametrize(
    ("command", "words"),
    [("", "Add the command Tvashtr runs."), ("x" * 1001, "at most 1,000 characters")],
)
def test_t1_a_tests_check_needs_a_command_of_at_most_1000_characters(client, command, words):
    tid, gid = _blank_with_gate(client)
    resp = client.patch(
        f"/api/teams/{tid}/nodes/{gid}", json={"gate_kind": "tests_pass", "command": command}
    )
    assert resp.status_code == 422 and words in resp.text


def test_t1_the_team_file_carries_a_tests_checks_command(client):
    tid, gid = _blank_with_gate(client)
    client.patch(
        f"/api/teams/{tid}/nodes/{gid}", json={"gate_kind": "tests_pass", "command": "pytest -q"}
    )
    content = client.get(f"/api/teams/{tid}/file?format=yaml").json()["content"]
    assert "checks: tests_pass" in content and "command: pytest -q" in content
    made = client.post("/api/teams/import", json={"content": content, "name": "Imported"})
    assert made.status_code == 201, made.text
    nodes = client.get(f"/api/teams/{made.json()['team_graph_id']}/graph").json()["nodes"]
    gate = next(n for n in nodes if n["kind"] == "gate")
    assert gate["config"]["gate_kind"] == "tests_pass"
    assert gate["config"]["command"] == "pytest -q"


# ---- the run view: "Running the tests…", then the result, website and Desktop alike


def _tests_world():
    eng = _node("engineer", x=200)
    chk = _node("gate", kind="gate", x=300, config={"gate_kind": "tests_pass", "title": "",
                                                    "command": "pytest -q"})  # fmt: skip
    rev = _node("reviewer", x=400)
    edges = [
        {"source": str(chk.id), "target": str(eng.id), "edge_type": "work",
         "conditions": {"when": "rejected"}},
    ]  # fmt: skip
    return eng, chk, rev, edges


def _check_lines(reply):
    return [ln for ln in reply["lines"] if ln["kind"] == "check"]


def test_t1_the_run_view_shows_the_tests_running_then_failed_back_to_the_engineer():
    eng, chk, rev, edges = _tests_world()
    running = _build(
        _run(), [eng, chk, rev], [_inv(1, eng, end=60), _inv(2, chk, status="running", start=61)],
        edges=edges,
    )  # fmt: skip
    (line,) = _check_lines(running)
    assert (line["label"], line["text"]) == ("Tests pass", "Running the tests…")
    assert line["refs"]["running"] is True
    agent = {a["node_id"]: a for a in running["agents"]}[str(chk.id)]
    assert agent["live_state"] == "working" and agent["activity"] == "Running the tests…"
    assert running["live_state"] != "needs_you"

    failed_lines = "\n".join(f"l{i}" for i in range(1, 12)) + "\n1 failed, 41 passed in 6.3s"
    failed = _build(
        _run(), [eng, chk, rev],
        [_inv(1, eng, end=60),
         _inv(2, chk, start=61, end=90, outcome="rejected", detail=failed_lines),
         _inv(3, eng, iteration=2, status="running", start=91)],
        edges=edges,
    )  # fmt: skip
    (line,) = _check_lines(failed)
    assert line["text"] == "Tests failed — back to Engineer with the last 12 lines"
    assert line["tone"] == "danger" and line["refs"]["output_tail"] == failed_lines.split("\n")


def test_t1_the_run_view_shows_the_tests_passed_and_counts_them_in_done():
    eng, chk, rev, edges = _tests_world()
    reply = _build(
        _run("completed"), [eng, chk, rev],
        [_inv(1, eng, end=60), _inv(2, chk, start=61, end=90, outcome="approved",
                                    detail="42 passed in 6.1s"),
         _inv(3, rev, start=91, end=200, outcome="approved", detail="Tests passed; RSI ok")],
        edges=edges,
    )  # fmt: skip
    (line,) = _check_lines(reply)
    assert (line["text"], line["tone"]) == ("Tests passed · 42 passed in 6.1s", "ok")
    assert "output_tail" not in line["refs"]
    assert reply["summary"]["tests_passed"] == 42


def test_t1_the_run_view_warns_when_the_tests_could_not_run():
    eng, chk, rev, edges = _tests_world()
    reply = _build(
        _run(), [eng, chk, rev],
        [_inv(1, eng, end=60), _inv(2, chk, start=61, end=62, outcome="approved",
                                    detail="Couldn't run the tests: the sandbox failed (X).")],
        edges=edges,
    )  # fmt: skip
    (line,) = _check_lines(reply)
    assert line["text"] == "Couldn’t run the tests — passed on without a result"
    assert line["tone"] == "warn"
    assert line["refs"]["output_tail"] == ["Couldn't run the tests: the sandbox failed (X)."]


def test_t1_a_running_check_is_working_not_waiting_for_you():
    """The run graph and Home read a node's live state from node_live: Tvashtr running the tests
    is work, not a gate waiting for a person (a human gate still needs you)."""
    from types import SimpleNamespace

    from tvashtr.control_plane import live_state

    inv = SimpleNamespace(id=1, status="running")
    check = live_state.node_live("gate", inv, {}, {"gate_kind": "tests_pass"})
    assert check["live_state"] == "working"
    human = live_state.node_live("gate", inv, {}, {"gate_kind": "prd_approval"})
    assert human["live_state"] == "needs_you"
    assert live_state.node_live("gate", inv, {})["live_state"] == "needs_you"


def test_t1_a_failed_check_names_where_the_walk_sends_it_through_a_rework_loop():
    """Live (run 667351c6): a check wired back to the Engineer as a Rework loop (no `when`, the
    canvas's bounded loop-back) read only "Tests failed" — the line names the walk's own route."""
    eng, chk, rev, _ = _tests_world()
    edges = [
        {"source": str(chk.id), "target": str(rev.id), "edge_type": "work",
         "conditions": {"when": "approved"}},
        {"source": str(chk.id), "target": str(eng.id), "edge_type": "work",
         "conditions": {"loop_limit": 3}},
    ]  # fmt: skip
    reply = _build(
        _run(), [eng, chk, rev],
        [_inv(1, eng, end=60), _inv(2, chk, start=61, end=90, outcome="rejected", detail="E1\nE2")],
        edges=edges,
    )  # fmt: skip
    (line,) = _check_lines(reply)
    assert line["text"] == "Tests failed — back to Engineer with the last 2 lines"
