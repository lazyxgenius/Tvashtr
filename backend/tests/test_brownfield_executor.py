"""Offline executor proof of the brownfield run mode (M-brownfield Slice 1).

A REAL ``run_team`` over the two_node team, launched against a REAL throwaway git repo, with only
the two LLM-touching steps stubbed: ``pm_step`` (the PRD) and the engine adapter (via
``resolve_adapter`` → a fake that edits the worktree file and reports ``completed``). Everything
brownfield is REAL — ``engineer_setup_step`` cuts the isolated worktree, the grounding step builds
the D6 block, the real ``agent_run_step`` appends it + sets ``workspace_mode="brownfield"``, and
``ship_step`` commits onto the real branch. Proves the WIRING without docker/NIM (the live
``brownfield-check`` is
the real-agent proof). Greenfield is unaffected (every branch is gated on ``repo_path``).
"""

import shutil
import subprocess
import uuid
from pathlib import Path

from conftest import seed_pm_prd
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.engines.base import AgentRunResult
from tvashtr.models import AgentInvocation, Run

# The run's workspace root (backend/.tvashtr_workspaces) — computed without importing the openhands
# adapter so cleanup stays cheap; the run's worktree lands at <root>/<run_id>.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


def _git(ws, *args):
    return subprocess.run(["git", "-C", str(ws), *args], check=True, capture_output=True, text=True)


def _init_fixture(path):
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    (path / "calculator.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (path / "CLAUDE.md").write_text("Keep functions tiny.\n", encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


class _FakeAdapter:
    """Stand in for the docker adapter: capture the task the executor built, edit the worktree file
    the way a real agent would, and report success — no LLM, no container."""

    name = "openhands-docker"

    def __init__(self, captured):
        self._captured = captured

    def run(self, task, on_event=None):
        self._captured["instruction"] = task.instruction
        self._captured["workspace_mode"] = task.workspace_mode
        calc = Path(task.workspace_dir) / "calculator.py"
        calc.write_text(
            calc.read_text() + "\n\ndef subtract(a, b):\n    return a - b\n", encoding="utf-8"
        )
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["calculator.py"]
        )


def test_brownfield_run_lands_on_real_branch_offline(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    fixture = _init_fixture(tmp_path / "repo")
    original_head = _git(fixture, "rev-parse", "HEAD").stdout.strip()

    captured: dict = {}
    monkeypatch.setattr(team_run, "pm_step", lambda run_id, idea, m, p: seed_pm_prd(run_id, idea))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _FakeAdapter(captured))

    run_id = str(uuid.uuid4())
    team_graph_id = build_two_node_team()
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea="Add a subtract(a, b) function to calculator.py.",
                workflow_id=run_id,
                status="running",
                repo_path=str(fixture),
                base_ref="main",
            )
        )

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(
                team_run.run_team, "Add a subtract(a, b) function to calculator.py."
            )
        result = handle.get_result()

        assert result["status"] == "completed"
        assert result["ship_branch"] == f"tvashtr/{run_id}"

        # The REAL agent_run_step appended the grounding + flipped the adapter into brownfield mode.
        assert captured["workspace_mode"] == "brownfield"
        assert "REPO GROUNDING" in captured["instruction"]
        assert "CLAUDE.md found" in captured["instruction"]

        # The branch exists in the user's REAL repo and its tip carries the agent's change AND the
        # pre-existing add() (correctness + no regression of the base file).
        branches = _git(fixture, "branch", "--format=%(refname:short)").stdout.split()
        assert f"tvashtr/{run_id}" in branches
        tip_calc = _git(fixture, "show", f"tvashtr/{run_id}:calculator.py").stdout
        assert "def subtract" in tip_calc
        assert "def add" in tip_calc

        # ship_branch recorded on the Run; the user's ORIGINAL branch + working tree are UNTOUCHED.
        with session_scope() as session:
            run = session.execute(select(Run).where(Run.id == uuid.UUID(run_id))).scalar_one()
            assert run.ship_branch == f"tvashtr/{run_id}"
            assert run.repo_path == str(fixture)
        assert _git(fixture, "rev-parse", "main").stdout.strip() == original_head
        assert _git(fixture, "symbolic-ref", "--short", "HEAD").stdout.strip() == "main"
    finally:
        subprocess.run(
            ["git", "-C", str(fixture), "worktree", "remove", "--force", str(workspace)],
            capture_output=True,
            text=True,
        )
        shutil.rmtree(workspace, ignore_errors=True)


