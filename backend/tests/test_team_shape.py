"""Revamp G-1 — ``graph_validity.team_shape``: a team's pipeline strip (main path to Ship + loops).

Pure-function tests on literal node/edge dicts, plus one pass over every real template builder so
the strip the team cards draw matches the topology the templates actually create."""

import uuid

import pytest
from sqlalchemy import select

from tvashtr.control_plane.graph_validity import team_shape
from tvashtr.control_plane.teams import (
    build_full_squad_team,
    build_plan_review_team,
    build_review_loop_team,
    build_two_node_team,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge


def _n(nid, kind, role_name, config=None):
    return {"id": nid, "kind": kind, "role_name": role_name, "config": config}


def _e(src, tgt, *, edge_type="work", conditions=None):
    return {
        "source_node_id": src,
        "target_node_id": tgt,
        "edge_type": edge_type,
        "conditions": conditions,
    }


def _labels(shape):
    return [n["label"] for n in shape["nodes"]]


def test_empty_graph_has_an_empty_shape():
    assert team_shape([], []) == {"nodes": [], "loops": []}


def test_blank_team_is_thinker_then_ship():
    nodes = [
        _n("a", "completion", "thinker"),
        _n("b", "terminal", "ship", {"terminal_kind": "ship"}),
    ]
    shape = team_shape(nodes, [_e("a", "b")])
    assert shape == {
        "nodes": [
            {"id": "a", "kind": "thinker", "role": "thinker", "label": "Thinker"},
            {"id": "b", "kind": "terminal", "role": "ship", "label": "Ship"},
        ],
        "loops": [],
    }


def test_gate_follows_approved_branch_and_omits_stop():
    nodes = [
        _n("1", "completion", "pm"),
        _n("2", "gate", "prd_gate", {"gate_kind": "prd_approval", "title": "Approve the PRD?"}),
        _n("3", "agent", "engineer"),
        _n("4", "terminal", "ship", {"terminal_kind": "ship"}),
        _n("5", "terminal", "stop", {"terminal_kind": "stop"}),
    ]
    edges = [
        _e("1", "2"),
        _e("2", "5", conditions={"when": "rejected"}),
        _e("2", "3", conditions={"when": "approved"}),
        _e("3", "4"),
    ]
    shape = team_shape(nodes, edges)
    # The gate's long title is its prompt, not a name: it reads "Approval".
    assert _labels(shape) == ["PM", "Approval", "Engineer", "Ship"]
    assert [n["kind"] for n in shape["nodes"]] == ["thinker", "gate", "worker", "terminal"]
    assert shape["loops"] == []


def test_review_loop_records_the_loop_and_skips_escalation():
    nodes = [
        _n("pm", "completion", "pm"),
        _n("eng", "agent", "engineer"),
        _n("rev", "agent", "reviewer"),
        _n("esc", "gate", "escalation_gate", {"gate_kind": "review_escalation"}),
        _n("ship", "terminal", "ship", {"terminal_kind": "ship"}),
        _n("stop", "terminal", "stop", {"terminal_kind": "stop"}),
    ]
    edges = [
        _e("pm", "eng"),
        _e("eng", "rev", edge_type="review"),
        _e("rev", "eng", edge_type="review", conditions={"loop_limit": 3}),
        _e("rev", "ship", edge_type="review", conditions={"when": "approved"}),
        _e("eng", "esc", edge_type="escalation"),
        _e("esc", "ship", conditions={"when": "approved"}),
        _e("esc", "stop", conditions={"when": "rejected"}),
    ]
    shape = team_shape(nodes, edges)
    assert _labels(shape) == ["PM", "Engineer", "Reviewer", "Ship"]
    assert shape["loops"] == [{"from": 2, "to": 1}]


def test_prefers_the_branch_that_reaches_ship():
    # A worker whose "changes" branch dead-ends in Stop and whose catch-all reaches Ship.
    nodes = [
        _n("a", "completion", "thinker"),
        _n("b", "agent", "worker"),
        _n("c", "terminal", "stop", {"terminal_kind": "stop"}),
        _n("d", "terminal", "ship", {"terminal_kind": "ship"}),
    ]
    edges = [_e("a", "b"), _e("b", "c", conditions={"when": "blocked"}), _e("b", "d")]
    assert _labels(team_shape(nodes, edges)) == ["Thinker", "Worker", "Ship"]


def test_node_title_is_used_as_the_label_for_agents_only():
    nodes = [
        _n("a", "completion", "thinker", {"title": "  Researcher "}),
        _n("b", "domain_query", "domain_query", {"domain_id": None}),
        _n("c", "gate", "gate", {"title": "Approve before continuing?"}),
        _n("d", "terminal", "ship", {"terminal_kind": "ship"}),
    ]
    edges = [_e("a", "b"), _e("b", "c"), _e("c", "d", conditions={"when": "approved"})]
    shape = team_shape(nodes, edges)
    assert _labels(shape) == ["Researcher", "Domain", "Approval", "Ship"]
    assert [n["role"] for n in shape["nodes"]] == ["thinker", "domain_query", "gate", "ship"]


def test_a_graph_without_a_start_node_has_no_strip():
    nodes = [_n("a", "completion", "thinker"), _n("b", "agent", "worker")]
    assert team_shape(nodes, [_e("a", "b"), _e("b", "a")]) == {"nodes": [], "loops": []}


def test_a_path_that_never_reaches_ship_ends_where_the_graph_ends():
    nodes = [
        _n("a", "completion", "pm"),
        _n("b", "agent", "engineer"),
        _n("c", "terminal", "stop", {"terminal_kind": "stop"}),
    ]
    assert _labels(team_shape(nodes, [_e("a", "b"), _e("b", "c")])) == ["PM", "Engineer"]


def _load(graph_id: str) -> tuple[list[dict], list[dict]]:
    gid = uuid.UUID(graph_id)
    with session_scope() as session:
        nodes = session.execute(select(AgentNode).where(AgentNode.team_graph_id == gid)).scalars()
        node_dicts = [
            {"id": str(n.id), "kind": n.kind, "role_name": n.role_name, "config": n.config}
            for n in nodes
        ]
        edges = session.execute(select(Edge).where(Edge.team_graph_id == gid)).scalars()
        edge_dicts = [
            {
                "source_node_id": str(e.source_node_id),
                "target_node_id": str(e.target_node_id),
                "edge_type": e.edge_type,
                "conditions": e.conditions,
            }
            for e in edges
        ]
    return node_dicts, edge_dicts


@pytest.mark.parametrize(
    ("builder", "labels", "loops"),
    [
        (build_two_node_team, ["PM", "Approval", "Engineer", "Ship"], []),
        (
            build_review_loop_team,
            ["PM", "Approval", "Engineer", "Reviewer", "Ship"],
            [{"from": 3, "to": 2}],
        ),
        (
            build_plan_review_team,
            ["PM", "Architect", "Approval", "Engineer", "Reviewer", "Ship"],
            [{"from": 4, "to": 3}],
        ),
        (
            build_full_squad_team,
            ["PM", "Architect", "Approval", "Engineer", "Reviewer", "Approval", "Ship"],
            [{"from": 4, "to": 3}],
        ),
    ],
    ids=lambda v: getattr(v, "__name__", None),
)
def test_every_template_builder_has_the_expected_strip(builder, labels, loops):
    shape = team_shape(*_load(builder(held_providers=set())))
    assert _labels(shape) == labels
    assert shape["loops"] == loops
