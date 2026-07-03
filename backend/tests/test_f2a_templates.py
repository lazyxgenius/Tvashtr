"""F2a — the enriched starter-team catalog: shape + runnable proofs for the two NEW builders.

``build_plan_review_team`` (``plan_review``) = ``build_review_loop_team`` with an Architect thinker
between the PM and the PRD gate; ``build_full_squad_team`` (``full_squad``) = that plus a
``ship_approval`` gate in front of ship (BOTH ship-bound approvals route through it). Each test
asserts the EXACT node set (roles + kinds + configs) and the EXACT edge set (source-role /
target-role / edge_type / conditions), then proves the topology is LAUNCHABLE via the pure
``validate_graph`` (``runnable == true``, zero errors) — the verdict the ``create_run`` guard + the
canvas gate use — so the picker offers real, runnable depth. Mutation-aware: a wrong kind/config, a
missing/renamed/re-typed edge, or an un-runnable topology fails here. Offline: pure DB, no LLM."""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.teams import (
    build_full_squad_team,
    build_plan_review_team,
    create_team_from_template,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge, TeamGraph


def _nodes_edges(graph_id: uuid.UUID):
    with session_scope() as session:
        graph = session.execute(select(TeamGraph).where(TeamGraph.id == graph_id)).scalar_one()
        nodes = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == graph_id))
            .scalars()
            .all()
        )
        edges = session.execute(select(Edge).where(Edge.team_graph_id == graph_id)).scalars().all()
    return graph, {n.role_name: n for n in nodes}, edges


def _edge_topology(by_role: dict, edges: list) -> set[tuple]:
    """The edge set as (source_role, target_role, edge_type, conditions) tuples — id-free + order-
    free, so the whole wiring compares in one assertion."""
    by_id_role = {n.id: role for role, n in by_role.items()}
    return {
        (
            by_id_role[e.source_node_id],
            by_id_role[e.target_node_id],
            e.edge_type,
            None if e.conditions is None else tuple(sorted(e.conditions.items())),
        )
        for e in edges
    }


def _validate(graph_id: uuid.UUID) -> dict:
    with session_scope() as session:
        nodes, edges = graph_dicts(session, graph_id)
    return validate_graph(nodes, edges)


def test_build_plan_review_team_shape():
    """``plan_review`` = ``review_loop`` with an Architect thinker between the PM and the PRD gate.
    Exact nodes (roles/kinds/configs) + the exact 10-edge set (the brief §2a)."""
    cap = get_settings().max_review_iterations
    _, by_role, edges = _nodes_edges(uuid.UUID(build_plan_review_team()))

    assert set(by_role) == {
        "pm",
        "architect",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship",
        "stop",
    }
    # Two thinkers (completion / no engine), carrying their reused prompts.
    assert by_role["pm"].kind == "completion" and by_role["pm"].engine is None
    assert by_role["pm"].prompt and "mini-PRD" in by_role["pm"].prompt
    assert by_role["architect"].kind == "completion" and by_role["architect"].engine is None
    assert by_role["architect"].prompt and "Technical design" in by_role["architect"].prompt
    # Two agents (openhands), self-documenting agent_kind, prompts pinned.
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].engine == "openhands"
    assert by_role["engineer"].config == {"agent_kind": "engineer"}
    assert by_role["engineer"].prompt and "RELATIVE path" in by_role["engineer"].prompt
    assert by_role["reviewer"].kind == "agent" and by_role["reviewer"].engine == "openhands"
    assert by_role["reviewer"].config == {"agent_kind": "reviewer"}
    assert by_role["reviewer"].prompt and "REVIEW_VERDICT.json" in by_role["reviewer"].prompt
    # Gates + terminals carry the right kind/config.
    assert by_role["prd_gate"].kind == "gate"
    assert by_role["prd_gate"].config["gate_kind"] == "prd_approval"
    assert by_role["escalation_gate"].kind == "gate"
    assert by_role["escalation_gate"].config["gate_kind"] == "review_escalation"
    assert by_role["ship"].kind == "terminal"
    assert by_role["ship"].config == {"terminal_kind": "ship"}
    assert by_role["stop"].kind == "terminal"
    assert by_role["stop"].config == {"terminal_kind": "stop"}

    # EXACTLY the 10 edges (== review_loop with pm->prd_gate replaced by pm->architect->prd_gate).
    assert len(edges) == 10
    assert _edge_topology(by_role, edges) == {
        ("pm", "architect", "work", None),
        ("architect", "prd_gate", "work", None),
        ("prd_gate", "engineer", "work", (("when", "approved"),)),
        ("prd_gate", "stop", "work", (("when", "rejected"),)),
        ("engineer", "reviewer", "review", None),
        ("reviewer", "engineer", "review", (("loop_limit", cap),)),
        ("reviewer", "ship", "review", (("when", "approved"),)),
        ("engineer", "escalation_gate", "escalation", None),
        ("escalation_gate", "ship", "work", (("when", "approved"),)),
        ("escalation_gate", "stop", "work", (("when", "rejected"),)),
    }


