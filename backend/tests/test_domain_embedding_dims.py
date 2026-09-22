"""Groq multi-dim: ingest expected_dim fail-closed + cross-dim PATCH re-ingest."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from conftest import auth_user_id
from tvashtr.config import get_settings
from tvashtr.control_plane import domains as domains_cp
from tvashtr.control_plane.domain_embedding import expected_dim
from tvashtr.control_plane.domain_ingest import ingest_one_document_step
from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _blank_cfg(model: str) -> dict:
    cfg = domains_cp.default_config_for_template("blank")
    cfg["embedding"]["model"] = model
    return cfg


def test_expected_dim_catalogue_values():
    assert expected_dim("openai/text-embedding-3-small") == 1536
    assert expected_dim("openrouter/openai/text-embedding-3-small") == 1536
    assert expected_dim("gemini/gemini-embedding-001") == 768


def test_ingest_accepts_gemini_768_and_rejects_wrong_dim(client, monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()

    owner = auth_user_id()
    created = domains_cp.create_domain(owner, "Groq dim", "blank")
    domain_id = uuid.UUID(created["domain_id"])
    domains_cp.update_domain(
        owner, domain_id, config=_blank_cfg("gemini/gemini-embedding-001")
    )

    doc = domains_cp.create_document(
        owner, domain_id, "notes.txt", b"hello gemini embed world"
    )
    doc_id = doc["document_id"]

    class Ok768:
        vectors = [[0.01] * 768]
        model = "gemini/gemini-embedding-001"
        prompt_tokens = 1
        total_tokens = 1
        cost_usd = 0.0

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.embed", lambda req: Ok768()
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.resolve_owner_api_key",
        lambda oid, model: "gemini-test-key",
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.record_embedding_cost",
        lambda **kwargs: None,
    )

    out = ingest_one_document_step(str(owner), str(domain_id), doc_id)
    assert out["ok"] is True
    with session_scope() as session:
        chunk = (
            session.execute(
                select(DomainChunk).where(DomainChunk.document_id == uuid.UUID(doc_id))
            )
            .scalars()
            .first()
        )
        assert chunk is not None
        assert len(chunk.embedding) == 768

    class Bad1536:
        vectors = [[0.01] * 1536]
        model = "gemini/gemini-embedding-001"
        prompt_tokens = 1
        total_tokens = 1
        cost_usd = 0.0

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.embed", lambda req: Bad1536()
    )
    with session_scope() as session:
        d = session.execute(
            select(DomainDocument).where(DomainDocument.id == uuid.UUID(doc_id))
        ).scalar_one()
        d.ingest_status = domains_cp.INGEST_PENDING
        session.flush()

    out2 = ingest_one_document_step(str(owner), str(domain_id), doc_id)
    assert out2["ok"] is False
    with session_scope() as session:
        d = session.execute(
            select(DomainDocument).where(DomainDocument.id == uuid.UUID(doc_id))
        ).scalar_one()
        assert d.ingest_status == domains_cp.INGEST_ERROR
        assert "768" in (d.error_message or "")
        assert "1536" in (d.error_message or "")

    get_settings.cache_clear()


def test_cross_dim_patch_clears_ready_embeddings(client):
    owner = auth_user_id()
    created = domains_cp.create_domain(owner, "Cross dim", "blank")
    domain_id = uuid.UUID(created["domain_id"])

    doc = domains_cp.create_document(
        owner, domain_id, "a.txt", b"seed text for cross dim"
    )
    doc_id = uuid.UUID(doc["document_id"])
    with session_scope() as session:
        d = session.execute(
            select(DomainDocument).where(DomainDocument.id == doc_id)
        ).scalar_one()
        d.ingest_status = domains_cp.INGEST_READY
        d.error_message = None
        session.add(
            DomainChunk(
                domain_id=domain_id,
                document_id=doc_id,
                ordinal=0,
                text="seed",
                embedding=[0.1] * 1536,
                meta={},
            )
        )
        domain = session.execute(
            select(Domain).where(Domain.id == domain_id)
        ).scalar_one()
        domains_cp._apply_domain_aggregates(session, domain)
        session.flush()

    # Same-dim switch (OpenAI → OpenRouter) must NOT clear
    domains_cp.update_domain(
        owner,
        domain_id,
        config=_blank_cfg("openrouter/openai/text-embedding-3-small"),
    )
    with session_scope() as session:
        d = session.execute(
            select(DomainDocument).where(DomainDocument.id == doc_id)
        ).scalar_one()
        assert d.ingest_status == domains_cp.INGEST_READY
        chunk = session.execute(
            select(DomainChunk).where(DomainChunk.document_id == doc_id)
        ).scalar_one()
        assert chunk.embedding is not None
        assert len(chunk.embedding) == 1536

    # Cross-dim (OpenRouter 1536 → Gemini 768) MUST clear + force re-ingest
    domains_cp.update_domain(
        owner, domain_id, config=_blank_cfg("gemini/gemini-embedding-001")
    )
    with session_scope() as session:
        d = session.execute(
            select(DomainDocument).where(DomainDocument.id == doc_id)
        ).scalar_one()
        assert d.ingest_status == domains_cp.INGEST_PENDING
        assert "dimension" in (d.error_message or "").lower()
        chunk = session.execute(
            select(DomainChunk).where(DomainChunk.document_id == doc_id)
        ).scalar_one()
        assert chunk.embedding is None
