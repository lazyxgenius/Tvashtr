"""Shared helpers for the B-TOOLKIT tests: a fresh registered account (its own cookie jar) and
library teams / agent nodes written straight to the database."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import AgentNode, TeamGraph


def fresh_account() -> tuple[TestClient, uuid.UUID]:
    """A brand-new registered account with its OWN cookie jar (bare TestClient — never re-runs the
    lifespan) and its user id."""
    c = TestClient(app)
    c.cookies.clear()
    email = f"toolkit-{uuid.uuid4().hex}@tvashtr.local"
    resp = c.post("/api/auth/register", json={"email": email, "password": "toolkit-password"})
    assert resp.status_code == 200, resp.text
    return c, uuid.UUID(resp.json()["id"])


def make_team(owner_id: uuid.UUID | None, name: str = "Team", *, library: bool = True) -> uuid.UUID:
    """A team graph owned by ``owner_id`` (``library=False`` = a run-snapshot-style clone)."""
    tid = uuid.uuid4()
    with session_scope() as session:
        session.add(
            TeamGraph(id=tid, name=name, is_library=library, owner_id=owner_id if library else None)
        )
    return tid


def make_node(
    team_id: uuid.UUID,
    role_name: str,
    *,
    kind: str = "agent",
    x: float = 0,
    tool_config: dict | None = None,
    skills: list | None = None,
    config: dict | None = None,
    edits_allowed: bool | None = None,
) -> uuid.UUID:
    """An agent node on ``team_id`` (gate/terminal kinds carry no model)."""
    nid = uuid.uuid4()
    llm = kind in ("agent", "completion")
    with session_scope() as session:
        node = AgentNode(
            id=nid,
            team_graph_id=team_id,
            role_name=role_name,
            kind=kind,
            prompt="do it" if llm else None,
            model="openrouter/x" if llm else None,
            engine="openhands" if kind == "agent" else None,
            position={"x": x, "y": 0},
            config=config,
            tool_config=tool_config,
            skills=skills,
        )
        if edits_allowed is not None:
            node.edits_allowed = edits_allowed
        session.add(node)
    return nid


def node_row(node_id: uuid.UUID) -> AgentNode:
    with session_scope() as session:
        return session.get(AgentNode, node_id)
