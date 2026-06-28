"""Holistic graph-validity (P1.8d topology editing).

``validate_graph`` is the pure gate that decides whether an authored team graph is RUNNABLE before
the executor walks it — BLOCK only un-runnable graphs (no/ambiguous entry, a non-thinker root, a
node with no valid route for an outcome it emits, a dead-end, an unbounded loop, a bounded loop with
no escalation exit); WARN on an orphan. The pure cases below build node/edge dicts directly (no DB);
the integration case proves all three code templates + the blank skeleton validate clean (so the
templates + smokes keep running). Each block/warn code has at least one focused case."""

import uuid

from conftest import auth_user_id
from sqlalchemy import select

from tvashtr.control_plane.graph_validity import graph_dicts, validate_graph
from tvashtr.control_plane.teams import (
    build_review_loop_team,
    build_thinker_chain_team,
    build_two_node_team,
    create_blank_team,
)
from tvashtr.db import session_scope
from tvashtr.models import AgentNode, Edge


def _n(nid: str, kind: str) -> dict:
    return {"id": nid, "kind": kind}


def _e(
    eid: str, src: str, tgt: str, edge_type: str = "work", conditions: dict | None = None
) -> dict:
    return {
        "id": eid,
        "source_node_id": src,
        "target_node_id": tgt,
        "edge_type": edge_type,
        "conditions": conditions,
    }


def _codes(result: dict, key: str) -> set[str]:
    return {item["code"] for item in result[key]}


# --- Valid graphs --------------------------------------------------------------------------------


def test_minimal_skeleton_is_runnable():
    """The blank-team skeleton — one root thinker → a Ship terminal — is the smallest runnable
    graph: no errors, no warnings."""
    nodes = [_n("t", "completion"), _n("s", "terminal")]
    edges = [_e("e1", "t", "s")]
    result = validate_graph(nodes, edges)
    assert result["runnable"] and not result["errors"] and not result["warnings"], result


def test_review_loop_shape_is_runnable():
    """A bounded review loop — thinker → worker → reviewer; reviewer approves → ship or loops back
    (loop_limit) to the worker; the worker escalates to a gate on exhaustion → ship/stop — is fully
    runnable (this is the review_loop topology in miniature)."""
    nodes = [
        _n("t", "completion"),
        _n("w", "agent"),
        _n("r", "agent"),
        _n("g", "gate"),
        _n("ship", "terminal"),
        _n("stop", "terminal"),
    ]
    edges = [
        _e("e1", "t", "w"),
        _e("e2", "w", "r"),
        _e("e3", "r", "ship", conditions={"when": "approved"}),
        _e("e4", "r", "w", conditions={"loop_limit": 2}),
        _e("e5", "w", "g", edge_type="escalation"),
        _e("e6", "g", "ship", conditions={"when": "approved"}),
        _e("e7", "g", "stop", conditions={"when": "rejected"}),
    ]
    result = validate_graph(nodes, edges)
    assert result["runnable"] and not result["errors"], result


# --- BLOCK cases ---------------------------------------------------------------------------------


def test_no_root_is_blocked():
    """A pure 2-cycle has no node without an incoming edge → no entry point → block."""
    nodes = [_n("a", "completion"), _n("b", "agent")]
    edges = [_e("e1", "a", "b"), _e("e2", "b", "a")]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    assert "no_root" in _codes(result, "errors")


def test_multiple_roots_is_blocked():
    """Two disconnected chains → two entry points → ambiguous start → block (one per root)."""
    nodes = [
        _n("t1", "completion"),
        _n("s1", "terminal"),
        _n("t2", "completion"),
        _n("s2", "terminal"),
    ]
    edges = [_e("e1", "t1", "s1"), _e("e2", "t2", "s2")]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    roots = {item["node_id"] for item in result["errors"] if item["code"] == "multiple_roots"}
    assert roots == {"t1", "t2"}


def test_non_thinker_root_is_blocked():
    """The root writes the shared spec, so a worker/gate/terminal root breaks the spec spine."""
    nodes = [_n("w", "agent"), _n("s", "terminal")]
    edges = [_e("e1", "w", "s")]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    flag = next(i for i in result["errors"] if i["code"] == "root_not_thinker")
    assert flag["node_id"] == "w"


def test_dead_end_worker_with_no_exit_is_blocked():
    """A reachable worker with no outgoing edge has no route (no_exit) and can't reach an ending
    (dead_end) — the run would stop with no outcome. Both fire on that worker."""
    nodes = [_n("t", "completion"), _n("w", "agent"), _n("s", "terminal")]
    edges = [_e("e1", "t", "w"), _e("e2", "t", "s")]  # w has no out-edge
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    assert "no_exit" in _codes(result, "errors")
    assert "dead_end" in _codes(result, "errors")
    assert all(i["node_id"] == "w" for i in result["errors"])


