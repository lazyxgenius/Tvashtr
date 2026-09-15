"""Phase 4a — validate_graph rules for domain_query."""

from tvashtr.control_plane.graph_validity import validate_graph


def _fwd(src, tgt, eid="e1"):
    return {
        "id": eid,
        "source_node_id": src,
        "target_node_id": tgt,
        "edge_type": "work",
        "conditions": None,
    }


def test_domain_query_as_root_is_blocked():
    nodes = [
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": "11111111-1111-1111-1111-111111111111"}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("dq", "ship")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "root_not_thinker" for e in v["errors"])


def test_domain_query_needs_exit():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": "11111111-1111-1111-1111-111111111111"}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0")]  # dq has no exit
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "no_exit" and e["node_id"] == "dq" for e in v["errors"])


def test_domain_query_missing_domain_id_blocked_when_reachable():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {"id": "dq", "kind": "domain_query", "config": {"domain_id": None}},
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0"), _fwd("dq", "ship", "e1")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is False
    assert any(e["code"] == "domain_query_no_domain" for e in v["errors"])


def test_happy_path_runnable():
    nodes = [
        {"id": "pm", "kind": "completion"},
        {
            "id": "dq",
            "kind": "domain_query",
            "config": {"domain_id": "11111111-1111-1111-1111-111111111111"},
        },
        {"id": "ship", "kind": "terminal"},
    ]
    edges = [_fwd("pm", "dq", "e0"), _fwd("dq", "ship", "e1")]
    v = validate_graph(nodes, edges)
    assert v["runnable"] is True, v