def test_build_full_squad_team_shape():
    """``full_squad`` = ``plan_review`` + a ``ship_approval`` gate in front of ship, so BOTH ship-
    bound approvals route through it. Exact nodes + the exact 12-edge set (the brief §2b)."""
    cap = get_settings().max_review_iterations
    _, by_role, edges = _nodes_edges(uuid.UUID(build_full_squad_team()))

    assert set(by_role) == {
        "pm",
        "architect",
        "prd_gate",
        "engineer",
        "reviewer",
        "escalation_gate",
        "ship_gate",
        "ship",
        "stop",
    }
    assert by_role["pm"].kind == "completion"
    assert by_role["architect"].kind == "completion"
    assert by_role["engineer"].kind == "agent" and by_role["engineer"].engine == "openhands"
    assert by_role["reviewer"].kind == "agent" and by_role["reviewer"].engine == "openhands"
    assert by_role["prd_gate"].config["gate_kind"] == "prd_approval"
    assert by_role["escalation_gate"].config["gate_kind"] == "review_escalation"
    # The SECOND human checkpoint — the ship-approval gate, config verbatim.
    assert by_role["ship_gate"].kind == "gate"
    assert by_role["ship_gate"].config == {
        "gate_kind": "ship_approval",
        "title": "Approve the ship?",
        "description": "Approve to ship the reviewed change; reject to stop without shipping.",
    }
    assert by_role["ship"].config == {"terminal_kind": "ship"}
    assert by_role["stop"].config == {"terminal_kind": "stop"}

    # EXACTLY the 12 edges: plan_review's 1-6, 8, 10 + the two ship-bound approvals rerouted through
    # ship_gate + the gate's own approved/rejected out-edges.
    assert len(edges) == 12
    assert _edge_topology(by_role, edges) == {
        ("pm", "architect", "work", None),
        ("architect", "prd_gate", "work", None),
        ("prd_gate", "engineer", "work", (("when", "approved"),)),
        ("prd_gate", "stop", "work", (("when", "rejected"),)),
        ("engineer", "reviewer", "review", None),
        ("reviewer", "engineer", "review", (("loop_limit", cap),)),
        ("reviewer", "ship_gate", "review", (("when", "approved"),)),
        ("engineer", "escalation_gate", "escalation", None),
        ("escalation_gate", "ship_gate", "work", (("when", "approved"),)),
        ("escalation_gate", "stop", "work", (("when", "rejected"),)),
        ("ship_gate", "ship", "work", (("when", "approved"),)),
        ("ship_gate", "stop", "work", (("when", "rejected"),)),
    }


def test_new_templates_are_runnable_via_create(client):
    """Each NEW template, created through its catalog key, is a LAUNCHABLE graph: ``validate_graph``
    (the same verdict the ``create_run`` guard + the canvas ``Run`` gate use) returns ``runnable``
    with zero errors — so the topology is walkable to a terminal, not just well-shaped."""
    for key in ("plan_review", "full_squad"):
        tid = create_team_from_template(key, f"runnable {key}", auth_user_id())
        verdict = _validate(uuid.UUID(tid))
        assert verdict["runnable"] is True, (key, verdict)
        assert verdict["errors"] == [], (key, verdict)
