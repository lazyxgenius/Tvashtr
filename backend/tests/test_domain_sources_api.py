"""Revamp Domains — the Sources tab's reads (DM-33/34/37, DM-41…DM-47, DM-51, DM-52, DM-63):
the files list with search, the Show filter and its counts; one file's pieces and how often
answers cite it; downloading the original; the detail page's setup and answer-model keys. All
owner-scoped."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tvashtr.config import get_settings
from tvashtr.control_plane.domain_answers import cited_numbers, cited_sources, is_not_covered
from tvashtr.control_plane.domain_views import first_read_done, humanize_ingest_error
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import (
    DomainChunk,
    DomainDocument,
    DomainEvalCase,
    DomainMessage,
    ProviderCredential,
)


@pytest.fixture(autouse=True)
def _files_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-sources-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register", json={"email": email, "password": "domains-password"}
        ).status_code
        == 200
    )
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _key(owner: uuid.UUID, provider: str = "openai") -> None:
    with session_scope() as s:
        s.add(
            ProviderCredential(
                owner_id=owner, provider=provider, secret_encrypted="x", key_last4="abcd"
            )
        )


def _domain(c: TestClient, name: str = "Support docs") -> str:
    return c.post("/api/domains", json={"template": "support", "name": name}).json()["domain_id"]


def _doc(
    did: str,
    name: str,
    status: str = "ready",
    *,
    pieces: list[str] | None = None,
    embedded: int | None = None,
    error: str | None = None,
    version: int = 1,
    created: datetime | None = None,
    pages: list[int] | None = None,
) -> str:
    with session_scope() as s:
        doc = DomainDocument(
            domain_id=uuid.UUID(did),
            filename=name,
            content_type="text/markdown",
            storage_path=f"x/{uuid.uuid4().hex}/{name}",
            byte_size=18 * 1024,
            ingest_status=status,
            error_message=error,
            version=version,
        )
        if created is not None:
            doc.created_at = created
            doc.updated_at = created
        s.add(doc)
        s.flush()
        texts = pieces or []
        done = len(texts) if embedded is None else embedded
        for i, text in enumerate(texts):
            meta = {"filename": name}
            if pages:
                meta["page"] = pages[i]
            s.add(
                DomainChunk(
                    domain_id=uuid.UUID(did),
                    document_id=doc.id,
                    ordinal=i,
                    text=text,
                    embedding=[0.01] * 1536 if i < done else None,
                    meta=meta,
                )
            )
        return str(doc.id)


def _listing(c: TestClient, did: str, **params) -> dict:
    r = c.get(f"/api/domains/{did}/documents", params=params)
    assert r.status_code == 200, r.text
    return r.json()


# ---- the files list ----


def test_files_list_phases_counts_and_pieces():
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    t0 = datetime.now(UTC) - timedelta(days=3)
    a = _doc(did, "refund-policy.md", pieces=["Refunds within 30 days."] * 3, created=t0)
    _doc(
        did,
        "billing-faq.pdf",
        "error",
        error="no extractable text",
        created=t0 + timedelta(hours=1),
    )
    _doc(
        did,
        "getting-started.md",
        "indexing",
        pieces=["a", "b", "c", "d"],
        embedded=1,
        created=t0 + timedelta(hours=2),
    )
    _doc(did, "api-limits.html", "pending", created=t0 + timedelta(hours=3))
    out = _listing(c, did)
    assert [d["filename"] for d in out["documents"]] == [
        "refund-policy.md",
        "billing-faq.pdf",
        "getting-started.md",
        "api-limits.html",
    ]  # oldest first
    rows = {d["filename"]: d for d in out["documents"]}
    assert rows["refund-policy.md"]["phase"] == "ready"
    assert rows["refund-policy.md"]["pieces"] == 3
    assert rows["refund-policy.md"]["kind"] == "MD"
    assert rows["refund-policy.md"]["document_id"] == a
    assert rows["billing-faq.pdf"]["kind"] == "PDF"
    assert rows["billing-faq.pdf"]["phase"] == "needs_attention"
    assert rows["billing-faq.pdf"]["problem"]["kind"] == "no_text"
    assert rows["getting-started.md"]["phase"] == "reading"
    assert rows["getting-started.md"]["progress"] == 0.25
    assert rows["api-limits.html"]["phase"] == "waiting"
    assert rows["api-limits.html"]["kind"] == "HTML"
    assert out["counts"] == {"all": 4, "ready": 1, "reading": 2, "needs_attention": 1}
    assert out["total_pieces"] == 3
    # Old keys are still there.
    assert {"ingest_status", "byte_size", "error_message", "version"} <= set(
        rows["refund-policy.md"]
    )


def test_files_search_matches_names_and_text():
    c, owner = _fresh()
    did = _domain(c)
    _doc(did, "refund-policy.md", pieces=["How to get your money back."])
    _doc(did, "billing-faq.pdf", pieces=["Refunds are issued to the original card."])
    _doc(did, "sso-setup.md", pieces=["Single sign-on with Okta."])
    out = _listing(c, did, q="refund")
    assert [(d["filename"], d["matched"]) for d in out["documents"]] == [
        ("refund-policy.md", "name"),
        ("billing-faq.pdf", "text"),
    ]
    assert out["counts"]["all"] == 3  # counts stay unfiltered
    assert out["query"] == "refund"
    assert _listing(c, did, q="REFUND-POL")["documents"][0]["filename"] == "refund-policy.md"
    assert _listing(c, did, q="kubernetes")["documents"] == []


def test_files_show_filter():
    c, owner = _fresh()
    did = _domain(c)
    _doc(did, "a.md", pieces=["x"])
    _doc(did, "b.pdf", "error", error="401 invalid api key")
    _doc(did, "c.md", "pending")
    assert [d["filename"] for d in _listing(c, did, status="ready")["documents"]] == ["a.md"]
    assert [d["filename"] for d in _listing(c, did, status="needs_attention")["documents"]] == [
        "b.pdf"
    ]
    reading = _listing(c, did, status="reading")["documents"]
    assert [(d["filename"], d["phase"]) for d in reading] == [("c.md", "waiting_for_key")]
    bad = c.get(f"/api/domains/{did}/documents", params={"status": "done"})
    assert bad.status_code == 422


def test_files_list_is_owner_scoped():
    c, _ = _fresh()
    did = _domain(c)
    other, _ = _fresh()
    r = other.get(f"/api/domains/{did}/documents")
    assert r.status_code == 404 and r.json()["detail"] == "domain not found"


# ---- one file's pieces ----


def _answer(did: str, content: str, doc_ids: list[str], *, minutes_ago: int = 0) -> None:
    with session_scope() as s:
        s.add(
            DomainMessage(
                domain_id=uuid.UUID(did),
                role="assistant",
                content=content,
                citations=[
                    {"document_id": d, "filename": "f", "chunk_id": "c", "ordinal": 0}
                    for d in doc_ids
                ],
                created_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
            )
        )


def test_pieces_in_order_with_find_and_used_in_answers():
    c, _ = _fresh()
    did = _domain(c)
    texts = [
        "# Refund policy. When customers get their money back.",
        "Refunds apply to the subscription price only.",
        "Customers may request a full refund within 30 days.",
    ]
    doc = _doc(did, "refund-policy.md", pieces=texts, pages=[1, 1, 2])
    other = _doc(did, "billing-faq.pdf", pieces=["Invoices."])
    _answer(did, "Within 30 days [1].", [doc, other], minutes_ago=5)
    _answer(did, "Invoices monthly [2].", [doc, other], minutes_ago=4)
    _answer(did, "NOT_FOUND: nothing about SSO.", [doc], minutes_ago=3)
    _answer(did, "No marker, top two count.", [other, doc], minutes_ago=2)
    r = c.get(f"/api/domains/{did}/documents/{doc}/pieces")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["document"]["filename"] == "refund-policy.md"
    assert out["document"]["pieces"] == 3
    assert out["total"] == 3
    assert [p["number"] for p in out["pieces"]] == [1, 2, 3]
    assert out["pieces"][0] == {
        "ordinal": 0,
        "number": 1,
        "chars": len(texts[0]),
        "page": 1,
        "text": texts[0],
    }
    assert out["used_in_answers"] == {"count": 2, "of": 4}
    found = c.get(f"/api/domains/{did}/documents/{doc}/pieces", params={"q": "30 DAYS"}).json()
    assert [p["number"] for p in found["pieces"]] == [3]
    assert found["total"] == 1
    paged = c.get(
        f"/api/domains/{did}/documents/{doc}/pieces", params={"offset": 1, "limit": 1}
    ).json()
    assert [p["number"] for p in paged["pieces"]] == [2] and paged["total"] == 3
    literal = c.get(f"/api/domains/{did}/documents/{doc}/pieces", params={"q": "100%"}).json()
    assert literal["pieces"] == []


def test_pieces_owner_scoped_and_unknown():
    c, _ = _fresh()
    did = _domain(c)
    doc = _doc(did, "a.md", pieces=["x"])
    other, _ = _fresh()
    r = other.get(f"/api/domains/{did}/documents/{doc}/pieces")
    assert r.status_code == 404 and r.json()["detail"] == "domain not found"
    r = c.get(f"/api/domains/{did}/documents/{uuid.uuid4()}/pieces")
    assert r.status_code == 404 and r.json()["detail"] == "document not found"


# ---- download the original ----


def test_download_original_is_an_attachment():
    c, _ = _fresh()
    did = _domain(c)
    up = c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("refund policy.md", b"# Refunds\n", "text/markdown")},
    ).json()
    r = c.get(f"/api/domains/{did}/documents/{up['document_id']}/file")
    assert r.status_code == 200
    assert r.content == b"# Refunds\n"
    assert r.headers["content-type"].startswith("text/markdown")
    assert r.headers["content-disposition"] == "attachment; filename*=UTF-8''refund_policy.md"


def test_download_when_the_bytes_are_gone_and_owner_scope():
    c, _ = _fresh()
    did = _domain(c)
    doc = _doc(did, "gone.md", pieces=["x"])
    r = c.get(f"/api/domains/{did}/documents/{doc}/file")
    assert r.status_code == 404
    assert r.json()["detail"] == "The original file isn’t available any more."
    other, _ = _fresh()
    r = other.get(f"/api/domains/{did}/documents/{doc}/file")
    assert r.status_code == 404 and r.json()["detail"] == "domain not found"
    r = c.get(f"/api/domains/{did}/documents/{uuid.uuid4()}/file")
    assert r.status_code == 404 and r.json()["detail"] == "document not found"


# ---- the detail page ----


def test_detail_setup_answer_model_and_last_question():
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["setup"] == {"key": True, "files_read": False, "tested": False, "used": False}
    assert detail["answer_model"]["configured"] is None
    assert detail["last_question_at"] is None
    _doc(did, "a.md", pieces=["x"])
    with session_scope() as s:
        s.add(DomainEvalCase(domain_id=uuid.UUID(did), question="q?", ordinal=0))
        s.add(DomainMessage(domain_id=uuid.UUID(did), role="user", content="hello?"))
    c.patch(
        f"/api/domains/{did}",
        json={
            "config": {
                **detail["config"],
                "generation": {"model": "openai/gpt-4o-mini"},
            }
        },
    )
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["setup"] == {"key": True, "files_read": True, "tested": True, "used": False}
    assert detail["answer_model"] == {
        "configured": "openai/gpt-4o-mini",
        "resolved": "openai/gpt-4o-mini",
        "label": "OpenAI gpt-4o-mini",
        "provider": "openai",
        "key_saved": True,
    }
    assert detail["last_question_at"] is not None


def _row(status: str, *, version: int = 1, created: int = 0, updated: int = 0):
    base = datetime(2026, 9, 1, tzinfo=UTC)
    return DomainDocument(
        filename="f.md",
        content_type="text/markdown",
        storage_path="x",
        byte_size=1,
        ingest_status=status,
        version=version,
        created_at=base + timedelta(minutes=created),
        updated_at=base + timedelta(minutes=updated),
    )


def test_first_read_done_is_sticky():
    assert first_read_done([]) is False
    # First-4: one of three read, two still reading — the setup strip stays.
    first = [_row("ready", updated=5), _row("indexing", created=1), _row("pending", created=2)]
    assert first_read_done(first) is False
    assert first_read_done([_row("ready", updated=5), _row("error", updated=6)]) is True
    # Drag-2: new uploads after the first read finished don't bring the setup strip back.
    later = [_row("ready", updated=5), _row("pending", created=60)]
    assert first_read_done(later) is True
    # A full re-read (every file waiting again, versions bumped) doesn't either.
    assert first_read_done([_row("pending", version=2), _row("indexing", version=2)]) is True


# ---- pure helpers ----


def test_humanize_ingest_error():
    assert humanize_ingest_error("Error code: 403 - forbidden", "openrouter") == {
        "kind": "key_rejected",
        "message": "OpenRouter rejected the key (403).",
        "fix": "engines_key",
    }
    assert humanize_ingest_error("litellm.RateLimitError: 429 slow down", "huggingface") == {
        "kind": "rate_limited",
        "message": "Hugging Face is busy right now. Re-read it in a minute.",
        "fix": None,
    }
    assert humanize_ingest_error("unsupported file type: docx (allowed: …)", "openai")["kind"] == (
        "unsupported"
    )
    assert humanize_ingest_error("embedding dim 768 != 1536", "gemini") == {
        "kind": "wrong_dim",
        "message": "Couldn’t read this file: embedding dim 768 != 1536.",
        "fix": None,
    }
    assert humanize_ingest_error("Boom.\nTraceback …", "openai")["message"] == (
        "Couldn’t read this file: Boom."
    )


def test_cited_sources():
    cites = [{"document_id": str(i)} for i in range(1, 5)]
    assert cited_numbers("A [2], B [1, 3] and [2] again [9]") == [2, 1, 3, 9]
    assert [c["document_id"] for c in cited_sources("A [3] then [1]", cites)] == ["3", "1"]
    assert cited_sources("NOT_FOUND: nothing about it [1]", cites) == []
    assert is_not_covered("  not_found: x")
    assert [c["document_id"] for c in cited_sources("No markers.", cites)] == ["1", "2"]
    assert cited_sources("[7]", cites[:2]) == cites[:2]  # out of range → the top two
