"""POST /api/ab-runs — the §14.2 A/B pair + launch (offline: the workflow launch is stubbed).

Asserts the durable pairing contract the §14.3 comparison view will read: one idea fans out to
TWO runs sharing a ``pair_id``, labelled ``"A"``/``"B"``, built from the two v1 configs
(A = ``two_node`` / no review, B = ``review_loop`` / the agent-Reviewer), with the SAME idea and
SAME budget cap on both (a fair comparison), each launched as its own DBOS workflow keyed on its
run_id.

The launch itself (``DBOS.start_workflow``) is stubbed, so no team / LLM / openhands runs — the
*execution* of each shape is already proven by ``test_review_loop`` / the skeleton tests. Here we
prove only what ``POST /api/ab-runs`` owns: the pairing, the two configs, and that both workflows
are dispatched. NO migration/executor coupling — this surface adds only ``pair_id``/``pair_label``.
"""

import uuid
from decimal import Decimal

from dbos._context import get_local_dbos_context
from sqlalchemy import select

from tvashtr import routers
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Run
from tvashtr.routers import DEFAULT_IDEA


def _stub_launch(monkeypatch):
    """Replace ``DBOS.start_workflow`` with a recorder so the endpoint dispatches without
    actually running either team. Each record captures the workflow id the enclosing
    ``with SetWorkflowID(run_id):`` block assigned (``id_assigned_for_next_workflow`` — the id
    DBOS would key the real workflow on), so the test genuinely EXERCISES that keying wrapper,
    not just the persisted ``Run.workflow_id`` column. (``DBOS.workflow_id`` is None here — no
    workflow is *executing* yet — so we read the pending assignment off the local context.)"""
    launches: list[dict] = []

    def _fake_start_workflow(fn, *args, **kwargs):
        ctx = get_local_dbos_context()
        launches.append(
            {"fn": fn, "workflow_id": ctx.id_assigned_for_next_workflow if ctx else None}
        )
        return None

    monkeypatch.setattr(routers.DBOS, "start_workflow", _fake_start_workflow)
    return launches


def _roles(team_graph_id: str) -> set[str]:
    with session_scope() as session:
        return set(
            session.execute(
                select(AgentNode.role_name).where(
                    AgentNode.team_graph_id == uuid.UUID(team_graph_id)
                )
            )
            .scalars()
            .all()
        )


def test_ab_runs_pairs_two_configs_under_one_pair_id(client, monkeypatch):
    launches = _stub_launch(monkeypatch)

    resp = client.post("/api/ab-runs", json={"idea": "build a thing", "budget_cap_usd": "1.50"})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Response: a pairing key + exactly two labelled runs (A then B) with the v1 shapes.
    pair_id = body["pair_id"]
    assert uuid.UUID(pair_id)  # a valid uuid
    runs = body["runs"]
    assert [r["pair_label"] for r in runs] == ["A", "B"]
    assert [r["team_shape"] for r in runs] == ["two_node", "review_loop"]
    run_ids = [r["run_id"] for r in runs]
    assert len(set(run_ids)) == 2  # two distinct runs

    # Both workflows were dispatched — each genuinely keyed on its own run id by the
    # enclosing SetWorkflowID(run_id) block (drop that wrapper and these ids go None), and the
    # dispatched callable is run_team. This EXERCISES the keying, not just the stored column.
    assert len(launches) == 2
    assert all(launch["fn"] is routers.run_team for launch in launches)
    assert [launch["workflow_id"] for launch in launches] == run_ids

    # DB: the durable pairing contract the comparison view (§14.3) will read.
    with session_scope() as session:
        a = session.execute(select(Run).where(Run.id == uuid.UUID(run_ids[0]))).scalar_one()
        b = session.execute(select(Run).where(Run.id == uuid.UUID(run_ids[1]))).scalar_one()

    # Same pair, distinct labels.
    assert str(a.pair_id) == pair_id and str(b.pair_id) == pair_id
    assert a.pair_label == "A" and b.pair_label == "B"
    # Same idea + same cap on both (a fair comparison).
    assert a.idea == "build a thing" and b.idea == "build a thing"
    assert a.budget_cap_usd == Decimal("1.50") and b.budget_cap_usd == Decimal("1.50")
    # ...and the persisted Run.workflow_id column mirrors that id (the workflow_id == str(run.id)
    # convention get_run relies on for status/cost/event lookups).
    assert a.workflow_id == run_ids[0] and b.workflow_id == run_ids[1]
    # The two v1 configs: A is the no-review two_node team, B is the agent-Reviewer review_loop.
    assert "reviewer" not in _roles(str(a.team_graph_id))
    assert "reviewer" in _roles(str(b.team_graph_id))
    # Distinct team graphs (each run drives its own seeded graph).
    assert a.team_graph_id != b.team_graph_id


def test_ab_runs_defaults_idea_to_skeleton_when_omitted(client, monkeypatch):
    _stub_launch(monkeypatch)

    body = client.post("/api/ab-runs", json={}).json()
    run_ids = [uuid.UUID(r["run_id"]) for r in body["runs"]]
    with session_scope() as session:
        rows = session.execute(select(Run).where(Run.id.in_(run_ids))).scalars().all()

    # Same seeding rule as create_run: no idea -> the pinned DEFAULT_IDEA skeleton, on BOTH runs.
    assert len(rows) == 2
    assert all(r.idea == DEFAULT_IDEA for r in rows)
    # Both runs in the same pair carry the same idea (the whole point: one idea, two configs).
    assert rows[0].pair_id == rows[1].pair_id
    assert {rows[0].pair_label, rows[1].pair_label} == {"A", "B"}


def test_ab_runs_surfaces_pairing_in_run_dict(client, monkeypatch):
    _stub_launch(monkeypatch)

    body = client.post("/api/ab-runs", json={"idea": "x"}).json()
    run_a = body["runs"][0]["run_id"]

    # The existing GET /api/runs/{id} now additively surfaces the pairing (for §14.3 + the FE).
    got = client.get(f"/api/runs/{run_a}").json()["run"]
    assert got["pair_id"] == body["pair_id"]
    assert got["pair_label"] == "A"
