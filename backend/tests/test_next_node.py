"""next_node — the pure edge-routing function (P1.5a). No DB, no DBOS, no network.

Importing ``team_run`` is openhands-free (proven in test_registry); ``next_node``
is a plain function, so these run without the DBOS/client fixture."""

from tvashtr.control_plane.team_run import escalation_target, loop_limit_for, next_node


def _edge(source: str, target: str, conditions: dict | None = None, edge_type: str = "x") -> dict:
    return {"source": source, "target": target, "edge_type": edge_type, "conditions": conditions}


def test_unconditional_edge_is_followed():
    edges = [_edge("a", "b")]
    assert next_node(edges, "a", outcome=None) == "b"
    # With an outcome but no matching conditional edge, the unconditional edge is the fallback.
    assert next_node(edges, "a", outcome="anything") == "b"


def test_conditional_match_routes_to_that_target():
    # The 3-node loop-back: Reviewer -> Engineer fires only on "changes_requested".
    edges = [
        _edge("eng", "rev"),  # unconditional Engineer -> Reviewer
        _edge("rev", "eng", conditions={"when": "changes_requested"}),
    ]
    assert next_node(edges, "rev", outcome="changes_requested") == "eng"


def test_no_match_and_no_unconditional_returns_none():
    # "approved" matches no loop-back edge and the Reviewer has no unconditional
    # out-edge -> the sub-walk ends -> ship.
    edges = [_edge("rev", "eng", conditions={"when": "changes_requested"})]
    assert next_node(edges, "rev", outcome="approved") is None


def test_two_node_engineer_has_no_out_edge_returns_none():
    # The 2-node team: PM -> Engineer only; the Engineer is the source of no edge.
    edges = [_edge("pm", "eng")]
    assert next_node(edges, "eng", outcome=None) is None


def test_conditional_preferred_over_unconditional_when_outcome_matches():
    # If both a matching conditional and an unconditional edge leave a node, the
    # conditional match wins (conditions are checked first); a non-matching outcome
    # falls back to the unconditional edge.
    edges = [_edge("n", "uncond"), _edge("n", "cond", conditions={"when": "go"})]
    assert next_node(edges, "n", outcome="go") == "cond"
    assert next_node(edges, "n", outcome="other") == "uncond"


def test_loopback_with_loop_limit_still_matches_when():
    # The loop-back edge now also carries loop_limit; next_node matches the "when" field
    # (a subset match), not the whole dict.
    edges = [_edge("rev", "eng", conditions={"when": "changes_requested", "loop_limit": 3})]
    assert next_node(edges, "rev", outcome="changes_requested") == "eng"


def test_escalation_edge_excluded_from_routing():
    # The agent's escalation edge is reached only via escalation_target, never next_node:
    # with Engineer -> Reviewer (unconditional) + Engineer -> esc (escalation), a normal
    # completion routes to the Reviewer, not the escalation gate.
    edges = [_edge("eng", "rev"), _edge("eng", "esc", edge_type="escalation")]
    assert next_node(edges, "eng", outcome=None) == "rev"
    # An escalation edge is excluded even from a matching conditional search.
    edges2 = [_edge("eng", "esc", conditions={"when": "go"}, edge_type="escalation")]
    assert next_node(edges2, "eng", outcome="go") is None


def test_escalation_target_finds_the_escalation_edge():
    edges = [_edge("eng", "rev"), _edge("eng", "esc", edge_type="escalation")]
    assert escalation_target(edges, "eng") == "esc"
    # No escalation edge out of the node (the 2-node Engineer) -> None.
    assert escalation_target([_edge("eng", "ship")], "eng") is None


def test_loop_limit_for_reads_loopback_else_default():
    edges = [_edge("rev", "eng", conditions={"when": "changes_requested", "loop_limit": 4})]
    # The loop-back targets the Engineer carrying a loop_limit -> read it.
    assert loop_limit_for(edges, "eng", default=3) == 4
    # No loop-back carrying a loop_limit for this node -> the Settings fallback default.
    assert loop_limit_for([_edge("pm", "eng")], "eng", default=3) == 3
    assert loop_limit_for(edges, "rev", default=3) == 3
