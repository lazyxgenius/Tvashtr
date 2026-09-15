"""Phase 4b — owner-scoped retrieve_domain (no generation)."""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from tvashtr.control_plane.domain_ask import DomainAskError, retrieve_domain


def test_retrieve_domain_rejects_empty_query():
    with pytest.raises(DomainAskError) as ei:
        retrieve_domain(uuid.uuid4(), uuid.uuid4(), "   ")
    assert ei.value.code == "bad_request"


def test_retrieve_domain_not_found():
    oid, did = uuid.uuid4(), uuid.uuid4()
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=None):
            with pytest.raises(DomainAskError) as ei:
                retrieve_domain(oid, did, "what is SLA?")
            assert ei.value.code == "not_found"


def test_retrieve_domain_returns_citations(monkeypatch):
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 3},
    }

    chunks = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "SLA is 99.9%",
            "score": 0.9,
        }
    ]

    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=2):
                with patch(
                    "tvashtr.control_plane.domain_ask.held_provider_slugs",
                    return_value={"openai"},
                ):
                    with patch(
                        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
                        return_value="sk-test",
                    ):
                        emb = MagicMock()
                        emb.vectors = [[0.1, 0.2]]
                        with patch("tvashtr.control_plane.domain_ask.embed", return_value=emb):
                            with patch(
                                "tvashtr.control_plane.domain_ask.retrieve_domain_chunks",
                                return_value=chunks,
                            ) as ret:
                                out = retrieve_domain(oid, did, "SLA?")
    assert "answer" not in out
    assert out["citations"][0]["filename"] == "a.md"
    assert out["citations"][0]["excerpt"]
    assert out["latency_ms"] is not None
    ret.assert_called_once()
    assert ret.call_args.args[2] == 3  # top_k from config


def test_retrieve_domain_missing_providers_dict():
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {"embedding": {"model": "text-embedding-3-small"}}
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=1):
                with patch(
                    "tvashtr.control_plane.domain_ask.held_provider_slugs",
                    return_value=set(),
                ):
                    with pytest.raises(DomainAskError) as ei:
                        retrieve_domain(oid, did, "q")
                    assert ei.value.code == "missing_providers"
                    assert "openai" in ei.value.detail["message"]
