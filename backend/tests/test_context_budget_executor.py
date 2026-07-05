"""M-ctx1 — executor-level proofs (C2 input budget / C3 thinker max_tokens / C4 SPEC.md doc-handle),
each driving a REAL ``run_team`` over the two_node team with the LLM + engine adapter mocked
(offline,
no NIM). These are the mutation-real complements to the pure ``test_context_compiler.py``:

* **C2** — a per-node input budget breach FAILS the run PRE-CALL (the adapter never runs) with a
  reason naming the fattest ``spec`` part + its token count, and the manifest is persisted on the
  failed invocation. This regression FAILS if the budget check is deleted (the run would instead
  complete, since the fake adapter ships a deliverable).
* **C3** — the PM (a real ``pm_step``) sources ``CompletionRequest.max_tokens`` from the setting
  (NOT the old hardcoded 400), and a per-node ``model_config.thinker_max_output_tokens`` override
  wins.
* **C4** — a large spec is written to ``<workspace>/SPEC.md`` (the agent sees it + a pointer in its
  instruction), then removed after the run so it NEVER lands in the shipped commit.
"""

import shutil
import subprocess
import uuid
from pathlib import Path

from conftest import auth_user_id
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select, update

from tvashtr.config import get_settings
from tvashtr.control_plane import team_run
from tvashtr.control_plane.context_compiler import SPEC_HANDLE_FILENAME
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.documents.service import create_document_with_initial_version
from tvashtr.engines.base import AgentRunResult
from tvashtr.gateway import CompletionResult
from tvashtr.models import AgentInvocation, AgentNode, Run

_WORKSPACE_ROOT = Path(__file__).resolve().parents[1] / ".tvashtr_workspaces"


def _seed_run(run_id: str, team_graph_id: str, idea: str) -> None:
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status="running",
            )
        )


def _set_node_config(team_graph_id: str, kind: str, config: dict) -> None:
    """Set the ``config`` JSONB on the team's node of ``kind`` (``"agent"`` = the Engineer worker;
    ``"completion"`` = the PM thinker) — the per-node ``model_config`` override source."""
    with session_scope() as session:
        session.execute(
            update(AgentNode)
            .where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.kind == kind,
            )
            .values(config=config)
        )


def _seed_prd(run_id: str, content: str) -> dict:
    """Seed a REAL PRD document (v1) with explicit ``content`` + point the Run at it — like
    ``conftest.seed_pm_prd`` but with a caller-chosen (e.g. large) spec body."""
    document = create_document_with_initial_version(
        "Mini-PRD", "prd", content, "agent:pm", f"{run_id}:pm-prd-v1"
    )
    with session_scope() as session:
        session.execute(
            update(Run).where(Run.id == uuid.UUID(run_id)).values(pm_document_id=document.id)
        )
    return {"document_id": str(document.id), "prd_text": content}


class _RecordingAdapter:
    """A greenfield fake adapter: records that ``run`` was reached, writes a deliverable so
    ``ship_step`` has something to commit, and reports success — no LLM, no container."""

    name = "openhands"

    def __init__(self, captured: dict) -> None:
        self._captured = captured

    def run(self, task, on_event=None):
        self._captured["adapter_called"] = True
        self._captured["instruction"] = task.instruction
        ws = Path(task.workspace_dir)
        spec_md = ws / SPEC_HANDLE_FILENAME
        # Observe the C4 doc-handle exactly as a real agent would (SPEC.md present + its content).
        self._captured["spec_md_existed"] = spec_md.exists()
        self._captured["spec_md_content"] = (
            spec_md.read_text(encoding="utf-8") if spec_md.exists() else None
        )
        (ws / "greeting.txt").write_text("hi\n", encoding="utf-8")
        return AgentRunResult(
            status="completed", summary="ok", events=[], files_changed=["greeting.txt"]
        )


# ---- C2: an over-budget compiled context FAILS the run pre-call (naming spec) + persists manifest


