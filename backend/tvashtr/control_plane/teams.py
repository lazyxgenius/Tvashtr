"""The two-node team graph builder (pure function).

Seeds the rows the run is *driven by* — not hardcoded constants: a PM completion
node (cheap default model, no engine) and an Engineer agent node (capable model,
``openhands`` engine), wired by one ``work`` edge PM -> Engineer. This is the
seed of "the team is authored".
"""

import os

from tvashtr.config import get_settings
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph

# The Engineer needs a stronger instruction-follower than the cheap completion
# default; same single OPENROUTER_API_KEY, different slug (matches agent-smoke).
DEFAULT_ENGINEER_MODEL = "openrouter/openai/gpt-4o-mini"


def engineer_model() -> str:
    return os.environ.get("TVASHTR_AGENT_MODEL", DEFAULT_ENGINEER_MODEL)


def reviewer_model() -> str:
    """The Reviewer's model. Reuses the Engineer's capable slug so review has the
    comprehension to judge a deliverable against the PRD; under the forced-revisions
    harness the model is irrelevant (no LLM call), and real review-quality tuning is
    P1.5c — so this stays the same single ``OPENROUTER_API_KEY`` slug for now."""
    return engineer_model()


def build_two_node_team(name: str = "PM -> Engineer") -> str:
    """Insert one team graph (PM + Engineer node, one work edge) and return the
    new team_graph id as a string."""
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
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=engineer_model(),
            engine="openhands",
            position={"x": 240, "y": 0},
        )
        session.add_all([pm, engineer])
        session.flush()

        session.add(
            Edge(
                team_graph_id=graph.id,
                source_node_id=pm.id,
                target_node_id=engineer.id,
                edge_type="work",
            )
        )
        return str(graph.id)


def build_review_loop_team(name: str = "PM -> Engineer <-> Reviewer") -> str:
    """Insert the 3-node cyclic review-loop team and return its team_graph id.

    Topology (the cycle the generic executor walks): PM (completion) writes the
    PRD; the unconditional ``work`` edge enters the build/review subgraph at the
    Engineer (agent); the unconditional ``review`` edge sends the build to the
    Reviewer (completion); the Reviewer's loop-back ``review`` edge carries
    ``conditions={"when": "changes_requested"}`` so it fires ONLY on that verdict
    (back to the Engineer). ``approved`` matches no out-edge -> the sub-walk ends
    -> ship. Same hardcoded-builder / generic-executor split as
    :func:`build_two_node_team`; the Supervisor (P1.8) later swaps the builder."""
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
        engineer = AgentNode(
            team_graph_id=graph.id,
            role_name="engineer",
            kind="agent",
            model=engineer_model(),
            engine="openhands",
            position={"x": 260, "y": 0},
        )
        reviewer = AgentNode(
            team_graph_id=graph.id,
            role_name="reviewer",
            kind="completion",
            model=reviewer_model(),
            engine=None,
            position={"x": 520, "y": 0},
        )
        session.add_all([pm, engineer, reviewer])
        session.flush()

        session.add_all(
            [
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=pm.id,
                    target_node_id=engineer.id,
                    edge_type="work",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=engineer.id,
                    target_node_id=reviewer.id,
                    edge_type="review",
                    conditions=None,
                ),
                Edge(
                    team_graph_id=graph.id,
                    source_node_id=reviewer.id,
                    target_node_id=engineer.id,
                    edge_type="review",
                    conditions={"when": "changes_requested"},
                ),
            ]
        )
        return str(graph.id)
