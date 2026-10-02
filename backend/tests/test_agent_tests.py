"""M7 — agent tests (contract ``docs/superpowers/plans/api/agent-tests.md``; rulings R6 R7 R12):
a test is one saved round of one agent (what it got + checks); Run all replays ONLY that agent, once
per test, on its saved input with its current setup, from a workspace rebuilt from the M3 checkpoint
before the round; Must say / Must not say / Must name a file / AI check (on Tvashtr's key, 200 a
month, "Not available yet" without one); tests from a CSV / JSON-lines file; Check the AI check;
Save as vN offers to run the changed agents' tests; replays count toward the owner's concurrent
runs only. Offline: the agent is a fake adapter, the AI check a fake gateway."""

import json
import subprocess
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from home_fixtures import clone_node, fresh_account, library_team, make_run
from pydantic import SecretStr
from sqlalchemy import select, text

from tvashtr import gateway
from tvashtr.config import get_settings
from tvashtr.control_plane import agent_test_runner, agent_tests, checkpoints, fly_reaper
from tvashtr.control_plane.node_library import owner_for_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.team_run import _write_workspace_gitignore
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult, EngineEvent
from tvashtr.gateway import CompletionResult
from tvashtr.models import (
    AgentInvocation,
    AgentTest,
    AgentTestResult,
    AgentTestRun,
    Document,
    DocumentVersion,
    Run,
    RunCheckpoint,
    RunEvent,
)

IDEA = "Add an RSI indicator"
SPEC = "# RSI\nRegister rsi on INDICATORS so the builder can list it."
MODEL = "openai/gpt-4.1"


# ------------------------------------------------------------------------------------ builders


def _graph(c, team: str) -> dict:
    resp = c.get(f"/api/teams/{team}/graph")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _node(c, team: str, role: str) -> dict:
    return next(n for n in _graph(c, team)["nodes"] if n["role_name"] == role)


def _account(prefix="at"):
    c, owner = fresh_account(prefix)
    resp = c.post("/api/providers", json={"provider": "openai", "api_key": "sk-test-1"})
    assert resp.status_code in (200, 201), resp.text
    team = library_team(c)
    for role in ("reviewer", "engineer"):
        node = _node(c, team, role)
        resp = c.patch(f"/api/teams/{team}/nodes/{node['id']}", json={"model": MODEL})
        assert resp.status_code == 200, resp.text
    return c, owner, team


def _workspace(tmp_path: Path, name: str) -> str:
    ws = tmp_path / name
    ws.mkdir()
    init_workspace_repo(str(ws))
    _write_workspace_gitignore(str(ws))
    return str(ws)


def _inv(run_id, node_id, iteration, *, status="done", outcome=None, detail=None, manifest=None):
    with session_scope() as session:
        inv = AgentInvocation(
            run_id=run_id,
            node_id=uuid.UUID(node_id),
            iteration=iteration,
            status=status,
            outcome=outcome,
            outcome_detail=detail,
            context_manifest=manifest,
            ended_at=datetime.now(UTC),
        )
        session.add(inv)
        session.flush()
        return inv.id


def _cp(run_id, inv_id, node_id, iteration, ws, feedback=None):
    cp = checkpoints.capture(ws)
    with session_scope() as session:
        session.add(
            RunCheckpoint(
                run_id=uuid.UUID(run_id),
                invocation_id=inv_id,
                node_id=uuid.UUID(node_id),
                iteration=iteration,
                base_sha=cp["base_sha"],
                diff=cp["diff"],
                too_large=False,
                state={"iters_by_node": {}, "reviewer_feedback": feedback, "pm_document_id": None},
            )
        )


def _run_with_rounds(c, owner, team, tmp_path, *, checkpointed=True) -> dict:
    """A finished review-loop run: PM, Engineer 1, Reviewer 1 (changes requested), Engineer 2,
    Reviewer 2 (approved) — each with its M3 checkpoint (unless ``checkpointed`` is False)."""
    run_id, clone = make_run(owner, team, status="completed", idea=IDEA)
    pm, eng, rev = (clone_node(clone, r) for r in ("pm", "engineer", "reviewer"))
    with session_scope() as session:
        doc = Document(title="Spec", doc_type="prd", run_id=uuid.UUID(run_id), name="spec")
        session.add(doc)
        session.flush()
        session.add(
            DocumentVersion(
                document_id=doc.id,
                version_no=1,
                content=SPEC,
                created_by="pm",
                idempotency_key=f"{run_id}:pm-prd-v1",
            )
        )
        session.get(Run, uuid.UUID(run_id)).pm_document_id = doc.id
        doc_id = str(doc.id)
    read = {
        "documents": [
            {"name": "spec", "document_id": doc_id, "version_no": 1, "is_shared_spec": True}
        ]
    }
    ws = _workspace(tmp_path, f"ws-{run_id}")
    ids = {}
    ids["pm"] = _inv(run_id, pm, 1, outcome="prd_written")
    if checkpointed:
        _cp(run_id, ids["pm"], pm, 1, ws)
    (Path(ws) / "core").mkdir()
    (Path(ws) / "core" / "rsi.py").write_text("def rsi(prices):\n    return 50\n")
    ids["eng1"] = _inv(run_id, eng, 1, outcome="built", manifest=read)
    if checkpointed:
        _cp(run_id, ids["eng1"], eng, 1, ws)
    ids["rev1"] = _inv(
        run_id,
        rev,
        1,
        outcome="changes_requested",
        detail="rsi isn't registered on INDICATORS",
        manifest=read,
    )
    with session_scope() as session:
        session.add(
            RunEvent(
                run_id=run_id,
                invocation_id=ids["rev1"],
                seq=0,
                kind="observation",
                payload={
                    "tool_name": "terminal",
                    "observation": "== 3 failed, 38 passed in 1.2s ==",
                },
            )
        )
    if checkpointed:
        _cp(run_id, ids["rev1"], rev, 1, ws, feedback="rsi isn't registered on INDICATORS")
    (Path(ws) / "core" / "rsi.py").write_text("def rsi(prices):\n    return 51\n")
    ids["eng2"] = _inv(run_id, eng, 2, outcome="built", manifest=read)
    if checkpointed:
        _cp(run_id, ids["eng2"], eng, 2, ws)
    ids["rev2"] = _inv(run_id, rev, 2, outcome="approved", manifest=read)
    if checkpointed:
        _cp(run_id, ids["rev2"], rev, 2, ws)
    return {"run_id": run_id, "clone": clone, "ids": ids}


