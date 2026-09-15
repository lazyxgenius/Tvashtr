"""Phase 5 — Postgres FTS lexical retrieve over ready chunks."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_retrieve import retrieve_lexical_chunks
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _register_domain() -> tuple[uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"fts-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "fts-password"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "FTS"}).json()["domain_id"]
    )
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        return domain.owner_id, did


def test_lexical_ranks_keyword_chunk_first():
    _owner, did = _register_domain()
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="mix.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/mix.txt",
            byte_size=40,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take thirty business days to process.",
                embedding=[0.0] * 1536,
            )
        )
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=1,
                text="The SLA guarantees 99.9 percent uptime every month.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()

    hits = retrieve_lexical_chunks(did, "SLA uptime", 5)
    assert hits, "expected FTS hits for SLA uptime"
    assert "SLA" in hits[0]["text"] or "uptime" in hits[0]["text"].lower()
    assert hits[0]["filename"] == "mix.txt"
    assert hits[0]["score"] is not None


def test_lexical_ignores_non_ready_documents():
    _owner, did = _register_domain()
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="pending.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/pending.txt",
            byte_size=10,
            ingest_status="pending",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="SLA secret pending document",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()
    assert retrieve_lexical_chunks(did, "SLA secret", 5) == []


def test_lexical_top_k_coerce_bad_values(monkeypatch):
    class FakeSession:
        def execute(self, stmt):
            class R:
                def all(self):
                    return []

            return R()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_retrieve.session_scope",
        lambda: FakeSession(),
    )
    assert retrieve_lexical_chunks(uuid.uuid4(), "q", "oops") == []  # type: ignore[arg-type]
