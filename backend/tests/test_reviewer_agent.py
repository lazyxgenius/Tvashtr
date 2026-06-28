"""The agent-Reviewer's real-mode classify/route — offline workflow tests (NO LLM, NO agent,
NO openhands, NO Docker) for P1.5c, updated for P1.8a.

Mirrors ``test_review_loop.py``'s harness — the REAL ``run_team`` over the 3-node ``review_loop``
team with the openhands-touching steps stubbed — but exercises the workflow body's handling of an
outcome-EMITTING node returning canned verdict dicts (over_budget / failed / completed). P1.8a
merged the role-specific engineer/reviewer steps into ONE ``agent_run_step``, so a single stub
branches on ``emits_outcome``: the reviewer-style node delegates to a per-test ``reviewer``
callback; the engineer-style worker writes the deliverable. The cost step likewise merged — a
real (non-forced) review now meters under the SAME ``{run_id}:agent-cost:{node_id}:{iteration}``
key as the engineer (the ``{node_id}`` keeps the two from colliding), so these tests assert the
per-node cost rows rather than the retired ``reviewer-agent-cost:`` namespace. No adapter is
resolved, so ``test_registry`` stays green.
"""

import uuid
from pathlib import Path

from conftest import auth_user_id, seed_pm_prd
from dbos import DBOS, SetWorkflowID
from sqlalchemy import select

from tvashtr.control_plane import team_run
from tvashtr.control_plane.shipping import init_workspace_repo
from tvashtr.control_plane.teams import build_review_loop_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, CostRecord, Run

_USAGE = {"prompt_tokens": 8, "completion_tokens": 4, "total_tokens": 12, "cost_usd": 0.0001}


def _make_review_loop_run() -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea="build greeting.txt",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def _stub_agent(monkeypatch, workspace: Path, reviewer) -> None:
    """Stub ``pm_step`` + ``engineer_setup_step`` + the ONE generic ``agent_run_step`` (P1.8a) so
    no openhands is imported. The engineer-style worker (``emits_outcome`` False) writes the
    deliverable so a ship has something to commit; the reviewer-style node (``emits_outcome`` True)
    delegates to the per-test ``reviewer(iteration)`` callback returning a canned verdict dict."""

    def _fake_pm_step(run_id, idea, pm_model, pm_prompt):
        return seed_pm_prd(run_id, idea)

    def _fake_engineer_setup_step(run_id):
        return str(workspace)

    def _fake_agent_run_step(
        run_id,
        node_prompt,
        model,
        iteration,
        idea,
        prd_text,
        workspace_dir,
        vkey,
        reviewer_feedback,
        emits_outcome,
    ):
        if emits_outcome:
            return reviewer(iteration)
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

    monkeypatch.setattr(team_run, "pm_step", _fake_pm_step)
    monkeypatch.setattr(team_run, "engineer_setup_step", _fake_engineer_setup_step)
    monkeypatch.setattr(team_run, "agent_run_step", _fake_agent_run_step)


def _by_role(session, team_graph_id) -> dict:
    nodes = (
        session.execute(select(AgentNode).where(AgentNode.team_graph_id == team_graph_id))
        .scalars()
        .all()
    )
    return {n.role_name: n for n in nodes}


def _invocations(session, run_id, node_id):
    return (
        session.execute(
            select(AgentInvocation)
            .where(AgentInvocation.run_id == run_id, AgentInvocation.node_id == node_id)
            .order_by(AgentInvocation.iteration)
        )
        .scalars()
        .all()
    )


def _node_cost_keys(session, run_id, node_id) -> list[str]:
    """The merged per-node agent-cost keys for a given node (P1.8a):
    ``{run_id}:agent-cost:{node_id}:{iteration}``."""
    return sorted(
        session.execute(
            select(CostRecord.idempotency_key).where(
                CostRecord.idempotency_key.like(f"{run_id}:agent-cost:{node_id}:%")
            )
        )
        .scalars()
        .all()
    )