class FakeAdapter:
    """The agent: records each task and the workspace it got, answers with a verdict."""

    name = "fake"

    def __init__(self, verdict="changes_requested", reasons="register rsi in core/rsi.py"):
        self.verdict, self.reasons = verdict, reasons
        self.tasks: list = []
        self.trees: list[dict] = []

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        self.tasks.append(task)
        self.trees.append(
            {
                str(p.relative_to(ws)): p.read_text(errors="replace")
                for p in ws.rglob("*")
                if p.is_file() and ".git" not in p.relative_to(ws).parts
            }
        )
        (ws / "REVIEW_VERDICT.json").write_text(
            json.dumps({"verdict": self.verdict, "reasons": self.reasons})
        )
        return AgentRunResult(
            status="completed",
            summary="",
            events=[
                EngineEvent(seq=0, kind="message", payload={"source": "agent", "content": "hi"})
            ],
            files_changed=[],
            prompt_tokens=10,
            completion_tokens=5,
            total_tokens=15,
            cost_usd=0.02,
        )


@pytest.fixture
def inline(monkeypatch):
    """Run the test worker inline, with the fake agent; returns the adapter."""
    adapter = FakeAdapter()
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: target(*a))
    monkeypatch.setattr(agent_test_runner, "resolve_adapter", lambda name: adapter)
    return adapter


def _ai(monkeypatch, *, key="tv-checks-key", answer="YES\nIt names the file."):
    settings = get_settings()
    monkeypatch.setattr(settings, "checks_api_key", SecretStr(key))
    calls: list = []

    def fake(request):
        calls.append(request)
        return CompletionResult(
            text=answer,
            model_requested=request.model,
            model_used=request.model,
            prompt_tokens=1,
            completion_tokens=1,
            total_tokens=2,
            cost_usd=0.0001,
            raw_provider="openai",
            latency_ms=1.0,
        )

    monkeypatch.setattr(gateway, "complete", fake)
    return calls


