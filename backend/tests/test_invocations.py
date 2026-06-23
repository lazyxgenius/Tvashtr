"""AgentInvocation open/close steps — idempotent on (run_id, node_id, iteration).

No LLM, no agent, no openhands: seeds a team graph (rows only, for a real node id
to satisfy the FK), then exercises ``open_invocation_step`` / ``close_invocation_step``
directly — DBOS steps run their body when called outside a workflow, exactly as the
gate-step tests call ``open_gate_step`` directly. The ``client`` fixture launches DBOS
once for the session."""

import uuid

from sqlalchemy import func, select

from tvashtr.control_plane.invocations import close_invocation_step, open_invocation_step
from tvashtr.control_plane.teams import build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode


def _seed_node() -> tuple[str, str]:
    """Seed a team graph; return (run_id, a node id str) for FK-valid invocations."""
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        node = (
            session.execute(
                select(AgentNode).where(AgentNode.team_graph_id == uuid.UUID(team_graph_id))
            )
            .scalars()
            .first()
        )
        return run_id, str(node.id)


def _count(run_id: str, node_id: str, iteration: int) -> int:
    with session_scope() as session:
        return session.execute(
            select(func.count())
            .select_from(AgentInvocation)
            .where(
                AgentInvocation.run_id == run_id,
                AgentInvocation.node_id == uuid.UUID(node_id),
                AgentInvocation.iteration == iteration,
            )
        ).scalar_one()


def _row(run_id: str, node_id: str, iteration: int) -> AgentInvocation:
    with session_scope() as session:
        return session.execute(
            select(AgentInvocation).where(
                AgentInvocation.run_id == run_id,
                AgentInvocation.node_id == uuid.UUID(node_id),
                AgentInvocation.iteration == iteration,
            )
        ).scalar_one()


def test_open_is_idempotent_returns_same_row(client):
    run_id, node_id = _seed_node()

    id1 = open_invocation_step(run_id, node_id, 1)
    id2 = open_invocation_step(run_id, node_id, 1)

    assert id1 == id2  # insert-or-return: same row, no duplicate
    assert _count(run_id, node_id, 1) == 1
    row = _row(run_id, node_id, 1)
    assert row.status == "running"
    assert row.outcome is None
    assert row.ended_at is None
    assert row.started_at is not None


def test_close_updates_status_outcome_ended_at_and_is_noop_safe(client):
    run_id, node_id = _seed_node()
    open_invocation_step(run_id, node_id, 1)

    close_invocation_step(run_id, node_id, 1, "done", "built")
    row = _row(run_id, node_id, 1)
    assert row.status == "done"
    assert row.outcome == "built"
    assert row.ended_at is not None

    # A second close is a no-op-safe update (still exactly one row, still resolved).
    close_invocation_step(run_id, node_id, 1, "done", "built")
    assert _count(run_id, node_id, 1) == 1


def test_close_persists_outcome_detail_when_supplied(client):
    # (P1.5c §14.3-prep) Supplying outcome_detail persists it alongside status/outcome —
    # this is how the Reviewer's successful-verdict close carries verdict["reasons"].
    run_id, node_id = _seed_node()
    open_invocation_step(run_id, node_id, 1)

    close_invocation_step(
        run_id, node_id, 1, "done", "changes_requested", outcome_detail="missing edge-case test"
    )
    row = _row(run_id, node_id, 1)
    assert row.status == "done"
    assert row.outcome == "changes_requested"
    assert row.outcome_detail == "missing edge-case test"


def test_close_leaves_outcome_detail_null_by_default(client):
    # The DEFAULT call (no outcome_detail) leaves the column NULL — the load-bearing
    # backward-compat for the other 10 close_invocation_step call-sites (PM, Engineer,
    # gates, terminals, the reviewer's degenerate closes), unchanged by this seam.
    run_id, node_id = _seed_node()
    open_invocation_step(run_id, node_id, 1)

    close_invocation_step(run_id, node_id, 1, "done", "built")
    row = _row(run_id, node_id, 1)
    assert row.outcome == "built"
    assert row.outcome_detail is None


def test_distinct_iterations_are_distinct_rows(client):
    run_id, node_id = _seed_node()

    open_invocation_step(run_id, node_id, 1)
    open_invocation_step(run_id, node_id, 2)

    assert _count(run_id, node_id, 1) == 1
    assert _count(run_id, node_id, 2) == 1
    close_invocation_step(run_id, node_id, 1, "done", "built")
    # Closing iteration 1 leaves iteration 2 untouched (still running).
    assert _row(run_id, node_id, 2).status == "running"