def test_over_context_budget_fails_run_naming_spec_and_persists_manifest(client, monkeypatch):
    """A tiny per-node input budget + a large live spec → the Engineer breaches BEFORE the agent
    runs: the run finalizes ``failed`` with a reason naming the ``spec`` part + its token count, the
    adapter is NEVER reached, and the manifest is persisted on the failed invocation.

    This is the budget-check regression: DELETE the ``if compiled.over_budget`` guard in
    ``agent_run_step`` and the fake adapter runs → the run ships/COMPLETES → this test FAILS."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    # Tiny INPUT budget on the Engineer (agent) node → any real spec breaches pre-call.
    _set_node_config(team_graph_id, "agent", {"model_config": {"worker_context_token_budget": 100}})
    big_spec = "S" * 8000  # ~2000 tok — the fattest part, far over the 100-tok budget

    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    # Fake PM: seed the LARGE PRD (no LLM). The Engineer re-sources it live → over budget.
    monkeypatch.setattr(
        team_run, "pm_step", lambda r, i, m, p, mt, inv=None: _seed_prd(r, big_spec)
    )
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _RecordingAdapter(captured))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add a greeting.")
        result = handle.get_result()

        assert result["status"] == "failed"
        # PRE-CALL: the adapter was never resolved or run (no attempt, no agent).
        assert captured.get("adapter_called") is None
        err = result["error"]
        assert "exceeds budget 100" in err
        assert "'spec'" in err and "tok" in err

        # The manifest is persisted on the Engineer's (failed) invocation for observability.
        with session_scope() as session:
            manifests = [
                row[0]
                for row in session.execute(
                    select(AgentInvocation.context_manifest).where(AgentInvocation.run_id == run_id)
                ).all()
            ]
        agent_manifest = next(m for m in manifests if m)  # the worker node's (others are NULL)
        assert agent_manifest["budget"] == 100
        assert agent_manifest["handle_used"] is False
        assert any(p["name"] == "spec" for p in agent_manifest["parts"])
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# ---- C3: the thinker max_tokens is sourced from the setting (not 400), and a node override wins --


def _capturing_complete(captured: dict):
    def _fake_complete(request):
        captured.setdefault("max_tokens_calls", []).append(request.max_tokens)
        return CompletionResult(
            text="PRD: greeting",
            model_requested=request.model,
            model_used=request.model,
            prompt_tokens=1,
            completion_tokens=1,
            total_tokens=2,
            cost_usd=0.0,
            raw_provider="openrouter",
            latency_ms=0.0,
        )

    return _fake_complete


def test_thinker_max_tokens_sourced_from_setting_not_400(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add greeting.txt")
    captured: dict = {}
    monkeypatch.setattr(team_run, "complete", _capturing_complete(captured))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _RecordingAdapter({}))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add greeting.txt")
        result = handle.get_result()
        assert result["status"] == "completed"
        # The PM (real pm_step) passed the SETTING value as max_tokens — not the old hardcoded 400.
        assert captured["max_tokens_calls"] == [get_settings().thinker_max_output_tokens]
        assert 400 not in captured["max_tokens_calls"]
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def test_thinker_max_tokens_per_node_override_wins(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    # A per-node override on the PM (completion) node beats the setting default.
    _set_node_config(
        team_graph_id, "completion", {"model_config": {"thinker_max_output_tokens": 777}}
    )
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add greeting.txt")
    captured: dict = {}
    monkeypatch.setattr(team_run, "complete", _capturing_complete(captured))
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _RecordingAdapter({}))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add greeting.txt")
        result = handle.get_result()
        assert result["status"] == "completed"
        assert captured["max_tokens_calls"] == [777]  # the per-node override, not the setting
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


# ---- C4: a large spec becomes <workspace>/SPEC.md (agent reads it) + a pointer, and never ships --


def test_large_spec_writes_spec_md_pointer_and_never_ships(client, monkeypatch):
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    team_graph_id = build_two_node_team()
    big_spec = "S" * 8000  # ~2000 tok > the ~1500 handle threshold, under the 110000 budget
    run_id = str(uuid.uuid4())
    _seed_run(run_id, team_graph_id, "Add a greeting.")
    monkeypatch.setattr(
        team_run, "pm_step", lambda r, i, m, p, mt, inv=None: _seed_prd(r, big_spec)
    )
    captured: dict = {}
    monkeypatch.setattr(team_run, "resolve_adapter", lambda name: _RecordingAdapter(captured))

    workspace = _WORKSPACE_ROOT / run_id
    try:
        with SetWorkflowID(run_id):
            handle = DBOS.start_workflow(team_run.run_team, "Add a greeting.")
        result = handle.get_result()
        assert result["status"] == "completed"

        # The agent SAW SPEC.md (with the full spec) + a pointer in its instruction; the big spec is
        # NOT inlined; static-first (the node prompt leads the instruction).
        assert captured["spec_md_existed"] is True
        assert captured["spec_md_content"] == big_spec
        assert f"./{SPEC_HANDLE_FILENAME}" in captured["instruction"]
        assert big_spec not in captured["instruction"]

        # Removed after the run — gone from disk before the terminal ship node.
        assert not (workspace / SPEC_HANDLE_FILENAME).exists()
        # And NEVER in the shipped commit (git add -A honored the .gitignore + the file was gone).
        tracked = subprocess.run(
            ["git", "-C", str(workspace), "ls-files"], capture_output=True, text=True
        ).stdout
        assert SPEC_HANDLE_FILENAME not in tracked
        assert "greeting.txt" in tracked
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