def test_gate_missing_a_resolution_branch_is_blocked():
    """A gate with only an 'approved' route falls off the end on 'rejected' → block."""
    nodes = [_n("t", "completion"), _n("g", "gate"), _n("s", "terminal")]
    edges = [_e("e1", "t", "g"), _e("e2", "g", "s", conditions={"when": "approved"})]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    flag = next(i for i in result["errors"] if i["code"] == "gate_no_branch")
    assert flag["node_id"] == "g"


def test_unbounded_loop_is_blocked():
    """A cycle with no loop_limit back-edge loops forever → block, even though a terminal exists."""
    nodes = [_n("t", "completion"), _n("a", "agent"), _n("b", "agent"), _n("s", "terminal")]
    edges = [
        _e("e1", "t", "a"),
        _e("e2", "a", "b"),
        _e("e3", "b", "a"),  # forward back-edge, NO loop_limit → unbounded
        _e("e4", "b", "s", conditions={"when": "done"}),
    ]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    assert "unbounded_loop" in _codes(result, "errors")


def test_bounded_loop_without_escalation_exit_is_blocked():
    """A loop_limit back-edge into a worker that has NO escalation edge is never actually capped
    (the executor only enforces the cap on a node with an escalation exit) → block."""
    nodes = [_n("t", "completion"), _n("w", "agent"), _n("r", "agent"), _n("s", "terminal")]
    edges = [
        _e("e1", "t", "w"),
        _e("e2", "w", "r"),
        _e("e3", "r", "s", conditions={"when": "approved"}),
        _e("e4", "r", "w", conditions={"loop_limit": 2}),  # re-enters w, but w has no escalation
    ]
    result = validate_graph(nodes, edges)
    assert not result["runnable"]
    flag = next(i for i in result["errors"] if i["code"] == "loop_no_exit")
    assert flag["node_id"] == "w" and flag["edge_id"] == "e4"


# --- WARN case -----------------------------------------------------------------------------------


def test_orphan_node_warns_but_runs():
    """A node the walk never reaches (here, hung off a terminal's ignored out-edge) is a WARNING,
    not a block — the graph still runs."""
    nodes = [
        _n("t", "completion"),
        _n("s", "terminal"),
        _n("o", "completion"),
        _n("s2", "terminal"),
    ]
    edges = [_e("e1", "t", "s"), _e("e2", "s", "o"), _e("e3", "o", "s2")]
    result = validate_graph(nodes, edges)
    assert result["runnable"] and not result["errors"], result
    orphans = {i["node_id"] for i in result["warnings"] if i["code"] == "orphan"}
    assert orphans == {"o", "s2"}


# --- Integration: every shipped template + the blank skeleton validate clean ---------------------


def _validate_team(graph_id: uuid.UUID) -> dict:
    with session_scope() as session:
        nodes, edges = graph_dicts(session, graph_id)
    return validate_graph(nodes, edges)


def test_all_code_templates_and_blank_validate_clean(client):
    """The three code templates (two_node / review_loop / thinker_chain) and the blank skeleton each
    pass validity with zero errors — so editing never breaks the graphs that already run, and the
    blank team is runnable from the moment it's created."""
    for builder in (build_two_node_team, build_review_loop_team, build_thinker_chain_team):
        result = _validate_team(uuid.UUID(builder()))
        assert result["runnable"] and not result["errors"], (builder.__name__, result)
    blank = _validate_team(uuid.UUID(create_blank_team("blank validity probe", auth_user_id())))
    assert blank["runnable"] and not blank["errors"], blank


def test_graph_dicts_round_trips_the_stored_shape(client):
    """``graph_dicts`` loads the stored graph into the exact node/edge dict shape ``validate_graph``
    consumes — node ids/kinds + edge endpoints/edge_type/conditions — so the server validates the
    same shape the canvas does."""
    gid = uuid.UUID(build_review_loop_team())
    with session_scope() as session:
        nodes, edges = graph_dicts(session, gid)
        n_rows = (
            session.execute(select(AgentNode).where(AgentNode.team_graph_id == gid)).scalars().all()
        )
        e_rows = session.execute(select(Edge).where(Edge.team_graph_id == gid)).scalars().all()
    assert len(nodes) == len(n_rows) and len(edges) == len(e_rows)
    assert all({"id", "kind"} <= set(n) for n in nodes)
    assert all(
        {"source_node_id", "target_node_id", "edge_type", "conditions"} <= set(e) for e in edges
    )
