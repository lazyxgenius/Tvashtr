"""GET /api/runs/{run_id}/graph — offline (no LLM, no openhands, no workflow).

Seeds a team graph (build_two_node_team only inserts rows) + a Run row, then
asserts the read-only graph shape the canvas renders. No API key, no workflow
start, no openhands import.
"""

import uuid

from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentInvocation, Run


def _seed_run() -> str:
    team_graph_id = build_two_node_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea="seed idea",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_graph_endpoint_returns_two_nodes_and_one_work_edge(client):
    run_id = _seed_run()
    body = client.get(f"/api/runs/{run_id}/graph").json()

    assert body["run_id"] == run_id
    assert body["team_graph_id"]

    nodes = body["nodes"]
    assert [n["role_name"] for n in nodes] == ["pm", "engineer"]  # PM-first, deterministic
    by_role = {n["role_name"]: n for n in nodes}
    assert by_role["pm"]["kind"] == "completion" and by_role["pm"]["engine"] is None
    assert by_role["pm"]["position"] == {"x": 0, "y": 0}
    assert by_role["engineer"]["kind"] == "agent" and by_role["engineer"]["engine"] == "openhands"
    assert by_role["engineer"]["position"] == {"x": 240, "y": 0}

    edges = body["edges"]
    assert len(edges) == 1
    assert edges[0]["edge_type"] == "work"
    assert edges[0]["source_node_id"] == by_role["pm"]["id"]
    assert edges[0]["target_node_id"] == by_role["engineer"]["id"]


def test_graph_endpoint_404_for_unknown_run(client):
    resp = client.get(f"/api/runs/{uuid.uuid4()}/graph")
    assert resp.status_code == 404


def _seed_review_loop_run() -> str:
    team_graph_id = build_review_loop_team()
    run_id = str(uuid.uuid4())
    with session_scope() as session:
        session.add(
            Run(
                id=uuid.UUID(run_id),
                team_graph_id=uuid.UUID(team_graph_id),
                idea="seed idea",
                workflow_id=run_id,
                status="running",
            )
        )
    return run_id


def test_graph_endpoint_review_loop_additive_status_iteration_and_conditions(client):
    run_id = _seed_review_loop_run()
    body = client.get(f"/api/runs/{run_id}/graph").json()

    # PM-first deterministic order (x=0, 260, 520).
    nodes = body["nodes"]
    assert [n["role_name"] for n in nodes] == ["pm", "engineer", "reviewer"]
    for n in nodes:
        # Existing fields intact …
        assert {"id", "role_name", "kind", "model", "engine", "position"} <= set(n)
        # … plus the additive per-node status/iteration (default idle/0 before any run).
        assert n["status"] == "idle"
        assert n["iteration"] == 0

    by_role = {n["role_name"]: n for n in nodes}
    edges = body["edges"]
    assert len(edges) == 3
    # The loop-back edge carries the additive conditions; existing fields intact.
    loopback = [e for e in edges if e["conditions"] == {"when": "changes_requested"}]
    assert len(loopback) == 1
    assert loopback[0]["source_node_id"] == by_role["reviewer"]["id"]
    assert loopback[0]["target_node_id"] == by_role["engineer"]["id"]
    assert {"id", "source_node_id", "target_node_id", "edge_type"} <= set(loopback[0])
    # The two unconditional edges expose conditions == None (present, null).
    assert len([e for e in edges if e["conditions"] is None]) == 2


def test_graph_endpoint_node_status_reflects_latest_invocation(client):
    run_id = _seed_review_loop_run()
    eng = next(
        n
        for n in client.get(f"/api/runs/{run_id}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )

    # Two invocations for the engineer; the latest (iteration 2) is the live state.
    with session_scope() as session:
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(eng["id"]),
                iteration=1,
                status="done",
                outcome="built",
            )
        )
        session.add(
            AgentInvocation(
                run_id=run_id,
                node_id=uuid.UUID(eng["id"]),
                iteration=2,
                status="running",
                outcome=None,
            )
        )

    eng2 = next(
        n
        for n in client.get(f"/api/runs/{run_id}/graph").json()["nodes"]
        if n["role_name"] == "engineer"
    )
    assert eng2["status"] == "running"
    assert eng2["iteration"] == 2
