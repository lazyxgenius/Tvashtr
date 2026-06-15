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
