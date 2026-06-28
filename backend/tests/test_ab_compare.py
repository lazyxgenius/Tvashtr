"""GET /api/ab-runs/{pair_id} — the §14.3 A/B comparison read (offline; rows seeded directly).

Mirrors ``tests/test_ab_pair.py`` + ``tests/test_graph_endpoint.py``: the team graphs are built by
the ``build_*`` helpers (pure row inserts — no LLM, no openhands, no workflow launch) and the run
rows + the reviewer's per-round ``AgentInvocation`` rows are written straight to the DB. So this
proves only what the READ endpoint owns — the pairing read-back, the ``team_shape`` derived from
the graph (not the label), the per-round verdict labels + persisted REASONS (``outcome_detail``),
the A-then-B ordering, the unknown-pair 404, and the ``<2``-run-pair tolerance (§15). There is no
migration/executor coupling: the endpoint just reflects already-persisted rows.
"""

import uuid
from decimal import Decimal

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, AgentNode, Run


def _seed_run(
    *,
    pair_id: uuid.UUID,
    pair_label: str,
    team_shape: str,
    status: str,
    ship_tag: str | None = None,
    ship_commit_sha: str | None = None,
    cost: str | None = None,
    idea: str = "A/B idea",
) -> tuple[str, str]:
    """Insert one Run row of an A/B pair directly (no workflow). Returns (run_id, team_graph_id)."""
    builder = build_review_loop_team if team_shape == "review_loop" else build_two_node_team
    team_graph_id = builder()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                owner_id=auth_user_id(),
                idea=idea,
                workflow_id=run_id,
                status=status,
                ship_tag=ship_tag,
                ship_commit_sha=ship_commit_sha,
                cost_total_usd=Decimal(cost) if cost is not None else None,
                pair_id=pair_id,
                pair_label=pair_label,
            )
        )
    return run_id, team_graph_id


def _reviewer_node_id(team_graph_id: str) -> uuid.UUID:
    with session_scope() as session:
        return session.execute(
            select(AgentNode.id).where(
                AgentNode.team_graph_id == uuid.UUID(team_graph_id),
                AgentNode.role_name == "reviewer",
            )
        ).scalar_one()


def _seed_review_rounds(
    run_id: str, reviewer_node_id: uuid.UUID, rounds: list[tuple[int, str, str | None]]
) -> None:
    """Seed reviewer rounds directly. ``rounds`` items are (iteration, outcome, outcome_detail)."""
    with session_scope() as session:
        for iteration, outcome, detail in rounds:
            session.add(
                AgentInvocation(
                    run_id=run_id,
                    node_id=reviewer_node_id,
                    iteration=iteration,
                    status="done",
                    outcome=outcome,
                    outcome_detail=detail,
                )
            )


def test_ab_compare_two_run_pair_returns_both_sides_ordered_a_then_b(client):
    pair_id = uuid.uuid4()
    a_run, _ = _seed_run(
        pair_id=pair_id,
        pair_label="A",
        team_shape="two_node",
        status="completed",
        ship_tag="ship-aaa",
        ship_commit_sha="aaaaaaaaa",
        cost="0.0021",
    )
    b_run, b_graph = _seed_run(
        pair_id=pair_id,
        pair_label="B",
        team_shape="review_loop",
        status="completed",
        ship_tag="ship-bbb",
        ship_commit_sha="bbbbbbbbb",
        cost="0.0069",
    )
    rev_id = _reviewer_node_id(b_graph)
    _seed_review_rounds(
        b_run,
        rev_id,
        [
            (1, "changes_requested", "missing unit tests for the overdue check"),
            (2, "approved", None),
        ],
    )

    body = client.get(f"/api/ab-runs/{pair_id}").json()
    assert body["pair_id"] == str(pair_id)
    sides = body["sides"]
    # (i) exactly two sides, ordered A then B (by pair_label).
    assert [s["pair_label"] for s in sides] == ["A", "B"]
    a, b = sides

    # A = the no-review two_node side: shape DERIVED from the graph (no reviewer node), full
    # summary fields, and an empty review history.
    assert a["team_shape"] == "two_node"
    assert a["run_id"] == a_run
    assert a["status"] == "completed"
    assert a["ship_tag"] == "ship-aaa"
    assert a["ship_commit_sha"] == "aaaaaaaaa"
    assert a["cost_total_usd"] == 0.0021
    assert a["idea"] == "A/B idea"
    # No workflow launched (rows seeded directly) -> the DBOS status path returns NOT_FOUND.
    assert a["workflow_status"] == "NOT_FOUND"
    # (iv) the A (two_node) side has NO reviewer node -> review_rounds is [].
    assert a["review_rounds"] == []

    # B = the review_loop side: shape derived from its reviewer node; rounds ordered ascending,
    # each carrying outcome + the persisted REASONS.
    assert b["team_shape"] == "review_loop"
    assert b["run_id"] == b_run
    assert b["workflow_status"] == "NOT_FOUND"
    assert b["cost_total_usd"] == 0.0069
    rounds = b["review_rounds"]
    assert [r["iteration"] for r in rounds] == [1, 2]
    assert [r["outcome"] for r in rounds] == ["changes_requested", "approved"]
    # The reasons ride on the changes_requested round; NULL on the approved one.
    assert rounds[0]["outcome_detail"] == "missing unit tests for the overdue check"
    assert rounds[1]["outcome_detail"] is None
    # Each round dict carries exactly the FE-typed shape.
    assert set(rounds[0]) == {"iteration", "outcome", "outcome_detail"}


def test_ab_compare_single_run_pair_does_not_crash(client):
    # §15: the A/B launch is NOT atomic across the two runs (and a side can also fail at runtime),
    # so a pair_id may carry a single row. The endpoint must render the one present side, not
    # assume two and crash.
    pair_id = uuid.uuid4()
    only_run, _ = _seed_run(
        pair_id=pair_id,
        pair_label="A",
        team_shape="two_node",
        status="running",
    )
    body = client.get(f"/api/ab-runs/{pair_id}").json()
    sides = body["sides"]
    assert len(sides) == 1
    assert sides[0]["pair_label"] == "A"
    assert sides[0]["run_id"] == only_run
    assert sides[0]["team_shape"] == "two_node"
    assert sides[0]["review_rounds"] == []


def test_ab_compare_unknown_pair_id_returns_404(client):
    resp = client.get(f"/api/ab-runs/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_ab_compare_invalid_pair_id_returns_400(client):
    resp = client.get("/api/ab-runs/not-a-uuid")
    assert resp.status_code == 400