def _create(c, team, node_id, inv_id, *checks, name="Catches an unregistered indicator"):
    resp = c.post(
        f"/api/teams/{team}/nodes/{node_id}/tests",
        json={"invocation_id": inv_id, "name": name, "checks": list(checks)},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["test"]


def _tests(c, team, node_id) -> dict:
    resp = c.get(f"/api/teams/{team}/nodes/{node_id}/tests")
    assert resp.status_code == 200, resp.text
    return resp.json()


SAY = {"kind": "must_say", "value": "Changes requested", "from_round": True}


# ------------------------------------------------------------------------------------- schema


def test_migration_0048_adds_the_four_tables():
    with session_scope() as session:
        tables = set(
            session.execute(
                text(
                    "select table_name from information_schema.tables where table_name in "
                    "('agent_tests', 'agent_test_runs', 'agent_test_results', 'ai_check_usage')"
                )
            ).scalars()
        )
    assert tables == {"agent_tests", "agent_test_runs", "agent_test_results", "ai_check_usage"}


# ----------------------------------------------------------------------- make a test from a round


def test_a_round_says_whether_it_can_be_a_test(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    resp = c.get(f"/api/teams/{team}/nodes/{rev['id']}/runs", params={"run_id": made["run_id"]})
    assert resp.status_code == 200, resp.text
    rounds = resp.json()["run"]["rounds"]
    assert [r["test_blocked"] for r in rounds] == [None, None]


def test_a_round_after_one_without_a_checkpoint_cant_be_a_test(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path, checkpointed=False)
    rev = _node(c, team, "reviewer")
    rounds = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/runs", params={"run_id": made["run_id"]}
    ).json()["run"]["rounds"]
    cant = "Can’t make a test from this round (it ran before checkpoints)"
    assert {r["test_blocked"] for r in rounds} == {cant}
    resp = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/from-round",
        params={"invocation_id": made["ids"]["rev1"]},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == cant


def test_a_round_that_didnt_finish_cant_be_a_test(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    failed = _inv(made["run_id"], clone_node(made["clone"], "reviewer"), 3, status="failed")
    resp = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/from-round", params={"invocation_id": failed}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Can’t make a test from this round (it didn’t finish)"


def test_the_new_test_dialog_shows_what_the_round_got(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    resp = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/from-round",
        params={"invocation_id": made["ids"]["rev1"]},
    )
    assert resp.status_code == 200, resp.text
    draft = resp.json()
    assert draft["role"] == "Reviewer"
    assert draft["run_number"] == 1 and draft["iteration"] == 1
    assert draft["answered"] == "Changes requested"
    assert draft["gets"] == {
        "task": IDEA,
        "documents": [{"name": "spec", "version_no": 1, "pages": 1, "is_shared_spec": True}],
        "change": [{"path": "core/rsi.py", "added": 2, "removed": 0}],
        "test_output": "3 failed, 38 passed",
        "feedback": False,
    }
    assert draft["checks"] == [SAY]
    assert draft["ai"] == {"available": False, "left": 200, "limit": 200}


def test_save_a_test_keeps_a_copy_of_what_it_got(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    eng = _node(c, team, "engineer")
    test = _create(
        c,
        team,
        eng["id"],
        made["ids"]["eng2"],
        {"kind": "must_name_file", "value": "core/rsi.py"},
        name="  Fixes the registry  ",
    )
    assert test["name"] == "Fixes the registry"
    assert test["meta"] == "From run #1 · round 2 · 1 check"
    assert test["gets"]["feedback"] is True  # round 2 got the Reviewer's reasons
    with session_scope() as session:
        row = session.get(AgentTest, uuid.UUID(test["id"]))
        assert row.inputs["feedback"] == "rsi isn't registered on INDICATORS"
        assert row.inputs["documents"][0]["content"] == SPEC
        assert row.inputs["base"] == {"kind": "empty"}
        diff = session.execute(select(AgentTest.diff).where(AgentTest.id == row.id)).scalar()
    assert b"return 50" in diff  # the workspace after Reviewer round 1 (= Engineer round 1)
    node = _node(c, team, "engineer")
    assert node["tests"] == {
        "total": 1,
        "passed": None,
        "ran": None,
        "stopped": False,
        "running": None,
    }


def test_saving_a_test_needs_a_name_and_a_check(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    url = f"/api/teams/{team}/nodes/{rev['id']}/tests"
    inv = made["ids"]["rev1"]
    no_checks = c.post(url, json={"invocation_id": inv, "name": "x", "checks": []})
    assert no_checks.status_code == 422
    assert no_checks.json()["detail"] == "Add at least one check"
    blank = c.post(url, json={"invocation_id": inv, "name": " ", "checks": [SAY]})
    assert blank.json()["detail"] == "Give the test a name"
    empty_value = c.post(
        url, json={"invocation_id": inv, "name": "x", "checks": [{"kind": "ai", "value": " "}]}
    )
    assert empty_value.json()["detail"] == "Fill in the AI check check"


def test_a_round_of_another_agent_is_not_found(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    eng = _node(c, team, "engineer")
    resp = c.get(
        f"/api/teams/{team}/nodes/{eng['id']}/tests/from-round",
        params={"invocation_id": made["ids"]["rev1"]},
    )
    assert resp.status_code == 404


# ------------------------------------------------------------------------------------ the checks


def test_each_check_kind():
    def ai(value, answer):
        return (None, "Not available yet")

    out = agent_tests.evaluate(
        [
            {"kind": "must_say", "value": "changes  REQUESTED"},
            {"kind": "must_not_say", "value": "Approved"},
            {"kind": "must_name_file", "value": "./core/rsi.py"},
            {"kind": "must_name_file", "value": "tests/test_rsi.py"},
            {"kind": "ai", "value": "names the line"},
        ],
        "Changes requested: core/rsi.py doesn’t register it",
        ["tests/test_rsi.py"],
        ai,
    )
    assert [o["met"] for o in out] == [True, True, True, True, None]
    assert agent_tests.passed(out)
    bad = agent_tests.evaluate(
        [{"kind": "must_not_say", "value": "doesn't register"}], "it doesn’t register", [], ai
    )
    assert bad == [
        {
            "kind": "must_not_say",
            "value": "doesn't register",
            "met": False,
            "reason": "It said “doesn't register”.",
        }
    ]
    assert not agent_tests.passed(bad)


# --------------------------------------------------------------------------------- run all


def test_run_all_replays_only_this_agent_once_per_test(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    _create(
        c,
        team,
        rev["id"],
        made["ids"]["rev1"],
        {"kind": "must_say", "value": "banana-split"},
        name="Says banana",
    )
    resp = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    assert resp.status_code == 202, resp.text
    # Exactly ONE agent run per test, of the Reviewer, on its saved input.
    assert len(inline.tasks) == 2
    task = inline.tasks[0]
    assert IDEA in task.instruction and "Register rsi on INDICATORS" in task.instruction
    assert task.model == MODEL and task.llm_api_key == "sk-test-1"
    assert task.pull_paths == ("REVIEW_VERDICT.json",)  # a reviewer stays read-only
    assert inline.trees[0]["core/rsi.py"] == "def rsi(prices):\n    return 50\n"
    view = _tests(c, team, rev["id"])
    run = view["run"]
    assert (run["status"], run["total"], run["passed"], run["failed"]) == ("done", 2, 1, 1)
    assert run["version"] == 1
    assert [r["status"] for r in run["results"]] == ["passed", "failed"]
    assert run["results"][1]["answer"] == "Changes requested: register rsi in core/rsi.py"
    assert run["results"][1]["checks"] == [
        {
            "kind": "must_say",
            "value": "banana-split",
            "met": False,
            "reason": "It didn’t say “banana-split”.",
        }
    ]
    assert run["cost_usd"] == pytest.approx(0.04)
    assert view["last"].startswith("Last run on v1 · just now · 1 passed, 1 failed")
    assert view["estimate"] == {"cost_usd": 0.04, "minutes": 1}
    assert _node(c, team, "reviewer")["tests"] == {
        "total": 2,
        "passed": 1,
        "ran": 2,
        "stopped": False,
        "running": None,
    }
    detail = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/results/{run['results'][1]['id']}"
    ).json()
    assert detail["status"] == "failed" and detail["version"] == 1
    assert detail["gets"]["task"] == IDEA


def test_a_worker_replay_rebuilds_the_change_and_gets_the_reviewers_reasons(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    eng = _node(c, team, "engineer")
    _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_name_file", "value": "x.py"})
    c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/run")
    assert len(inline.tasks) == 1
    assert "rsi isn't registered on INDICATORS" in inline.tasks[0].instruction  # the revision
    assert inline.tasks[0].pull_paths is None  # a worker pulls its edits as in a run
    assert inline.trees[0]["core/rsi.py"].endswith("return 50\n")


def test_run_all_refuses_with_no_tests_or_while_running(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    url = f"/api/teams/{team}/nodes/{rev['id']}/tests"
    none = c.post(url + "/run")
    assert none.status_code == 422 and none.json()["detail"] == "Add a test first"
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)  # never starts
    assert c.post(url + "/run").status_code == 202
    again = c.post(url + "/run")
    assert again.status_code == 409 and again.json()["detail"] == "The tests are already running"
    stopped = c.post(url + "/stop").json()["run"]
    assert stopped["status"] == "stopped"
    assert [r["status"] for r in stopped["results"]] == ["stopped"]


def test_a_run_whose_worker_went_quiet_reads_as_failed(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    with session_scope() as session:
        session.get(AgentTestRun, uuid.UUID(run["id"])).heartbeat_at = datetime.now(
            UTC
        ) - timedelta(minutes=13)
    view = _tests(c, team, rev["id"])["run"]
    assert view["status"] == "failed"
    assert view["error"] == "Tvashtr restarted while the tests ran. Run them again."


def test_a_replay_with_no_key_for_its_model_fails_with_plain_words(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"model": "xai/grok-4"})
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]
    assert inline.tasks == []
    assert result["status"] == "failed"
    assert result["error"].startswith("There’s no key for xai on your account.")


def test_a_replay_past_ten_minutes_is_stopped(tmp_path, monkeypatch, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    closed = []
    monkeypatch.setattr(agent_test_runner, "REPLAY_CAP_S", 0)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)
    monkeypatch.setattr(agent_test_runner, "close_run_sandboxes", closed.append)
    # The replay ends when it's told to (a sandbox closing under a remote agent ends its run).
    monkeypatch.setattr(agent_test_runner, "replay", lambda rid, cancel: cancel.wait(5) or {})
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]
    assert result["status"] == "failed"
    assert result["error"] == "It took more than 10 minutes, so it was stopped."
    # Its sandbox is closed (again, until the replay has ended), and only its own.
    assert closed and set(closed) == {result["id"]}


def test_a_replay_rebuilds_a_local_repo_at_its_base(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "app.py").write_text("v1\n")
    git = ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t"]
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "base"], check=True)
    base = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()
    (repo / "app.py").write_text("v2\n")
    subprocess.run([*git, "commit", "-qam", "later"], check=True)
    work = tmp_path / "work"
    subprocess.run(["git", "clone", "-q", str(repo), str(work)], check=True)
    subprocess.run(["git", "-C", str(work), "checkout", "-q", base], check=True)
    (work / "new.py").write_text("x = 1\n")
    subprocess.run(["git", "-C", str(work), "add", "-A"], check=True)
    diff = subprocess.run(
        ["git", "-C", str(work), "diff", "--cached", "--binary", base],
        capture_output=True,
        check=True,
    ).stdout
    ws = tmp_path / "parent" / "ws"
    ws.parent.mkdir()
    agent_test_runner._rebuild(
        str(ws), {"kind": "repo", "repo_path": str(repo), "sha": base}, diff, uuid.uuid4(), "m"
    )
    assert (ws / "app.py").read_text() == "v1\n"
    assert (ws / "new.py").read_text() == "x = 1\n"


# ------------------------------------------------------------------------------- the AI check


def test_ai_checks_are_skipped_not_failed_without_a_key(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY, {"kind": "ai", "value": "names a file"})
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]
    assert result["status"] == "passed"
    assert result["checks"][1] == {
        "kind": "ai",
        "value": "names a file",
        "met": None,
        "reason": "Not available yet",
    }


def test_ai_checks_use_tvashtrs_key_never_the_owners(tmp_path, inline, monkeypatch):
    calls = _ai(monkeypatch)
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], {"kind": "ai", "value": "names a file"})
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]
    assert result["status"] == "passed"
    assert result["checks"][0]["met"] is True
    assert [r.api_key for r in calls] == ["tv-checks-key"]
    assert calls[0].model == get_settings().checks_model
    assert _tests(c, team, rev["id"])["ai"] == {"available": True, "left": 199, "limit": 200}


