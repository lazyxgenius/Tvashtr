"""Phase 7 — graph-lite mention extract, expand, coerce, retrieve hook."""

import uuid
from unittest.mock import patch

from tvashtr.control_plane.domain_retrieve import (
    DEFAULT_GRAPH,
    GRAPH_EXPAND_MAX,
    GRAPH_MENTION_CAP,
    coerce_graph_config,
    expand_chunks_by_shared_mentions,
    extract_mentions,
    rank_mention_neighbors,
    retrieve_for_query,
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


def test_expand_returns_empty_without_mentions_or_seeds():
    did = uuid.uuid4()
    assert expand_chunks_by_shared_mentions(did, []) == []
    assert expand_chunks_by_shared_mentions(
        did, [{"chunk_id": "c1", "text": "lowercase only"}]
    ) == []


def test_rank_mention_neighbors_orders_and_caps():
    """Pure ranking helper (extract from expand if needed for TDD without DB)."""
    mentions = ["Acme"]
    candidates = [
        {
            "chunk_id": "n1",
            "document_id": "d2",
            "filename": "b.md",
            "ordinal": 1,
            "text": "Acme shipping and Acme billing",
        },
        {
            "chunk_id": "n2",
            "document_id": "d3",
            "filename": "c.md",
            "ordinal": 0,
            "text": "Other Acme note",
        },
        {
            "chunk_id": "n3",
            "document_id": "d4",
            "filename": "d.md",
            "ordinal": 3,
            "text": "Unrelated",
        },
    ]
    out = rank_mention_neighbors(candidates, mentions, max_expand=1)
    assert len(out) == 1
    assert out[0]["chunk_id"] == "n1"
    assert out[0]["score"] is not None


def test_retrieve_for_query_graph_disabled_unchanged():
    did = uuid.uuid4()
    seed = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "Acme",
            "score": 0.9,
        }
    ]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=seed,
    ), patch(
        "tvashtr.control_plane.domain_retrieve.expand_chunks_by_shared_mentions"
    ) as exp:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1] * 8,
            top_k=1,
            mode="dense",
            graph={"enabled": False},
        )
        assert out == seed[:1]
        exp.assert_not_called()


def test_retrieve_for_query_graph_enabled_appends_neighbors():
    did = uuid.uuid4()
    seed = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "Acme",
            "score": 0.9,
        }
    ]
    neighbor = [
        {
            "chunk_id": "c2",
            "document_id": "d2",
            "filename": "b.md",
            "ordinal": 1,
            "text": "Acme billing",
            "score": 0.25,
        }
    ]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=seed,
    ), patch(
        "tvashtr.control_plane.domain_retrieve.expand_chunks_by_shared_mentions",
        return_value=neighbor,
    ) as exp:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1] * 8,
            top_k=1,
            mode="dense",
            graph={"enabled": True},
        )
        assert [c["chunk_id"] for c in out] == ["c1", "c2"]
        exp.assert_called_once()
