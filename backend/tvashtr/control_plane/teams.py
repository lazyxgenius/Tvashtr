"""The hardcoded team-graph builders (pure functions).

Seed the rows the run is *driven by* — the uniform graph the executor walks
(P1.5b): completion nodes (PM/Reviewer), an agent node (Engineer, ``openhands``
engine), **gate** nodes (a human-approval checkpoint the walk pauses at — the PRD
gate, and the review-escalation gate), and **terminal** nodes (the walk's
endpoint: a ``ship`` terminal that commits+finalizes, a ``stop`` terminal that
finalizes ``rejected``). Edges carry the routing (``conditions``); the loop cap
rides the loop-back edge as a ``loop_limit``. This is the seed of "the team is
authored"; the builders stay hardcoded (the Supervisor swaps them in P1.8).
"""

import os

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph

# The Engineer needs a stronger instruction-follower than the cheap completion
# default; same single OPENROUTER_API_KEY, different slug (matches agent-smoke).
DEFAULT_ENGINEER_MODEL = "openrouter/openai/gpt-4o-mini"

# The PRD-approval gate node's config — identical in both teams (the human-approval
# checkpoint the walk pauses at before the Engineer builds).
_PRD_GATE_CONFIG = {
    "gate_kind": "prd_approval",
    "title": "Approve the PRD before the Engineer builds",
    "description": (
        "The PM wrote the PRD. Approve to let the Engineer build and ship it; reject "
        "to stop the run without shipping."
    ),
}


def engineer_model() -> str:
    return os.environ.get("TVASHTR_AGENT_MODEL", DEFAULT_ENGINEER_MODEL)


def reviewer_model() -> str:
    """The Reviewer's model. Reuses the Engineer's capable slug so review has the
    comprehension to judge a deliverable against the PRD; under the forced-revisions
    harness the model is irrelevant (no LLM call), and real review-quality tuning is
    P1.5c — so this stays the same single ``OPENROUTER_API_KEY`` slug for now."""
    return engineer_model()


def build_two_node_team(name: str = "PM -> Engineer") -> str:
    """Insert the 2-node team as a uniform walk and return its team_graph id.

    Topology (the walk the generic executor traces): PM (completion) writes the PRD
    -> prd_gate (gate; approve -> Engineer, reject -> stop) -> Engineer (agent)
    builds -> ship (terminal; commit + finalize ``completed``). The explicit terminal
    means the walk always ends at a node (no implicit fall-off-the-end ship). No
    loop-back/escalation, so the cap never trips: the Engineer runs once -> ship."""
    settings = get_settings()
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=settings.default_model,
            engine=None,
            position={"x": 0, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 260, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=engineer_model(),
            engine="openhands",
            position={"x": 520, "y": 0},
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 780, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 260, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all([pm, prd_gate, engineer, ship, stop])
        session.flush()

        session.add_all(
            [
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions=None,
                ),
            ]
        )
        return str(graph.id)


def build_review_loop_team(name: str = "PM -> Engineer <-> Reviewer") -> str:
    """Insert the 3-role cyclic review-loop team as a uniform walk and return its id.

    Topology (the cycle the generic executor walks): PM (completion) -> prd_gate
    (gate; approve -> Engineer, reject -> stop) -> Engineer (agent) -> Reviewer
    (completion). The Reviewer's ``approved`` routes to the ship terminal; its
    ``changes_requested`` follows the loop-back ``review`` edge to the Engineer — that
    edge carries ``loop_limit`` = ``max_review_iterations`` (the cap). When the cap is
    exhausted the walk leaves the Engineer via the dedicated ``escalation`` edge to the
    escalation gate (ship-as-is on approve / stop on reject). Same hardcoded-builder /
    generic-executor split as :func:`build_two_node_team`; the Supervisor (P1.8) later
    swaps the builder."""
    settings = get_settings()
    max_iters = settings.max_review_iterations
    with session_scope() as session:
        graph = TeamGraph(name=name)
        session.add(graph)
        session.flush()

        pm = AgentNode(
            team_graph_id=graph.id,
            role_name="pm",
            kind="completion",
            model=settings.default_model,
            engine=None,
            position={"x": 0, "y": 0},
        )
        prd_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="prd_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 260, "y": 0},
            config=_PRD_GATE_CONFIG,
        )
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=engineer_model(),
            engine="openhands",
            position={"x": 520, "y": 0},
        )
        reviewer = AgentNode(
            team_graph_id=graph.id,
            role_name="reviewer",
            kind="completion",
            model=reviewer_model(),
            engine=None,
            position={"x": 780, "y": 0},
        )
        escalation_gate = AgentNode(
            team_graph_id=graph.id,
            role_name="escalation_gate",
            kind="gate",
            model=None,
            engine=None,
            position={"x": 520, "y": 180},
            config={
                "gate_kind": "review_escalation",
                "title": (
                    f"Couldn't satisfy the spec in {max_iters} review rounds — "
                    "ship the last build as-is, or stop"
                ),
                "description": (
                    "The Engineer and Reviewer did not converge within the cap. Approve "
                    "to ship the last completed build as-is, or reject to stop the run "
                    "without shipping."
                ),
            },
        )
        ship = AgentNode(
            team_graph_id=graph.id,
            role_name="ship",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 1040, "y": 0},
            config={"terminal_kind": "ship"},
        )
        stop = AgentNode(
            team_graph_id=graph.id,
            role_name="stop",
            kind="terminal",
            model=None,
            engine=None,
            position={"x": 260, "y": 160},
            config={"terminal_kind": "stop"},
        )
        session.add_all([pm, prd_gate, engineer, reviewer, escalation_gate, ship, stop])
        session.flush()

        session.add_all(
            [
                # PM -> prd_gate (unconditional work edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=prd_gate.id,
                    edge_type="work",
                    conditions=None,
                ),
                # prd_gate -> Engineer (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=prd_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
                # Engineer -> Reviewer (unconditional review edge).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=reviewer.id,
                    edge_type="review",
                    conditions=None,
                ),
                # Reviewer -> Engineer: the loop-back, carrying the cap as loop_limit.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=engineer.id,
                    edge_type="review",
                    conditions={"when": "changes_requested", "loop_limit": max_iters},
                ),
                # Reviewer -> ship (approved).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=ship.id,
                    edge_type="review",
                    conditions={"when": "approved"},
                ),
                # Engineer -> escalation_gate: the cap-exhaustion route out of the agent.
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=escalation_gate.id,
                    edge_type="escalation",
                    conditions=None,
                ),
                # escalation_gate -> ship (approved) / -> stop (rejected).
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=ship.id,
                    edge_type="work",
                    conditions={"when": "approved"},
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=escalation_gate.id,
                    target_node_id=stop.id,
                    edge_type="work",
                    conditions={"when": "rejected"},
                ),
            ]
        )
        return str(graph.id)
