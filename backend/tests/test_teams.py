"""Two-node team graph builder — no network.

`build_two_node_team` seeds the graph the run is *driven by*: a PM completion
node and an Engineer agent node, wired by one work edge PM -> Engineer.
"""

import uuid

from sqlalchemy import select

from tvashtr.control_plane.teams import build_two_node_team
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
