"""Phase 2 — DBOS ingest workflow with mocked gateway embed."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.domain_ingest import (
    ingest_one_document_step,
    mark_docs_indexing_step,
    normalize_embedding_model,
)
from tvashtr.control_plane.domains import INGEST_INDEXING
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import DomainChunk, DomainDocument


def test_normalize_embedding_model():
    assert normalize_embedding_model("text-embedding-3-small") == "openai/text-embedding-3-small"
    assert (
        normalize_embedding_model("openai/text-embedding-3-small")
        == "openai/text-embedding-3-small"
    )
    assert (
        normalize_embedding_model("openrouter/openai/text-embedding-3-small")
        == "openrouter/openai/text-embedding-3-small"
    )


def _fresh_client() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"ingest-wf-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ingest-password"},
        ).status_code
        == 200
    )
    return c


def test_ingest_one_document_creates_chunks(monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()

    fake_vec = [0.01] * 1536

    class FakeResult:
        vectors = [fake_vec]
        model = "openai/text-embedding-3-small"
        prompt_tokens = 1
        total_tokens = 1
        cost_usd = 0.0

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.embed",
        lambda req: FakeResult(),
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.record_embedding_cost",
        lambda **kwargs: None,
    )
    # DBOS.workflow_id may be unset outside a workflow — stub it for the step.
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.DBOS.workflow_id",
        "test-wf",
        raising=False,
    )

    c = _fresh_client()
    me = c.get("/api/auth/me").json()
    owner_id = me["id"]
    did = c.post("/api/domains", json={"template": "support", "name": "WF"}).json()["domain_id"]
    doc = c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("notes.txt", b"hello world from domain ingest", "text/plain")},
    ).json()

    out = ingest_one_document_step(owner_id, did, doc["document_id"])
    assert out["ok"] is True
    assert out["chunks"] >= 1

    with session_scope() as session:
        row = session.execute(
            select(DomainDocument).where(DomainDocument.id == uuid.UUID(doc["document_id"]))
        ).scalar_one()
        assert row.ingest_status == "ready"
        n = session.execute(
            select(DomainChunk).where(DomainChunk.document_id == row.id)
        ).scalars().all()
        assert len(n) >= 1
        assert n[0].embedding is not None
        assert len(n[0].embedding) == 1536

    get_settings.cache_clear()


def _stub_ingest_deps(monkeypatch):
    fake_vec = [0.01] * 1536

    class FakeResult:
        vectors = [fake_vec]
        model = "openai/text-embedding-3-small"
        prompt_tokens = 1
        total_tokens = 1
        cost_usd = 0.0

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.embed",
        lambda req: FakeResult(),
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.record_embedding_cost",
        lambda **kwargs: None,
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.DBOS.workflow_id",
        "test-wf",
        raising=False,
    )


def test_mark_docs_indexing_includes_stuck_indexing(monkeypatch, tmp_path):
    """I1: re-ingest must re-select documents stuck in indexing."""
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()

    c = _fresh_client()
    me = c.get("/api/auth/me").json()
    owner_id = me["id"]
    did = c.post("/api/domains", json={"template": "support", "name": "Stuck"}).json()[
        "domain_id"
    ]
    doc = c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("notes.txt", b"recover me", "text/plain")},
    ).json()
    doc_id = uuid.UUID(doc["document_id"])

    with session_scope() as session:
        row = session.execute(
            select(DomainDocument).where(DomainDocument.id == doc_id)
        ).scalar_one()
        row.ingest_status = INGEST_INDEXING
        row.error_message = "crashed mid-ingest"
        session.flush()

    ids = mark_docs_indexing_step(owner_id, did)
    assert doc["document_id"] in ids

    with session_scope() as session:
        row = session.execute(
            select(DomainDocument).where(DomainDocument.id == doc_id)
        ).scalar_one()
        assert row.ingest_status == "indexing"
        assert row.error_message is None

    get_settings.cache_clear()


def test_empty_extract_marks_error_not_ready(monkeypatch, tmp_path):
    """I3: whitespace-only / empty extract must not become ready with 0 chunks."""
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()
    _stub_ingest_deps(monkeypatch)

    c = _fresh_client()
    me = c.get("/api/auth/me").json()
    owner_id = me["id"]
    did = c.post("/api/domains", json={"template": "support", "name": "Empty"}).json()[
        "domain_id"
    ]
    doc = c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("blank.txt", b"   \n\t  ", "text/plain")},
    ).json()

    out = ingest_one_document_step(owner_id, did, doc["document_id"])
    assert out["ok"] is False
    assert out["chunks"] == 0
    assert out["status"] == "error"

    with session_scope() as session:
        row = session.execute(
            select(DomainDocument).where(DomainDocument.id == uuid.UUID(doc["document_id"]))
        ).scalar_one()
        assert row.ingest_status == "error"
        assert row.error_message == "no extractable text"
        n = session.execute(
            select(DomainChunk).where(DomainChunk.document_id == row.id)
        ).scalars().all()
        assert n == []

    get_settings.cache_clear()
