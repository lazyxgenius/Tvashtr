"""Phase 3 — ask_domain sync flow with mocked gateway."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_ask import DomainAskError, ask_domain
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _register() -> tuple[TestClient, uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askflow-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "ask-password"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "AskFlow"}).json()["domain_id"]
    )
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        owner_id = domain.owner_id
    return c, owner_id, did


def test_ask_domain_persists_messages(monkeypatch):
    _c, owner_id, did = _register()
    # seed ready doc + chunk
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        doc = DomainDocument(
            domain_id=did,
            filename="faq.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/faq.txt",
            byte_size=12,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        # 1536-dim zero vector is fine for cosine ordering with a single row
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take 5 business days.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()

    emb = EmbeddingResult(
        vectors=[[0.0] * 1536],
        model="openai/text-embedding-3-small",
        prompt_tokens=1,
        total_tokens=1,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=1.0,
    )
    cmp = CompletionResult(
        text="Refunds take 5 business days [1].",
        model_requested="openai/gpt-4o-mini",
        model_used="openai/gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.001,
        raw_provider="openai",
        latency_ms=12.0,
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.embed", lambda req: emb)
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.complete", lambda req: cmp)

    result = ask_domain(owner_id, did, "How long do refunds take?")
    assert "5 business days" in result["answer"]
    assert result["citations"]
    assert result["citations"][0]["filename"] == "faq.txt"
    assert result["latency_ms"] is not None

    from tvashtr.control_plane.domain_ask import list_domain_messages

    msgs = list_domain_messages(owner_id, did)
    assert msgs is not None
    assert len(msgs) >= 2
    assert msgs[-2]["role"] == "user"
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["citations"]


def test_ask_domain_empty_corpus(monkeypatch):
    _c, owner_id, did = _register()
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_domain_generation_model",
        lambda oid, cfg: "openai/gpt-4o-mini",
    )
    with pytest.raises(DomainAskError) as ei:
        ask_domain(owner_id, did, "Anything?")
    assert ei.value.code == "empty_corpus"
