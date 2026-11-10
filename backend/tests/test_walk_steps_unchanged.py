"""M2 invariant: a walk with no Hand in takes exactly the steps it took before M2.

The REAL ``run_team`` over the review-loop team (one forced send-back, then approved, the PRD gate
auto-approved, the agent stubbed as ``test_review_loop`` does), and the DBOS steps it recorded, in
order, compared with the sequence the same run records on ``main`` before M2 (captured there with
this file, ``57653d7c``)."""

import os
import uuid
from pathlib import Path

from conftest import auth_user_id, entry_report_result
from dbos import DBOS, SetWorkflowID

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import EngineerRunAttempt, Run

# The step names main 57653d7c records for this run (python tests/test_walk_steps_unchanged.py).
MAIN_STEPS: list[str] | None = [
    "clone_github_repo_step",
    "load_graph_step",
    "open_invocation_step",
    "mint_vkey_step",
    "delete_vkey_step",
    "record_entry_spec_step",
    "close_invocation_step",
    "budget_check_step",
    "maybe_emit_budget_nudge_step",
    "open_invocation_step",
    "open_gate_step",
    "gate_auto_resolution_step",
    "close_gate_step",
    "close_invocation_step",
    "open_invocation_step",
    "mint_vkey_step",
    "read_latest_prd_versioned_step",
    "delete_vkey_step",
    "persist_agent_cost_step",
    "close_invocation_step",
    "budget_check_step",
    "maybe_emit_budget_nudge_step",
    "open_invocation_step",
    "mint_vkey_step",
    "read_latest_prd_versioned_step",
    "delete_vkey_step",
    "close_invocation_step",
    "budget_check_step",
    "maybe_emit_budget_nudge_step",
    "open_invocation_step",
    "mint_vkey_step",
    "read_latest_prd_versioned_step",
    "delete_vkey_step",
    "persist_agent_cost_step",
    "close_invocation_step",
    "budget_check_step",
    "maybe_emit_budget_nudge_step",
    "open_invocation_step",
    "mint_vkey_step",
    "read_latest_prd_versioned_step",
    "delete_vkey_step",
    "close_invocation_step",
    "budget_check_step",
    "maybe_emit_budget_nudge_step",
    "open_invocation_step",
    "ship_step",
    "push_and_open_pr_step",
    "finalize_run_step",
    "distill_run_memory_step",
    "ingest_agent_remembers_step",
    "close_invocation_step",
    "close_run_sandboxes_step",
]


def recorded_steps(monkeypatch, tmp_path) -> list[str]:
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    workspace = Path(tmp_path) / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _setup(run_id):
        return str(workspace)

    def _agent(run_id, node_prompt, model, iteration, idea, prd_text, workspace_dir, vkey,
               reviewer_feedback, emits_outcome, budget, invocation_id=None, edits_allowed=True,
               **kwargs):  # fmt: skip
        if not edits_allowed and not emits_outcome:
            return entry_report_result(idea)
        if emits_outcome:
            return team_run._forced_review_outcome(iteration)
        with session_scope() as session:
            session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))
        (Path(workspace_dir) / "greeting.txt").write_text(f"build {iteration}\n")
        return {
            "status": "completed",
            "outcome": None,
            "reasons": None,
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "engineer_setup_step", _setup)
    monkeypatch.setattr(team_run, "agent_run_step", _agent)
    monkeypatch.setattr(team_run, "retrieve_memory_step", lambda *a, **k: [])

    graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(graph_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    assert handle.get_result()["status"] == "completed"
    return [s["function_name"] for s in DBOS.list_workflow_steps(run_id)]


def test_a_walk_with_no_hand_in_records_mains_steps(client, monkeypatch, tmp_path):
    steps = recorded_steps(monkeypatch, tmp_path)
    if MAIN_STEPS is None:  # the capture on main prints the sequence to pin
        print("STEPS", steps)
        return
    assert steps == MAIN_STEPS