def test_ai_checks_stop_at_the_monthly_limit(monkeypatch):
    calls = _ai(monkeypatch)
    monkeypatch.setattr(get_settings(), "checks_monthly_limit", 2)
    _c, owner = fresh_account("ai")
    got = [agent_tests.ai_check(owner, "names a file", "core/rsi.py") for _ in range(3)]
    assert got[:2] == [(True, "It names the file.")] * 2
    assert got[2] == (None, "No AI checks left this month")
    assert len(calls) == 2
    assert agent_tests.ai_status(owner)["left"] == 0


# ----------------------------------------------------------------------- tests from a file

CSV = (
    "task,diff,expected,file,notes\n"
    "Add an EMA indicator,core/indicators.py +22,Changes requested,core/indicators.py,march\n"
    "Add a MACD,,Approved,,\n"
    ",,Approved,,empty task\n"
)


def test_a_csv_is_mapped_by_its_column_names(tmp_path):
    c, owner, team = _account()
    rev = _node(c, team, "reviewer")
    resp = c.post(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/file/check",
        json={"filename": "reviewer-examples.csv", "content": CSV},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rows"] == 3
    assert [(col["name"], col["use"]) for col in body["columns"]] == [
        ("task", "gets"),
        ("diff", "gets"),
        ("expected", "must_say"),
        ("file", "must_name_file"),
        ("notes", "skip"),
    ]
    assert body["columns"][0]["first"] == "Add an EMA indicator"
    assert body["ready"] == {"tests": 2, "must_say": 2, "must_name_file": 1}
    remapped = c.post(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/file/check",
        json={
            "filename": "reviewer-examples.csv",
            "content": CSV,
            "mapping": {"task": "gets", "expected": "skip", "file": "must_name_file"},
        },
    ).json()
    assert remapped["ready"] == {"tests": 1, "must_say": 0, "must_name_file": 1}
    added = c.post(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/file",
        json={
            "filename": "reviewer-examples.csv",
            "content": CSV,
            "mapping": {c_["name"]: c_["use"] for c_ in body["columns"]},
        },
    )
    assert added.status_code == 201 and added.json() == {"added": 2}
    tests = _tests(c, team, rev["id"])["tests"]
    assert [t["meta"] for t in tests] == [
        "From a file · row 1 · 2 checks",
        "From a file · row 2 · 1 check",
    ]
    assert tests[0]["gets"]["task"] == "Add an EMA indicator\n\ndiff:\ncore/indicators.py +22"
    with session_scope() as session:
        row = session.get(AgentTest, uuid.UUID(tests[0]["id"]))
        assert row.inputs["task"] == "Add an EMA indicator\n\ndiff:\ncore/indicators.py +22"


def test_a_bad_file_says_what_is_wrong(tmp_path):
    c, owner, team = _account()
    rev = _node(c, team, "reviewer")
    url = f"/api/teams/{team}/nodes/{rev['id']}/tests/file/check"
    bad = c.post(url, json={"filename": "x.jsonl", "content": '{"task": "a"}\n{"task": "b"}\nnope'})
    assert bad.status_code == 422
    assert bad.json()["detail"] == "This file can’t be read: line 3 isn’t valid JSON."
    jsonl = c.post(
        url, json={"filename": "x.jsonl", "content": '{"task": "a", "expected": "Approved"}\n'}
    ).json()
    assert jsonl["ready"]["tests"] == 1
    no_gets = c.post(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/file",
        json={"filename": "x.csv", "content": CSV, "mapping": {"task": "skip"}},
    )
    assert no_gets.status_code == 422
    assert no_gets.json()["detail"] == "Pick a column for What the agent gets."


# --------------------------------------------------------------------- Check the AI check


def test_check_the_ai_check_is_trusted_at_eight_of_ten(tmp_path, monkeypatch):
    calls = _ai(monkeypatch)
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    test = _create(c, team, rev["id"], made["ids"]["rev1"], SAY, {"kind": "ai", "value": "file"})
    answers = c.get(f"/api/teams/{team}/nodes/{rev['id']}/tests/{test['id']}/answers").json()
    assert {
        "text": "Changes requested: rsi isn't registered on INDICATORS",
        "from": "Run #1 · round 1",
    } in answers["answers"]
    labels = [{"answer": f"answer {i}", "you": i != 9} for i in range(10)]
    url = f"/api/teams/{team}/nodes/{rev['id']}/tests/{test['id']}/judge"
    out = c.post(url, json={"check": 1, "labels": labels}).json()
    assert (out["agree"], out["total"], out["trusted"]) == (9, 10, True)
    assert len(calls) == 10
    again = c.post(url, json={"check": 1, "labels": labels}).json()
    assert again["agree"] == 9 and len(calls) == 10  # judged answers aren't checked twice
    listed = _tests(c, team, rev["id"])["tests"][0]["checks"][1]
    assert listed["judge"] == {"agree": 9, "total": 10, "trusted": True}
    not_ai = c.post(url, json={"check": 0, "labels": labels})
    assert not_ai.status_code == 422


def test_check_the_ai_check_needs_the_server_key(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    test = _create(c, team, rev["id"], made["ids"]["rev1"], {"kind": "ai", "value": "file"})
    resp = c.post(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/{test['id']}/judge",
        json={"check": 0, "labels": [{"answer": "a", "you": True}]},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "AI checks aren’t available yet"


# ------------------------------------------------------------- R12, the reaper, the replay's owner


def test_replays_count_toward_the_owners_concurrent_runs_only(tmp_path, monkeypatch):
    from fastapi import HTTPException

    from tvashtr.routers import _enforce_run_ceilings

    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    result_id = uuid.UUID(run["results"][0]["id"])
    settings = get_settings()
    monkeypatch.setattr(settings, "hosted_mode", True)
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 1)
    assert agent_test_runner._take_slot(uuid.UUID(run["id"]), result_id) is True
    with session_scope() as session:
        assert agent_test_runner.replays_in_flight(session, owner) == 1
    with pytest.raises(HTTPException) as refused:
        _enforce_run_ceilings(owner)
    assert refused.value.status_code == 429
    # ... and the fleet cap doesn't count it.
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 10_000)
    _enforce_run_ceilings(owner)
    # A second replay waits for the slot.
    monkeypatch.setattr(settings, "hosted_max_concurrent_runs_per_owner", 1)
    with session_scope() as session:
        other = AgentTestResult(
            test_run_id=uuid.UUID(run["id"]), position=1, name="b", status="waiting"
        )
        session.add(other)
        session.flush()
        other_id = other.id
    assert agent_test_runner._take_slot(uuid.UUID(run["id"]), other_id) is False
    assert _tests(c, team, rev["id"])["run"]["waiting_for_slot"] is True


def test_the_fly_reaper_spares_a_running_replay_and_tools_resolve_its_owner(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    result_id = run["results"][0]["id"]
    assert fly_reaper._live_run_ids([result_id]) == set()  # waiting: no sandbox yet
    agent_test_runner._take_slot(uuid.UUID(run["id"]), uuid.UUID(result_id))
    assert fly_reaper._live_run_ids([result_id]) == {result_id}
    assert owner_for_run(result_id) == owner


# ------------------------------------------------------------------------ R6: Save as vN


def test_save_as_vn_offers_and_runs_the_changed_agents_tests(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    _create(c, team, rev["id"], made["ids"]["rev2"], {"kind": "must_say", "value": "Approved"})
    listing = c.get(f"/api/teams/{team}/versions").json()
    assert listing["tests"] is None  # nothing changed yet
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"prompt": "Be strict about files."})
    offer = c.get(f"/api/teams/{team}/versions").json()["tests"]
    assert offer["count"] == 2
    assert offer["agents"] == [{"node_id": rev["id"], "name": "Reviewer", "count": 2}]
    assert offer["sub"] == "You changed the Reviewer’s instructions. The Reviewer has 2 tests."
    assert offer["option"] == "Save and run the Reviewer’s 2 tests"
    started = []
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: started.append(a))
    saved = c.post(f"/api/teams/{team}/versions", json={"run_tests": True})
    assert saved.status_code == 201, saved.text
    body = saved.json()
    assert body["number"] == 2
    assert [s["node_id"] for s in body["tests_started"]] == [rev["id"]]
    assert len(started) == 1
    run = _tests(c, team, rev["id"])["run"]
    assert (run["version"], run["trigger"], run["total"]) == (2, "save", 2)
    history = c.get(f"/api/teams/{team}/versions").json()["versions"]
    assert history[0]["tests"] == {"passed": 0, "total": 2, "running": True}
    assert history[1]["tests"] is None


