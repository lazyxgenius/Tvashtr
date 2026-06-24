"""next_node — the pure edge-routing function (P1.5a). No DB, no DBOS, no network.

Importing ``team_run`` is openhands-free (proven in test_registry); ``next_node``
is a plain function, so these run without the DBOS/client fixture."""

from tvashtr.control_plane.team_run import (
    escalation_target,
    loop_limit_for,
    next_node,
    node_emits_outcome,
)


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


def test_loopback_without_when_is_the_catchall_fallthrough():
    # P1.8a (D5): the reviewer loop-back is now {"loop_limit": N} with NO "when". The Reviewer's
    # real out-edges: -> ship on {when: approved}, -> engineer on {loop_limit} (the catch-all).
    edges = [
        _edge("rev", "ship", conditions={"when": "approved"}),
        _edge("rev", "eng", conditions={"loop_limit": 3}),
    ]
    # approved still routes to ship (the conditional match wins over the catch-all loop-back).
    assert next_node(edges, "rev", outcome="approved") == "ship"
    # changes_requested matches no "when" -> falls through the no-"when" loop-back to the engineer.
    assert next_node(edges, "rev", outcome="changes_requested") == "eng"
    # A missing / garbled verdict (None) ALSO falls through the loop-back -> the loop still cycles.
    # (This is the non-vacuity seam: under the old `conditions is None`-only fallthrough this
    # returned None — a {"loop_limit"} dict is not None — so the loop would dead-end instead.)
    assert next_node(edges, "rev", outcome=None) == "eng"
    assert next_node(edges, "rev", outcome="anything-unmatched") == "eng"


def test_conditions_is_none_still_the_fallthrough_and_when_edges_unaffected():
    # The pre-P1.8a behaviors are untouched: a bare conditions=None edge is still the catch-all,
    # and a {"when": X} edge still fires only on X (never as a fallthrough).
    assert next_node([_edge("a", "b")], "a", outcome="x") == "b"  # None = catch-all
    when_only = [_edge("g", "yes", conditions={"when": "approved"})]
    assert next_node(when_only, "g", outcome="approved") == "yes"
    # No catch-all and the outcome doesn't match the only {"when"} edge -> None (no spurious route).
    assert next_node(when_only, "g", outcome="rejected") is None


def test_node_emits_outcome_true_for_conditional_false_for_unconditional():
    # P1.8a (D4): the role-agnostic discriminator that REPLACES config.agent_kind == "reviewer".
    # A node wired to branch on a routing label (a conditional {when} out-edge) emits an outcome;
    # a worker with only an unconditional out-edge does not.
    reviewer_edges = [
        _edge("rev", "ship", conditions={"when": "approved"}),
        _edge("rev", "eng", conditions={"loop_limit": 3}),  # the no-"when" loop-back
    ]
    assert node_emits_outcome(reviewer_edges, "rev") is True  # has a {when: approved} out-edge
    # The Engineer: only an unconditional -> reviewer edge (+ an escalation edge, see below).
    assert node_emits_outcome([_edge("eng", "rev")], "eng") is False
    # The no-"when" loop-back alone does NOT make its source emit (loop_limit is not a "when").
    assert node_emits_outcome([_edge("rev", "eng", conditions={"loop_limit": 3})], "rev") is False


def test_node_emits_outcome_ignores_escalation_edges():
    # An escalation edge is reached only via escalation_target, never normal routing — so even a
    # {when}-carrying escalation edge must NOT make the node "emit an outcome".
    edges = [
        _edge("eng", "rev"),  # unconditional worker edge
        _edge("eng", "esc", conditions={"when": "go"}, edge_type="escalation"),
    ]
    assert node_emits_outcome(edges, "eng") is False
