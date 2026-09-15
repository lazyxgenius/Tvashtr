"""Phase 7 — graph-lite mention extract + coerce."""

from tvashtr.control_plane.domain_retrieve import (
    DEFAULT_GRAPH,
    GRAPH_EXPAND_MAX,
    GRAPH_MENTION_CAP,
    coerce_graph_config,
    extract_mentions,
)


def test_constants():
    assert GRAPH_EXPAND_MAX == 4
    assert GRAPH_MENTION_CAP == 12
    assert DEFAULT_GRAPH == {"enabled": False}


def test_coerce_graph_config_defaults_and_bool():
    assert coerce_graph_config(None) == {"enabled": False}
    assert coerce_graph_config({}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": {}}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": {"graph": {"enabled": True}}}) == {
        "enabled": True
    }
    assert coerce_graph_config({"retrieval": {"graph": "nope"}}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": "nope"}) == {"enabled": False}


def test_extract_mentions_capitalized_and_acronyms():
    text = "The GDPR policy at Acme Corp covers OpenAI usage."
    mentions = extract_mentions(text)
    assert "GDPR" in mentions
    assert "Acme" in mentions or "Acme Corp" in mentions or "Corp" in mentions
    assert "OpenAI" in mentions
    assert "The" not in mentions
    assert all(len(m) >= 2 for m in mentions)


def test_extract_mentions_empty_and_cap():
    assert extract_mentions("") == []
    assert extract_mentions("lowercase only words here") == []
    huge = " ".join(f"Token{i}" for i in range(40))
    assert len(extract_mentions(huge)) <= GRAPH_MENTION_CAP