def test_save_as_vn_without_run_tests_starts_nothing(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.get(f"/api/teams/{team}/versions")  # v1 = the team as it was (M5's lazy first version)
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"prompt": "Be strict."})
    started = []
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: started.append(a))
    body = c.post(f"/api/teams/{team}/versions", json={}).json()
    assert body["tests_started"] == [] and started == []


def test_since_compares_with_the_last_run_on_an_older_version(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    _create(c, team, rev["id"], made["ids"]["rev2"], {"kind": "must_say", "value": "Approved"})
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    assert _tests(c, team, rev["id"])["run"]["since"] is None
    c.get(f"/api/teams/{team}/versions")
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"prompt": "Approve it."})
    c.post(f"/api/teams/{team}/versions", json={})
    inline.verdict, inline.reasons = "approved", None
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    run = _tests(c, team, rev["id"])["run"]
    assert run["version"] == 2 and run["passed"] == 1
    assert run["since"] == {"version": 1, "delta": 0}


def test_deleting_a_test_keeps_its_past_results(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    test = _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    resp = c.delete(f"/api/teams/{team}/nodes/{rev['id']}/tests/{test['id']}")
    assert resp.status_code == 204
    view = _tests(c, team, rev["id"])
    assert view["tests"] == []
    assert view["run"]["results"][0]["name"] == "Catches an unregistered indicator"
    assert view["run"]["results"][0]["test_id"] is None
    assert _node(c, team, "reviewer")["tests"] is None


# -------------------------------------------------------------------------- owner scope


ROUTES = [
    ("GET", "/tests", None),
    ("GET", "/tests/from-round?invocation_id={inv}", None),
    ("POST", "/tests", "create"),
    ("DELETE", "/tests/{test}", None),
    ("POST", "/tests/file/check", "file"),
    ("POST", "/tests/file", "file"),
    ("POST", "/tests/run", None),
    ("POST", "/tests/stop", None),
    ("GET", "/tests/results/{result}", None),
    ("GET", "/tests/{test}/answers", None),
    ("POST", "/tests/{test}/judge", "judge"),
]


@pytest.mark.parametrize(("method", "path", "body"), ROUTES, ids=[f"{m} {p}" for m, p, _ in ROUTES])
def test_agent_tests_are_owner_scoped(tmp_path, inline, method, path, body):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    test = _create(c, team, rev["id"], made["ids"]["rev1"], SAY, {"kind": "ai", "value": "x"})
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]["id"]
    payload = {
        None: None,
        "create": {"invocation_id": made["ids"]["rev1"], "name": "x", "checks": [SAY]},
        "file": {
            "filename": "x.csv",
            "content": CSV,
            "mapping": {"task": "gets", "expected": "must_say"},
        },
        "judge": {"check": 1, "labels": [{"answer": "a", "you": True}]},
    }[body]
    url = f"/api/teams/{team}/nodes/{rev['id']}" + path.format(
        inv=made["ids"]["rev1"], test=test["id"], result=result
    )
    other, _ = fresh_account("at-other")
    resp = other.request(method, url, json=payload)
    assert resp.status_code == 404, (method, path, resp.status_code, resp.text)
    # B's own agent with A's test / replay id is a 404 too.
    if "{test}" in path or "{result}" in path or "{inv}" in path:
        b_team = library_team(other)
        b_rev = _node(other, b_team, "reviewer")
        b_url = f"/api/teams/{b_team}/nodes/{b_rev['id']}" + path.format(
            inv=made["ids"]["rev1"], test=test["id"], result=result
        )
        assert other.request(method, b_url, json=payload).status_code == 404
    # A is unchanged.
    assert len(_tests(c, team, rev["id"])["tests"]) == 1