def _init_review_fixture(path):
    """A fixture with an EXISTING module + a unittest test, so a worker edits a real module and a
    reviewer has something to gate."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, "init", "-q", "-b", "main")
    _git(path, "config", "user.email", "t@t.local")
    _git(path, "config", "user.name", "tester")
    (path / "calculator.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")
    (path / "test_calculator.py").write_text(
        "import unittest\nfrom calculator import add\n\n\n"
        "class T(unittest.TestCase):\n    def test_add(self):\n"
        "        self.assertEqual(add(2, 3), 5)\n",
        encoding="utf-8",
    )
    (path / "CLAUDE.md").write_text("Keep functions tiny.\n", encoding="utf-8")
    _git(path, "add", "-A")
    _git(path, "commit", "-qm", "init")
    return path


class _ReviewLoopFakeAdapter:
    """Per-node fake for the Slice-3 worker-gating split proof. It captures EACH agent node's built
    instruction keyed by worker-vs-reviewer — branching on a stable substring of the node's prompt
    (a reviewer task's instruction starts with REVIEWER_PROMPT's "You are the Reviewer"; the
    engineer worker does not). The worker EDITS the existing module; the reviewer writes an
    ``approved`` ``REVIEW_VERDICT.json`` (so ``_harvest_verdict`` routes the walk to ship)."""

    name = "openhands-docker"

    def __init__(self, captured):
        self._captured = captured

    def run(self, task, on_event=None):
        ws = Path(task.workspace_dir)
        if "You are the Reviewer" in task.instruction:
            self._captured["reviewer_instruction"] = task.instruction
            self._captured["reviewer_mode"] = task.workspace_mode
            (ws / "REVIEW_VERDICT.json").write_text(
                '{"verdict": "approved", "reasons": "tests pass; subtract present"}',
                encoding="utf-8",
            )
            return AgentRunResult(
                status="completed", summary="reviewed", events=[], files_changed=[]
            )
        # the worker (Engineer): edit the EXISTING module in place.
        self._captured["worker_instruction"] = task.instruction
        self._captured["worker_mode"] = task.workspace_mode
        mod = ws / "calculator.py"
        mod.write_text(
            mod.read_text() + "\n\ndef subtract(a, b):\n    return a - b\n", encoding="utf-8"
        )
        return AgentRunResult(
            status="completed", summary="built", events=[], files_changed=["calculator.py"]
        )


def test_brownfield_review_loop_worker_gets_protocol_reviewer_does_not_offline(
    client, monkeypatch, tmp_path
):
    """The §15 worker-gating split, end to end over a REAL ``run_team`` on the ``review_loop`` team
    against a real throwaway repo (PM stubbed, the adapter faked per-node): the WORKER's instruction
    carries the orientation + the WORKER_PROTOCOL action directives; the REVIEWER's carries the
    orientation but NOT the protocol (it must gate, not implement); both run in brownfield mode; the
    reviewer approves → the run ships to ``tvashtr/<run_id>`` with the user's tree untouched."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    # No TVASHTR_FORCE_REVISIONS — the reviewer runs the (fake) adapter so it harvests a verdict.
    fixture = _init_review_fixture(tmp_path / "repo")
    original_head = _git(fixture, "rev-parse", "HEAD").stdout.strip()

    captured: dict = {}
    monkeypatch.setattr(team_run, "pm_step", lambda run_id, idea, m, p: seed_pm_prd(run_id, idea))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _ReviewLoopFakeAdapter(captured))

    run_id = str(uuid.uuid4())
    team_graph_id = build_review_loop_team()
    idea = "Add a subtract(a, b) function to calculator.py."
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea=idea,
                workflow_id=run_id,
                status="running",
                repo_path=str(fixture),
                base_ref="main",
            )
        )

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, idea)
        result = handle.get_result()
        assert result["status"] == "completed"
        assert result["ship_branch"] == f"tvashtr/{run_id}"

        # THE SPLIT: both nodes ran in brownfield mode and both got the orientation header; only the
        # WORKER got the WORKER_PROTOCOL action directives (`str_replace`), never the reviewer.
        assert captured["worker_mode"] == "brownfield"
        assert captured["reviewer_mode"] == "brownfield"
        assert "REPO GROUNDING" in captured["worker_instruction"]
        assert "REPO GROUNDING" in captured["reviewer_instruction"]
        assert "str_replace" in captured["worker_instruction"]
        assert "str_replace" not in captured["reviewer_instruction"]

        # The reviewer GATED + APPROVED (an AgentInvocation outcome of "approved"), and the run
        # shipped the worker's edit to the real branch.
        with session_scope() as session:
            outcomes = [
                row[0]
                for row in session.execute(
                    select(AgentInvocation.outcome).where(AgentInvocation.run_id == run_id)
                ).all()
            ]
        assert "approved" in outcomes  # the reviewer genuinely approved
        tip_calc = _git(fixture, "show", f"tvashtr/{run_id}:calculator.py").stdout
        assert "def subtract" in tip_calc and "def add" in tip_calc
        # the user's tree is untouched.
        assert _git(fixture, "rev-parse", "main").stdout.strip() == original_head
        assert _git(fixture, "symbolic-ref", "--short", "HEAD").stdout.strip() == "main"
    finally:
        subprocess.run(
            ["git", "-C", str(fixture), "worktree", "remove", "--force", str(workspace)],
            capture_output=True,
            text=True,
        )
        shutil.rmtree(workspace, ignore_errors=True)
