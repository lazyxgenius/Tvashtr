"""Phase 5 — retrieval knobs, RRF fusion, rerank passthrough."""

from tvashtr.control_plane.domain_retrieve import (
    DEFAULT_RETRIEVAL_MODE,
    RRF_K,
    apply_rerank,
    candidate_k,
    coerce_rerank_config,
    coerce_retrieval_mode,
    rrf_fuse,
)


def test_coerce_retrieval_mode_defaults_and_enum():
    assert coerce_retrieval_mode(None) == "dense"
    assert coerce_retrieval_mode({}) == "dense"
    assert coerce_retrieval_mode({"retrieval": {"mode": "hybrid"}}) == "hybrid"
    assert coerce_retrieval_mode({"retrieval": {"mode": "LEXICAL"}}) == "lexical"
    assert coerce_retrieval_mode({"retrieval": {"mode": "colbert"}}) == DEFAULT_RETRIEVAL_MODE
    assert coerce_retrieval_mode({"retrieval": "nope"}) == "dense"


def test_coerce_rerank_config_defaults():
    out = coerce_rerank_config(None)
    assert out == {"enabled": False, "model": None, "top_n": 20}
    out2 = coerce_rerank_config(
        {"retrieval": {"rerank": {"enabled": True, "model": "cohere/rerank", "top_n": 12}}}
    )
    assert out2 == {"enabled": True, "model": "cohere/rerank", "top_n": 12}
    out3 = coerce_rerank_config({"retrieval": {"rerank": {"enabled": True, "top_n": 0}}})
    assert out3["enabled"] is True
    assert out3["top_n"] == 20  # invalid top_n falls back


def test_candidate_k_expands_only_when_enabled():
    assert candidate_k(8, {"enabled": False, "top_n": 20}) == 8
    assert candidate_k(8, {"enabled": True, "top_n": 20}) == 20
    assert candidate_k(8, {"enabled": True, "top_n": 4}) == 8
    assert candidate_k(8, {"enabled": True, "top_n": 8}) == 8


def test_rrf_prefers_items_in_both_lists():
    assert RRF_K == 60
    dense = [
        {"chunk_id": "x", "text": "x", "filename": "a.md", "score": 0.9},
        {"chunk_id": "y", "text": "y", "filename": "a.md", "score": 0.8},
    ]
    lexical = [
        {"chunk_id": "y", "text": "y", "filename": "a.md", "score": 0.7},
        {"chunk_id": "z", "text": "z", "filename": "b.md", "score": 0.6},
    ]
    fused = rrf_fuse([dense, lexical])
    ids = [c["chunk_id"] for c in fused]
    assert ids[0] == "y"
    assert set(ids) == {"x", "y", "z"}
    assert fused[0]["score"] > fused[1]["score"]
    assert fused[0]["text"] == "y"


def test_rrf_single_list_preserves_order():
    only = [
        {"chunk_id": "a", "text": "a", "score": 0.5},
        {"chunk_id": "b", "text": "b", "score": 0.4},
    ]
    fused = rrf_fuse([only])
    assert [c["chunk_id"] for c in fused] == ["a", "b"]


def test_apply_rerank_is_passthrough_even_with_model():
    chunks = [
        {"chunk_id": "a", "text": "a", "score": 1.0},
        {"chunk_id": "b", "text": "b", "score": 0.5},
    ]
    out = apply_rerank(
        chunks,
        "query",
        {"enabled": True, "model": "some-rerank-model", "top_n": 20},
    )
    assert out is chunks or [c["chunk_id"] for c in out] == ["a", "b"]


import uuid
from unittest.mock import patch

from tvashtr.control_plane.domain_retrieve import retrieve_for_query


def _chunk(cid: str, text: str, score: float = 0.5) -> dict:
    return {
        "chunk_id": cid,
        "document_id": "d",
        "filename": "a.md",
        "ordinal": 0,
        "text": text,
        "score": score,
    }


def test_retrieve_for_query_dense_does_not_call_lexical():
    did = uuid.uuid4()
    dense_hits = [_chunk("a", "alpha", 0.9)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=dense_hits,
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=[],
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1, 0.2],
            top_k=3,
            mode="dense",
        )
    assert out == dense_hits
    dense.assert_called_once()
    lex.assert_not_called()
    assert dense.call_args.args[2] == 3


def test_retrieve_for_query_lexical_skips_dense():
    did = uuid.uuid4()
    lex_hits = [_chunk("b", "bravo", 0.4)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=[_chunk("a", "nope")],
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=lex_hits,
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=None,
            top_k=4,
            mode="lexical",
        )
    assert out == lex_hits
    lex.assert_called_once()
    dense.assert_not_called()


def test_retrieve_for_query_hybrid_rrf_and_rerank_expands_pool():
    did = uuid.uuid4()
    dense_hits = [_chunk("x", "x", 0.9), _chunk("y", "y", 0.8)]
    lex_hits = [_chunk("y", "y", 0.7), _chunk("z", "z", 0.6)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=dense_hits,
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=lex_hits,
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.0],
            top_k=2,
            mode="hybrid",
            rerank={"enabled": True, "model": None, "top_n": 10},
        )
    assert dense.call_args.args[2] == 10
    assert lex.call_args.args[2] == 10
    assert [c["chunk_id"] for c in out][0] == "y"
    assert len(out) == 2


def test_retrieve_for_query_unknown_mode_is_dense():
    did = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=[_chunk("a", "a")],
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
    ) as lex:
        retrieve_for_query(
            did, "q", query_embedding=[0.0], top_k=1, mode="colbert"
        )
    dense.assert_called_once()
    lex.assert_not_called()


def test_retrieve_for_query_graph_omitted_does_not_expand():
    """Smoke: graph default/omitted leaves dense path unchanged (Phase 7)."""
    did = uuid.uuid4()
    dense_hits = [_chunk("a", "Acme Corp", 0.9)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=dense_hits,
    ), patch(
        "tvashtr.control_plane.domain_retrieve.expand_chunks_by_shared_mentions",
    ) as exp:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1, 0.2],
            top_k=1,
            mode="dense",
        )
    assert out == dense_hits[:1]
    exp.assert_not_called()
