"""The hardcoded team-graph builders — no network (P1.5b uniform walk).

Both builders seed the graph the run is *driven by* as a uniform node/edge walk:
completion (PM/Reviewer) + agent (Engineer) + **gate** (prd_approval, review_escalation)
+ **terminal** (ship/stop) nodes, wired by edges whose ``conditions`` route the walk
(incl. the loop-back's ``loop_limit`` and the Engineer's ``escalation`` edge).
"""

import uuid

from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.teams import build_review_loop_team, build_two_node_team
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph


def _nodes_edges(graph_id):
    with session_scope() as session:
        graph = session.execute(select(TeamGraph).where(TeamGraph.id == graph_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == graph_id)).scalars().all()
    return graph, {n.role_name: n for n in nodes}, edges


def test_build_two_node_team_places_gate_and_terminals():
    graph_id = uuid.UUID(build_two_node_team())
    graph, by_role, edges = _nodes_edges(graph_id)

    assert graph is not None
    # PM (completion) -> prd_gate (gate) -> Engineer (agent) -> ship (terminal); + stop terminal.
    assert set(by_role) == {"pm", "prd_gate", "engineer", "ship", "stop"}
    assert by_role["pm"].kind == "completion" and by_role["pm"].engine is None
    assert by_role["pm"].model is not None
    # P1.8a: completion/agent nodes carry their behavior in ``prompt`` (run generically); gate +
    # terminal nodes have none.
    assert by_role["pm"].prompt and "mini-PRD" in by_role["pm"].prompt
    assert by_role["engineer"].prompt and "RELATIVE path" in by_role["engineer"].prompt
    assert by_role["prd_gate"].prompt is None
    assert by_role["ship"].prompt is None
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].engine == "openhands"
    # Gate + terminal nodes carry NO model/engine and a config.
    prd_gate, ship, stop = by_role["prd_gate"], by_role["ship"], by_role["stop"]
    assert prd_gate.kind == "gate" and prd_gate.model is None and prd_gate.engine is None
    assert prd_gate.config["gate_kind"] == "prd_approval"
    assert ship.kind == "terminal" and ship.config == {"terminal_kind": "ship"}
    assert stop.kind == "terminal" and stop.config == {"terminal_kind": "stop"}

    # 4 edges: PM->prd_gate; prd_gate->Engineer(approved)/->stop(rejected); Engineer->ship.
    pairs = {(e.source_node_id, e.target_node_id): e for e in edges}
    assert len(edges) == 4
    assert pairs[(by_role["pm"].id, prd_gate.id)].conditions is None
    assert pairs[(prd_gate.id, by_role["engineer"].id)].conditions == {"when": "approved"}
    assert pairs[(prd_gate.id, stop.id)].conditions == {"when": "rejected"}
    assert pairs[(by_role["engineer"].id, ship.id)].conditions is None
    # No loop-back / escalation in the 2-node team (so the cap never trips).
    assert all(e.edge_type != "escalation" for e in edges)


def test_build_review_loop_team_places_loop_escalation_gate_and_terminals():
    cap = get_settings().max_review_iterations
    graph_id = uuid.UUID(build_review_loop_team())
    _, by_role, edges = _nodes_edges(graph_id)

    assert set(by_role) == {
        "pm",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship",
        "stop",
    }
    assert by_role["pm"].kind == "completion"
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].engine == "openhands"
    # P1.5c: the Engineer carries a self-documenting agent_kind, and the Reviewer is now a full
    # agent node (kind="agent", engine="openhands", config.agent_kind="reviewer").
    assert by_role["engineer"].config == {"agent_kind": "engineer"}
    assert by_role["reviewer"].kind == "agent" and by_role["reviewer"].engine == "openhands"
    assert by_role["reviewer"].config == {"agent_kind": "reviewer"}
    # P1.8a: every completion/agent node carries its behavior in ``prompt``; the Reviewer's pins
    # the exact test command + sidecar so _harvest_verdict + the smokes keep working.
    assert by_role["pm"].prompt and "mini-PRD" in by_role["pm"].prompt
    assert by_role["engineer"].prompt and "RELATIVE path" in by_role["engineer"].prompt
    assert by_role["reviewer"].prompt and "python -B -m unittest" in by_role["reviewer"].prompt
    assert "REVIEW_VERDICT.json" in by_role["reviewer"].prompt
    assert by_role["prd_gate"].kind == "gate"
    assert by_role["prd_gate"].config["gate_kind"] == "prd_approval"
    assert by_role["escalation_gate"].kind == "gate"
    assert by_role["escalation_gate"].config["gate_kind"] == "review_escalation"
    assert by_role["ship"].config == {"terminal_kind": "ship"}
    assert by_role["stop"].config == {"terminal_kind": "stop"}

    assert len(edges) == 9
    eng, rev = by_role["engineer"].id, by_role["reviewer"].id

    # The loop-back: Reviewer -> Engineer, the CATCH-ALL carrying only loop_limit (P1.8a dropped
    # the "when" so a missing/garbled verdict still loops; next_node's extended fallthrough routes
    # it). Found by topology (source==rev, target==eng), NOT by a "when" label anymore.
    loopback = [e for e in edges if e.source_node_id == rev and e.target_node_id == eng]
    assert len(loopback) == 1
    assert loopback[0].edge_type == "review"
    assert loopback[0].conditions == {"loop_limit": cap}
    assert "when" not in loopback[0].conditions

    # Reviewer -> ship on approved.
    rev_approve = [
        e
        for e in edges
        if e.source_node_id == rev and (e.conditions or {}).get("when") == "approved"
    ]
    assert len(rev_approve) == 1
    assert rev_approve[0].target_node_id == by_role["ship"].id

    # The cap-exhaustion route out of the agent: Engineer -> escalation_gate (escalation edge).
    escalation = [e for e in edges if e.edge_type == "escalation"]
    assert len(escalation) == 1
    assert escalation[0].source_node_id == eng
    assert escalation[0].target_node_id == by_role["escalation_gate"].id
    assert escalation[0].conditions is None

    # The escalation gate routes to ship (approved) / stop (rejected).
    esc = by_role["escalation_gate"].id
    esc_out = {
        (e.conditions or {}).get("when"): e.target_node_id for e in edges if e.source_node_id == esc
    }
    assert esc_out == {"approved": by_role["ship"].id, "rejected": by_role["stop"].id}
