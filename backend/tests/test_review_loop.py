"""The cyclic review loop — offline workflow test (NO LLM, NO agent, NO openhands).

Mirrors ``test_gates.py``'s offline-workflow approach but for the full executor: it
drives the REAL ``run_team`` over the 3-node ``review_loop`` team with

  * the Reviewer in **forced mode** (``TVASHTR_FORCE_REVISIONS=1`` -> ``changes_requested``
    round 1, then ``approved``) — the real ``reviewer_agent_run_step`` runs but its forced
    short-circuit returns the verdict with NO agent run / NO LLM, so the loop's control flow is
    genuinely exercised;
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
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
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
        pm_invs = _invocations(by_role["pm"].id)
        prd_gate_invs = _invocations(by_role["prd_gate"].id)
        ship_invs = _invocations(by_role["ship"].id)
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

    # The walk visited the PM (prd_written), the PRD gate (approved), and ended at the
    # ship terminal (shipped) — the uniform walk, no special-cased phases (P1.5b).
    assert [(i.iteration, i.outcome) for i in pm_invs] == [(1, "prd_written")]
    assert [(i.iteration, i.outcome) for i in prd_gate_invs] == [(1, "approved")]
    assert [(i.iteration, i.outcome) for i in ship_invs] == [(1, "shipped")]


def test_two_node_walk_ships_through_gate_and_terminal(client, monkeypatch, tmp_path):
    """The 2-node team as a uniform walk: PM -> prd_gate(approve) -> Engineer(1) ->
    ship-terminal -> completed, with exactly one ``agent-cost:1`` row. Same offline harness
    (real ``run_team``, agent + PM stubbed, the PRD gate auto-approved)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _fake_pm_step(run_id, idea, pm_model):
        return {"document_id": str(uuid.uuid4()), "prd_text": f"PRD: {idea}"}

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_engineer_run_step(
        run_id, prd_text, workspace_dir, eng_model, vkey, iteration, reviewer_feedback
    ):
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

    team_graph_id = build_two_node_team()
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
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == run.team_graph_id))
            .scalars()
            .all()
        )
        by_role = {n.role_name: n for n in nodes}

        def _invs(node_id):
            return (
                session.execute(
                    select(AgentInvocation)
                    .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == node_id)
                    .order_by(AgentInvocation.iteration)
                )
                .scalars()
                .all()
            )

        pm_invs = _invs(by_role["pm"].id)
        gate_invs = _invs(by_role["prd_gate"].id)
        eng_invs = _invs(by_role["engineer"].id)
        ship_invs = _invs(by_role["ship"].id)
        n_agent_cost = session.execute(
            select(func.count())
            .select_from(CostRecord)
            .where(CostRecord.idempotency_key.like(f"{run_id}:agent-cost:%"))
        ).scalar_one()

    assert run.status == "completed"
    assert run.ship_tag == f"ship-{run_id}"
    # The Engineer ran exactly once -> one agent-cost row (no loop-back in the 2-node team).
    assert n_agent_cost == 1
    assert [(i.iteration, i.outcome) for i in pm_invs] == [(1, "prd_written")]
    assert [(i.iteration, i.outcome) for i in gate_invs] == [(1, "approved")]
    assert [(i.iteration, i.outcome) for i in eng_invs] == [(1, "built")]
    assert [(i.iteration, i.outcome) for i in ship_invs] == [(1, "shipped")]


def test_review_loop_persists_verdict_reasons_into_outcome_detail(client, monkeypatch, tmp_path):
    """(P1.5c §14.3-prep) The Reviewer's per-round verdict REASONS land in
    ``AgentInvocation.outcome_detail`` — proven through the REAL executor on the
    forced-revision path. The round-1 ``changes_requested`` close persists its
    ``verdict["reasons"]`` (the forced-revision marker); the final ``approved`` round
    leaves it NULL (reasons is None on approve). Every OTHER node's close (PM, Engineer,
    gates, terminal) omits the new param, so its ``outcome_detail`` stays NULL — the
    default-None backward-compat path, exercised end-to-end through ``run_team``.

    Same offline harness as ``test_review_loop_cycles_once_then_ships`` (real ``run_team``,
    Reviewer in forced mode, PRD gate auto-approved, agent + PM stubbed — no LLM/openhands)."""
    monkeypatch.setenv("TVASHTR_FORCE_REVISIONS", "1")
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _fake_pm_step(run_id, idea, pm_model):
        return {"document_id": str(uuid.uuid4()), "prd_text": f"PRD: {idea}"}

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_engineer_run_step(
        run_id, prd_text, workspace_dir, eng_model, vkey, iteration, reviewer_feedback
    ):
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

        rev_invs = _invocations(by_role["reviewer"].id)
        eng_invs = _invocations(by_role["engineer"].id)
        pm_invs = _invocations(by_role["pm"].id)
        prd_gate_invs = _invocations(by_role["prd_gate"].id)
        ship_invs = _invocations(by_role["ship"].id)

    # The seam: the Reviewer's round-1 changes_requested close persisted its reasons; the
    # final approved round left outcome_detail NULL (verdict["reasons"] is None on approve).
    assert [i.outcome for i in rev_invs] == ["changes_requested", "approved"]
    assert rev_invs[0].outcome_detail is not None
    assert "forced revision" in rev_invs[0].outcome_detail
    assert rev_invs[1].outcome_detail is None

    # Every OTHER close-site omits the new param -> NULL (the default-None compat path,
    # proven through the real executor, not just the unit call).
    assert all(i.outcome_detail is None for i in eng_invs)
    assert all(i.outcome_detail is None for i in pm_invs)
    assert all(i.outcome_detail is None for i in prd_gate_invs)
    assert all(i.outcome_detail is None for i in ship_invs)
