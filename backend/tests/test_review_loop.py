"""The cyclic review loop — offline workflow test (NO LLM, NO agent, NO openhands).

Mirrors ``test_gates.py``'s offline-workflow approach but for the full executor: it
drives the REAL ``run_team`` over the 3-node ``review_loop`` team with

  * the Reviewer in **forced mode** (``TVASHTR_FORCE_REVISIONS=1`` -> ``changes_requested``
    round 1, then ``approved``) — the real ``reviewer_decide_step`` runs (no LLM in
    forced mode), so the loop's control flow is genuinely exercised;
  * the PRD gate **auto-approved** (``TVASHTR_AUTO_APPROVE_GATES=1``);
  * the **agent stubbed** by monkeypatching the two openhands-touching steps
    (``engineer_setup_step`` lazily imports ``make_local_workspace``; ``engineer_run_step``
    resolves the adapter) + ``pm_step`` (no gateway LLM). The fakes are plain functions
    the workflow body calls by name, so no ``openhands`` is imported and
    ``test_registry`` stays green.

Asserts the cycle genuinely ran: Engineer x2 (iteration 1 then a revision round 2
carrying the reviewer's feedback), the Reviewer emitted ``[changes_requested,
approved]`` (exactly one loop-back), per-iteration metering (2 agent-cost rows), and
the run finished ``completed`` with exactly one ship tag.
"""

import os
import uuid
from pathlib import Path

from dbos import DBOS, SetWorkflowID
from sqlalchemy import func, select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, EngineerRunAttempt, Run


def _make_review_loop_run() -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_review_loop_cycles_once_then_ships(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    # A real git workspace the stubbed Engineer writes into + the run ships from (no
    # openhands: init_workspace_repo is plain git).
    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    engineer_calls: list[tuple[int, str | None]] = []

    def _fake_pm_step(run_id, idea, pm_model):
        return {"document_id": str(uuid.uuid4()), "prd_text": f"PRD: {idea}"}

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_engineer_run_step(
        run_id, prd_text, workspace_dir, eng_model, vkey, iteration, reviewer_feedback
    ):
        # Record the call (proves iteration + that the revision round got feedback) and
        # the non-idempotent attempt row (proves the agent step "ran"), then write the
        # deliverable so ship_step has something to commit.
        engineer_calls.append((iteration, reviewer_feedback))
        with session_scope() as session:
            session.add(EngineerRunAttempt(run_id=run_id, pid=os.getpid()))
        (Path(workspace_dir) / "greeting.txt").write_text(f"build {iteration}\n")
        return {
            "status": "completed",
            "files_changed": ["greeting.txt"],
            "error": None,
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
            "cost_usd": 0.0,
        }

    monkeypatch.setattr(team_run, "pm_step", _fake_pm_step)
    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "engineer_run_step", _fake_engineer_run_step)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    # The Engineer ran twice: iteration 1 (no feedback), then iteration 2 after the
    # forced changes_requested, carrying the reviewer's feedback.
    assert [c[0] for c in engineer_calls] == [1, 2]
    assert engineer_calls[0][1] is None
    assert engineer_calls[1][1] is not None

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        by_role = {n.role_name: n for n in nodes}

        def _invocations(node_id):
            return (
                session.execute(
                    select(AgentInvocation)
                    .where(
                        AgentInvocation.run_id == run_id,
                        AgentInvocation.node_id == node_id,
                    )
                    .order_by(AgentInvocation.iteration)
                )
                .scalars()
                .all()
            )

        eng_invs = _invocations(by_role["engineer"].id)
        rev_invs = _invocations(by_role["reviewer"].id)
        n_attempts = session.execute(
            select(func.count())
            .select_from(EngineerRunAttempt)
            .where(EngineerRunAttempt.run_id == run_id)
        ).scalar_one()
        n_agent_cost = session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
        ).scalar_one()

    # Terminal completed, shipped exactly once.
    assert run.status == "completed"
    assert run.ship_tag == f"ship-{run_id}"

    # The agent step re-executed twice (distinct attempt rows), one cost row per iteration.
    assert n_attempts == 2
    assert n_agent_cost == 2

    # Engineer invocations: iterations 1, 2 both done/built.
    assert [i.iteration for i in eng_invs] == [1, 2]
    assert [i.status for i in eng_invs] == ["done", "done"]
    assert [i.outcome for i in eng_invs] == ["built", "built"]

    # Reviewer invocations: [changes_requested, approved] — exactly one loop-back.
    assert [i.iteration for i in rev_invs] == [1, 2]
    assert [i.outcome for i in rev_invs] == ["changes_requested", "approved"]
