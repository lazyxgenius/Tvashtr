"""Two-node team graph builder — no network.

`build_two_node_team` seeds the graph the run is *driven by*: a PM completion
node and an Engineer agent node, wired by one work edge PM -> Engineer.
"""

import uuid

from sqlalchemy import select

from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph


def test_build_two_node_team_inserts_graph_nodes_and_work_edge():
    graph_id = uuid.UUID(build_two_node_team())

    with session_scope() as session:
        graph = session.execute(select(TeamGraph).where(TeamGraph.id == graph_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == graph_id)).scalars().all()

    assert graph is not None
    by_role = {n.role_name: n for n in nodes}
    assert set(by_role) == {"pm", "engineer"}

    pm, engineer = by_role["pm"], by_role["engineer"]
    assert pm.kind == "completion" and pm.engine is None
    assert engineer.kind == "agent" and engineer.engine == "openhands"

    assert len(edges) == 1
    edge = edges[0]
    assert edge.edge_type == "work"
    assert edge.source_node_id == pm.id
    assert edge.target_node_id == engineer.id


def test_build_review_loop_team_three_nodes_three_edges_loopback_condition():
    graph_id = uuid.UUID(build_review_loop_team())

    with session_scope() as session:
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == graph_id)).scalars().all()

    by_role = {n.role_name: n for n in nodes}
    assert set(by_role) == {"pm", "engineer", "reviewer"}
    assert by_role["pm"].kind == "completion" and by_role["pm"].engine is None
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].engine == "openhands"
    assert by_role["reviewer"].kind == "completion" and by_role["reviewer"].engine is None

    assert len(edges) == 3
    # PM -> Engineer: unconditional work edge.
    work = [e for e in edges if e.edge_type == "work"]
    assert len(work) == 1
    assert work[0].source_node_id == by_role["pm"].id
    assert work[0].target_node_id == by_role["engineer"].id
    assert work[0].conditions is None
    # Engineer -> Reviewer: unconditional review edge.
    eng_out = [e for e in edges if e.source_node_id == by_role["engineer"].id]
    assert len(eng_out) == 1
    assert eng_out[0].target_node_id == by_role["reviewer"].id
    assert eng_out[0].edge_type == "review"
    assert eng_out[0].conditions is None
    # Reviewer -> Engineer: the loop-back, conditional on changes_requested.
    loopback = [e for e in edges if e.conditions == {"when": "changes_requested"}]
    assert len(loopback) == 1
    assert loopback[0].source_node_id == by_role["reviewer"].id
    assert loopback[0].target_node_id == by_role["engineer"].id
    assert loopback[0].edge_type == "review"