def test_reviewer_real_mode_cycles_meters_and_ships(client, monkeypatch, tmp_path):
    """Real-mode (stubbed) Reviewer returns changes_requested then approved with non-zero usage:
    the loop cycles once, ships, the reviewer invocations record [changes_requested, approved],
    and a per-NODE ``{run_id}:agent-cost:{reviewer_node}:{n}`` row is written per real review —
    distinct from the engineer's per-node rows (the merge keys them apart by node_id)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _reviewer(iteration):
        if iteration == 1:
            return {
                "status": "completed",
                "outcome": "changes_requested",
                "reasons": "add a test",
                **_USAGE,
            }
        return {"status": "completed", "outcome": "approved", "reasons": None, **_USAGE}

    _stub_agent(monkeypatch, workspace, _reviewer)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "completed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        by_role = _by_role(session, run.team_graph_id)
        rev_invs = _invocations(session, run_id, by_role["reviewer"].id)
        eng_invs = _invocations(session, run_id, by_role["engineer"].id)
        rev_cost_keys = _node_cost_keys(session, run_id, by_role["reviewer"].id)
        eng_cost_keys = _node_cost_keys(session, run_id, by_role["engineer"].id)

    assert run.status == "completed"
    assert run.ship_tag == f"ship-{run_id}"
    # Engineer x2, Reviewer x2 with the recorded verdicts (one loop-back).
    assert [i.iteration for i in eng_invs] == [1, 2]
    assert [(i.iteration, i.outcome) for i in rev_invs] == [
        (1, "changes_requested"),
        (2, "approved"),
    ]
    # The real review metered per round on the reviewer's OWN per-node key — and the engineer's
    # per-node rows are separate (the merged key's {node_id} keeps the iter-1 rows from colliding).
    rev_id = by_role["reviewer"].id
    eng_id = by_role["engineer"].id
    assert rev_cost_keys == [
        f"{run_id}:agent-cost:{rev_id}:1",
        f"{run_id}:agent-cost:{rev_id}:2",
    ]
    assert eng_cost_keys == [
        f"{run_id}:agent-cost:{eng_id}:1",
        f"{run_id}:agent-cost:{eng_id}:2",
    ]


def test_reviewer_real_mode_over_budget_finalizes_without_shipping(client, monkeypatch, tmp_path):
    """A Reviewer that returns over_budget on iteration 1: the run finalizes ``over_budget`` with
    no ship, the reviewer invocation is ``stopped``/``over_budget``, and the partial cost is
    metered on the reviewer's per-node key (best-effort)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _reviewer(iteration):
        return {
            "status": "over_budget",
            "outcome": None,
            "reasons": None,
            "error": "budget exceeded",
            "prompt_tokens": 5,
            "completion_tokens": 0,
            "total_tokens": 5,
            "cost_usd": 0.002,
        }

    _stub_agent(monkeypatch, workspace, _reviewer)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "over_budget"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        by_role = _by_role(session, run.team_graph_id)
        rev_invs = _invocations(session, run_id, by_role["reviewer"].id)
        rev_cost_keys = _node_cost_keys(session, run_id, by_role["reviewer"].id)

    assert run.status == "over_budget"
    assert run.ship_tag is None
    assert [(i.iteration, i.status, i.outcome) for i in rev_invs] == [(1, "stopped", "over_budget")]
    assert rev_cost_keys == [f"{run_id}:agent-cost:{by_role['reviewer'].id}:1"]


def test_reviewer_real_mode_failed_finalizes_failed(client, monkeypatch, tmp_path):
    """A Reviewer that returns failed: the run finalizes ``failed`` and the reviewer invocation
    is ``failed`` (zero usage -> no cost row)."""
    monkeypatch.setenv("TVASHTR_AUTO_APPROVE_GATES", "1")
    monkeypatch.delenv("TVASHTR_FORCE_REVISIONS", raising=False)

    workspace = tmp_path / "ws"
    workspace.mkdir()
    init_workspace_repo(str(workspace))

    def _reviewer(iteration):
        return {
            "status": "failed",
            "outcome": None,
            "reasons": None,
            "error": "reviewer crashed",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        }

    _stub_agent(monkeypatch, workspace, _reviewer)

    run_id = _make_review_loop_run()
    with SetWorkflowID(run_id):
        handle = DBOS.start_workflow(team_run.run_team, "build greeting.txt")
    result = handle.get_result()

    assert result["status"] == "failed"

    with session_scope() as session:
        run = session.execute(select(Run).where(Run.workflow_id == run_id)).scalar_one()
        by_role = _by_role(session, run.team_graph_id)
        rev_invs = _invocations(session, run_id, by_role["reviewer"].id)
        rev_cost_keys = _node_cost_keys(session, run_id, by_role["reviewer"].id)

    assert run.status == "failed"
    assert run.ship_tag is None
    assert [(i.iteration, i.status) for i in rev_invs] == [(1, "failed")]
    assert rev_cost_keys == []  # zero usage -> no cost row