def test_replays_cost_shows_in_the_owners_spend(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    before = c.get("/api/spend").json()
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    after = c.get("/api/spend").json()
    assert after["month"]["total_usd"] == pytest.approx(before["month"]["total_usd"] + 0.02)
    assert after["week"]["total_usd"] == pytest.approx(before["week"]["total_usd"] + 0.02)
    assert [(t["team_id"], t["total_usd"]) for t in after["by_team"]] == [
        (team, pytest.approx(0.02))
    ]


def test_an_ai_check_that_never_answered_doesnt_count(monkeypatch):
    _ai(monkeypatch)

    def broken(request):
        raise gateway.GatewayError("provider down")

    monkeypatch.setattr(gateway, "complete", broken)
    _c, owner = fresh_account("ai")
    assert agent_tests.ai_check(owner, "names a file", "x") == (
        None,
        "The AI check couldn’t answer, so it was skipped",
    )
    assert agent_tests.ai_status(owner)["left"] == 200


# ------------------------------------------------- review fixes (M7 backend review, test-first)


class PullAllAdapter(FakeAdapter):
    """Like the Fly/Docker adapters with an unscoped pull: every file comes back "changed"."""

    def __init__(self, write: dict | None = None, verdict_file=True, **kw):
        super().__init__(**kw)
        self.write, self.verdict_file = write or {}, verdict_file

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        for rel, body in self.write.items():
            (ws / rel).parent.mkdir(parents=True, exist_ok=True)
            (ws / rel).write_text(body)
        out = super().run(task, on_event)
        if not self.verdict_file:
            (ws / "REVIEW_VERDICT.json").unlink()
        every = [
            str(p.relative_to(ws)) for p in ws.rglob("*") if p.is_file() and ".git" not in p.parts
        ]
        return AgentRunResult(**{**out.__dict__, "files_changed": every})


def _use(monkeypatch, adapter):
    monkeypatch.setattr(agent_test_runner, "resolve_adapter", lambda name: adapter)


def test_a_replays_files_are_the_ones_it_changed_not_the_whole_pull(tmp_path, inline, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    eng = _node(c, team, "engineer")
    _create(
        c, team, eng["id"], made["ids"]["eng2"], {"kind": "must_name_file", "value": "core/rsi.py"}
    )
    _use(monkeypatch, PullAllAdapter(write={"tests/test_rsi.py": "def test(): pass\n"}))
    c.post(f"/api/teams/{team}/nodes/{eng['id']}/tests/run")
    result = _tests(c, team, eng["id"])["run"]["results"][0]
    assert result["files"] == ["tests/test_rsi.py"]
    assert result["status"] == "failed"  # it never touched core/rsi.py


def test_a_reviewer_replay_with_no_verdict_fails(tmp_path, inline, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    _use(monkeypatch, PullAllAdapter(verdict_file=False))
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    result = _tests(c, team, rev["id"])["run"]["results"][0]
    assert result["status"] == "failed"
    assert result["error"] == "It gave no verdict, so its checks didn’t run."


def test_connector_and_domains_tokens_work_while_a_replay_runs(tmp_path, monkeypatch):
    from connector_helpers import add_connection

    from tvashtr.control_plane.connector_proxy import read_run_token, sign_run_token
    from tvashtr.control_plane.node_tools import read_domains_token, sign_domains_token

    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    rid = run["results"][0]["id"]
    conn = add_connection(owner)
    token = sign_run_token(rid, rev["id"], conn, "read")
    dtoken = sign_domains_token(rid, rev["id"], None)
    assert read_run_token(token) is None and read_domains_token(dtoken) is None  # not started
    agent_test_runner._take_slot(uuid.UUID(run["id"]), uuid.UUID(rid))
    assert read_run_token(token).run_id == rid
    assert read_domains_token(dtoken) == (owner, None)
    other, other_owner = fresh_account("at-tok")
    assert read_run_token(sign_run_token(rid, None, add_connection(other_owner), "read")) is None
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/stop")
    with session_scope() as session:
        session.get(AgentTestResult, uuid.UUID(rid)).status = "failed"
    assert read_run_token(token) is None and read_domains_token(dtoken) is None


def test_a_round_of_a_desktop_folder_run_cant_be_a_test(tmp_path):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    repo = tmp_path / "clone"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    with session_scope() as session:
        run = session.get(Run, uuid.UUID(made["run_id"]))
        run.repo_path, run.local_snapshot_id = str(repo), uuid.uuid4()
    rev = _node(c, team, "reviewer")
    resp = c.get(
        f"/api/teams/{team}/nodes/{rev['id']}/tests/from-round",
        params={"invocation_id": made["ids"]["rev1"]},
    )
    assert resp.status_code == 409
    assert (
        resp.json()["detail"]
        == "Can’t make a test from this round (its folder was on your computer)"
    )


def test_a_stopped_or_capped_replay_still_records_its_cost_and_its_slot(
    tmp_path, monkeypatch, inline
):
    import threading

    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)
    started, capped = threading.Event(), threading.Event()
    # The cap fires once the agent is running (as ten minutes into it would).
    monkeypatch.setattr(
        agent_test_runner, "_over_cap", lambda began: started.is_set() and not capped.set()
    )
    seen_running = []

    class Slow(FakeAdapter):
        def run(self, task, on_event=None):
            started.set()
            capped.wait(5)
            with session_scope() as session:  # the cap has fired: its slot is still held
                seen_running.append(agent_test_runner.replays_in_flight(session, owner))
            return super().run(task, on_event)

    _use(monkeypatch, Slow())
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    run = _tests(c, team, rev["id"])["run"]
    assert run["results"][0]["error"] == "It took more than 10 minutes, so it was stopped."
    assert run["results"][0]["cost_usd"] == pytest.approx(0.02)
    assert run["cost_usd"] == pytest.approx(0.02)
    assert seen_running == [1]


def test_a_replay_stopped_before_its_agent_starts_never_starts_it(tmp_path, monkeypatch, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    real = agent_test_runner._rebuild

    def rebuild_then_stop(ws, base, diff, owner_id, marker):
        real(ws, base, diff, owner_id, marker)
        c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/stop")

    monkeypatch.setattr(agent_test_runner, "_rebuild", rebuild_then_stop)
    monkeypatch.setattr(agent_test_runner, "_POLL_S", 0.05)
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    run = _tests(c, team, rev["id"])["run"]
    assert inline.tasks == []
    assert (run["status"], run["results"][0]["status"]) == ("stopped", "stopped")


def test_a_slot_freed_after_stop_doesnt_start_a_stopped_test(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/stop")
    rid = uuid.UUID(run["results"][0]["id"])
    assert agent_test_runner._take_slot(uuid.UUID(run["id"]), rid) is None
    assert _tests(c, team, rev["id"])["run"]["results"][0]["status"] == "stopped"


def test_a_quiet_run_isnt_shown_as_testing(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    assert _node(c, team, "reviewer")["tests"]["running"] == {"done": 0, "total": 1}
    with session_scope() as session:
        session.get(AgentTestRun, uuid.UUID(run["id"])).heartbeat_at = datetime.now(
            UTC
        ) - timedelta(minutes=13)
    assert _node(c, team, "reviewer")["tests"]["running"] is None
    rows = c.get(f"/api/teams/{team}/versions").json()["versions"]
    assert rows[0]["tests"]["running"] is False


def test_run_all_with_unsaved_changes_to_the_agent_has_no_version(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.get(f"/api/teams/{team}/versions")
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"prompt": "Be strict."})
    monkeypatch.setattr(agent_test_runner, "_spawn", lambda target, *a: None)
    run = c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]
    assert run["version"] is None
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/stop")
    c.post(f"/api/teams/{team}/versions", json={})
    assert c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run").json()["run"]["version"] == 2


def test_a_verdict_check_reads_the_verdict_and_file_names_match_whole():
    def ai(value, answer):
        return (None, None)

    answer = "Changes requested: this can't be approved until data.py registers RSI"
    out = agent_tests.evaluate(
        [
            {"kind": "must_say", "value": "Approved"},
            {"kind": "must_not_say", "value": "Approved"},
            {"kind": "must_say", "value": "changes requested"},
            {"kind": "must_name_file", "value": "a.py"},
            {"kind": "must_name_file", "value": "data.py"},
        ],
        answer,
        [],
        ai,
    )
    assert [o["met"] for o in out] == [False, True, True, False, True]


def test_answers_to_label_are_what_the_rounds_answered_newest_first(tmp_path, monkeypatch, inline):
    _ai(monkeypatch)
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    eng = _node(c, team, "engineer")
    with session_scope() as session:
        session.get(
            AgentInvocation, made["ids"]["eng1"]
        ).outcome_detail = "Built the feature — changed 1 file(s): core/rsi.py"
        session.add(
            RunEvent(
                run_id=made["run_id"],
                invocation_id=made["ids"]["eng1"],
                seq=0,
                kind="action",
                payload={"tool_name": "finish", "message": "Added rsi() to core/rsi.py."},
            )
        )
    test = _create(c, team, eng["id"], made["ids"]["eng2"], {"kind": "ai", "value": "names a file"})
    texts = [
        a["text"]
        for a in c.get(f"/api/teams/{team}/nodes/{eng['id']}/tests/{test['id']}/answers").json()[
            "answers"
        ]
    ]
    assert "Added rsi() to core/rsi.py." in texts
    assert not any(t.startswith("Built the feature") for t in texts)


def test_a_repo_symlink_out_of_the_workspace_is_dropped(tmp_path):
    secret = tmp_path / "secret.txt"
    secret.write_text("DATABASE_URL=postgres://s3cret\n")
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (repo / "REPORT.md").symlink_to(secret)
    (repo / "inside.md").write_text("ok\n")
    (repo / "link.md").symlink_to("inside.md")
    git = ["git", "-C", str(repo), "-c", "user.email=t@t", "-c", "user.name=t"]
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-qm", "base"], check=True)
    sha = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()
    ws = tmp_path / "p" / "ws"
    ws.parent.mkdir()
    agent_test_runner._rebuild(
        str(ws), {"kind": "repo", "repo_path": str(repo), "sha": sha}, None, uuid.uuid4(), "m"
    )
    assert not (ws / "REPORT.md").exists() and not (ws / "REPORT.md").is_symlink()
    assert (ws / "link.md").read_text() == "ok\n"  # a link inside the workspace stays
    result = AgentRunResult(status="completed", summary="", events=[], files_changed=[])
    (ws / "REPORT.md").symlink_to(secret)  # one the agent made
    assert "s3cret" not in agent_test_runner._answer(False, str(ws), result, "REPORT.md")


def test_deleting_the_agent_keeps_its_replays_in_the_spend(tmp_path, inline):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.post(f"/api/teams/{team}/nodes/{rev['id']}/tests/run")
    before = c.get("/api/spend").json()["month"]["total_usd"]
    assert c.delete(f"/api/teams/{team}/nodes/{rev['id']}").status_code in (200, 204)
    assert c.get("/api/spend").json()["month"]["total_usd"] == pytest.approx(before)


def test_old_replay_workspaces_are_swept(tmp_path, monkeypatch):
    import os
    import tempfile

    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    old = tmp_path / "tvashtr-test-old"
    (old / "ws").mkdir(parents=True)
    fresh = tmp_path / "tvashtr-test-new"
    fresh.mkdir()
    hours_ago = datetime.now(UTC).timestamp() - 3 * 3600
    os.utime(old, (hours_ago, hours_ago))
    agent_test_runner.sweep_workspaces()
    assert not old.exists() and fresh.exists()


def test_save_as_vn_never_fails_on_a_test_run_that_cant_start(tmp_path, monkeypatch):
    c, owner, team = _account()
    made = _run_with_rounds(c, owner, team, tmp_path)
    rev = _node(c, team, "reviewer")
    _create(c, team, rev["id"], made["ids"]["rev1"], SAY)
    c.get(f"/api/teams/{team}/versions")
    c.patch(f"/api/teams/{team}/nodes/{rev['id']}", json={"prompt": "Be strict."})

    def boom(*a, **k):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(agent_test_runner, "start", boom)
    resp = c.post(f"/api/teams/{team}/versions", json={"run_tests": True})
    assert resp.status_code == 201
    assert resp.json()["number"] == 2 and resp.json()["tests_started"] == []
