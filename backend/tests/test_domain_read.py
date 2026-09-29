"""Revamp Domains — automatic reading (finding 3; DM-29, DM-42, DM-48, DM-50, DM-60).

An upload starts reading by itself, a domain reads one file at a time, key-less files wait and
start when the key is saved, and ``POST …/reread`` reads files again with their version bumped.
The gateway embed is faked; ``DBOS.start_workflow`` is recorded where a test only checks that a
read started, and the ``read_domain_files`` workflow is run synchronously where it checks reading.
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane import domain_read
from tvashtr.control_plane.domain_chunking import chunk_spans, chunk_text
from tvashtr.control_plane.domain_files import page_at
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingResult, GatewayError
from tvashtr.main import app
from tvashtr.models import DomainChunk, DomainDocument, ProviderCredential


@pytest.fixture(autouse=True)
def _files_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def started(monkeypatch):
    """Record ``DBOS.start_workflow`` calls instead of starting workflows."""
    calls: list[tuple] = []

    def _record(fn, *args, **kwargs):
        calls.append((fn, *args))

    monkeypatch.setattr(domain_read.DBOS, "start_workflow", _record)
    return calls


@pytest.fixture
def fake_embed(monkeypatch):
    """A gateway embed that returns one 1536-dim vector per input; the calls are kept."""
    calls: list[list[str]] = []

    def _embed(req):
        calls.append(list(req.input))
        return EmbeddingResult(
            vectors=[[0.01] * 1536 for _ in req.input],
            model=req.model,
            prompt_tokens=len(req.input),
            total_tokens=len(req.input),
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=1.0,
        )

    monkeypatch.setattr(domain_read, "embed", _embed)
    monkeypatch.setattr(domain_read, "resolve_owner_api_key", lambda oid, model: "sk-test")
    monkeypatch.setattr(domain_read, "record_embedding_cost", lambda **kwargs: None)
    return calls


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-read-{uuid.uuid4().hex}@tvashtr.local"
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
    r = c.post("/api/domains", json={"template": "support", "name": name})
    assert r.status_code == 200, r.text
    return r.json()["domain_id"]


def _upload(c: TestClient, did: str, name: str, body: bytes) -> dict:
    r = c.post(f"/api/domains/{did}/documents", files={"file": (name, body, "text/markdown")})
    assert r.status_code == 200, r.text
    return r.json()


def _docs(c: TestClient, did: str, **params) -> dict:
    r = c.get(f"/api/domains/{did}/documents", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def _status(doc_id: str) -> tuple[str, int]:
    with session_scope() as s:
        doc = s.get(DomainDocument, uuid.UUID(doc_id))
        return doc.ingest_status, doc.version


# ---- pure helpers ----


def test_chunk_spans_are_chunk_text_with_offsets():
    text = "  \n" + "abcdefghij" * 23 + "\n"
    spans = chunk_spans(text, size=50, overlap=10)
    assert [p for _, p in spans] == chunk_text(text, size=50, overlap=10)
    for offset, piece in spans:
        assert text[offset : offset + len(piece)] == piece


def test_page_at_maps_offsets_to_pages():
    starts = [(0, 1), (120, 2), (300, 4)]
    assert page_at(starts, 0) == 1
    assert page_at(starts, 119) == 1
    assert page_at(starts, 120) == 2
    assert page_at(starts, 999) == 4
    assert page_at([], 5) is None


# ---- upload starts reading ----


def test_upload_without_a_key_waits_for_the_key(started):
    c, _ = _fresh()
    did = _domain(c)
    doc = _upload(c, did, "refund-policy.md", b"# Refunds\nWithin 30 days.")
    assert doc["reading"] == "waiting_for_key"
    assert doc["ingest_status"] == "pending"  # the old keys are unchanged
    assert started == []
    item = _docs(c, did)["documents"][0]
    assert item["phase"] == "waiting_for_key"
    assert item["pieces"] is None and item["progress"] is None


def test_upload_with_a_key_starts_one_read_and_queues_the_rest(started):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    first = _upload(c, did, "refund-policy.md", b"# Refunds\nWithin 30 days.")
    second = _upload(c, did, "billing-faq.md", b"# Billing\nInvoices monthly.")
    assert first["reading"] == "started"
    assert second["reading"] == "queued"
    assert len(started) == 1
    fn, owner_arg, domain_arg, doc_arg, run_tests = started[0]
    assert fn is domain_read.read_domain_files
    assert (owner_arg, domain_arg, doc_arg, run_tests) == (
        str(owner),
        did,
        first["document_id"],
        False,
    )
    phases = {d["filename"]: (d["phase"], d["progress"]) for d in _docs(c, did)["documents"]}
    assert phases == {"refund-policy.md": ("reading", 0.0), "billing-faq.md": ("waiting", None)}


def test_a_stale_read_does_not_block_a_new_one(started):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    first = _upload(c, did, "a.md", b"alpha text")
    with session_scope() as s:
        doc = s.get(DomainDocument, uuid.UUID(first["document_id"]))
        doc.updated_at = datetime.now(UTC) - timedelta(minutes=30)
    second = _upload(c, did, "b.md", b"beta text")
    assert second["reading"] == "started"
    # The oldest claimable file (the stale one) is read first.
    assert started[-1][3] == first["document_id"]


# ---- the workflow ----


def test_read_domain_files_reads_every_waiting_file_one_at_a_time(client, started, fake_embed):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    body = ("Refunds apply to the subscription price only. " * 40).encode()
    a = _upload(c, did, "refund-policy.md", body)
    b = _upload(c, did, "billing-faq.md", b"Invoices are sent monthly.")
    out = domain_read.read_domain_files(str(owner), did, a["document_id"])
    assert [d["ok"] for d in out["documents"]] == [True, True]
    assert [d["document_id"] for d in out["documents"]] == [a["document_id"], b["document_id"]]
    assert _status(a["document_id"])[0] == "ready"
    assert _status(b["document_id"])[0] == "ready"
    with session_scope() as s:
        chunks = list(
            s.execute(
                select(DomainChunk)
                .where(DomainChunk.document_id == uuid.UUID(a["document_id"]))
                .order_by(DomainChunk.ordinal)
            ).scalars()
        )
    assert len(chunks) > 3  # 600-character pieces of a ~1,900-character file
    assert all(ch.embedding is not None for ch in chunks)
    assert chunks[0].meta == {"filename": "refund-policy.md", "chunk_size": 600}
    # Embedded in batches of at most 16.
    assert all(len(batch) <= 16 for batch in fake_embed)
    listing = _docs(c, did)
    assert listing["counts"] == {"all": 2, "ready": 2, "reading": 0, "needs_attention": 0}
    assert listing["total_pieces"] == sum(d["pieces"] for d in listing["documents"])
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["state"] == "ready"
    assert detail["setup"]["files_read"] is True


def test_progress_is_embedded_pieces_over_pieces(started, fake_embed):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    doc = _upload(c, did, "long.md", ("word " * 4000).encode())
    prepared = domain_read.prepare_document_step(str(owner), did, doc["document_id"])
    total = prepared["pieces"]
    assert prepared["error"] is None and total > 16
    assert domain_read.embed_batch_step(str(owner), did, doc["document_id"], 0, 16) == {
        "error": None
    }
    item = _docs(c, did)["documents"][0]
    assert item["phase"] == "reading"
    assert item["pieces_total"] == total and item["pieces_done"] == 16
    assert item["progress"] == round(16 / total, 4)
    assert item["pieces"] is None  # the Pieces column shows "—" until the file is ready


def test_a_rejected_key_is_humanised(client, started, monkeypatch):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    doc = _upload(c, did, "billing-faq.md", b"Invoices are sent monthly.")

    def _reject(req):
        raise GatewayError("AuthenticationError: 401 Incorrect API key provided")

    monkeypatch.setattr(domain_read, "embed", _reject)
    monkeypatch.setattr(domain_read, "resolve_owner_api_key", lambda oid, model: "sk-bad")
    out = domain_read.read_domain_files(str(owner), did, doc["document_id"])
    assert out["documents"] == [{"document_id": doc["document_id"], "ok": False}]
    item = _docs(c, did)["documents"][0]
    assert item["phase"] == "needs_attention"
    assert item["problem"] == {
        "kind": "key_rejected",
        "message": "OpenAI rejected the key (401).",
        "fix": "engines_key",
    }
    with session_scope() as s:
        left = s.execute(
            select(DomainChunk).where(DomainChunk.document_id == uuid.UUID(doc["document_id"]))
        ).all()
    assert left == []  # a failed read leaves no half-embedded pieces behind
    listing = _docs(c, did, status="needs_attention")
    assert [d["filename"] for d in listing["documents"]] == ["billing-faq.md"]


def test_a_file_with_no_text_needs_attention(client, started, fake_embed):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    doc = _upload(c, did, "blank.md", b"   \n\n  ")
    domain_read.read_domain_files(str(owner), did, doc["document_id"])
    item = _docs(c, did)["documents"][0]
    assert item["problem"]["kind"] == "no_text"
    assert item["problem"]["message"] == (
        "No text found. It may be a scanned image. Export it as text-based PDF."
    )
    assert fake_embed == []


# ---- a saved key resumes waiting files ----


def test_saving_the_reading_key_starts_waiting_files(started):
    c, owner = _fresh()
    did = _domain(c)
    doc = _upload(c, did, "refund-policy.md", b"# Refunds")
    assert doc["reading"] == "waiting_for_key"
    r = c.post("/api/providers", json={"provider": "openai", "api_key": "sk-test-1234"})
    assert r.status_code == 200, r.text
    assert [call[3] for call in started] == [doc["document_id"]]
    assert _status(doc["document_id"]) == ("indexing", 1)


def test_saving_a_key_starts_only_the_callers_waiting_files(started):
    """Review (missing cross-account test): another account's files waiting for the same
    provider's key stay waiting — a key save never reads them."""
    c, _ = _fresh()
    mine = _upload(c, _domain(c), "refund-policy.md", b"# Refunds")
    other, _ = _fresh()
    theirs = _upload(other, _domain(other), "secret.md", b"# Secret")
    assert (mine["reading"], theirs["reading"]) == ("waiting_for_key", "waiting_for_key")
    r = c.post("/api/providers", json={"provider": "openai", "api_key": "sk-test-1234"})
    assert r.status_code == 200, r.text
    assert [call[3] for call in started] == [mine["document_id"]]
    assert _status(theirs["document_id"]) == ("pending", 1)


def test_saving_another_providers_key_starts_nothing(started):
    c, owner = _fresh()
    did = _domain(c)
    _upload(c, did, "refund-policy.md", b"# Refunds")
    r = c.post("/api/providers", json={"provider": "groq", "api_key": "gsk-test-1234"})
    assert r.status_code == 200, r.text
    assert started == []


def test_a_failing_resume_never_fails_the_key_save(monkeypatch):
    c, _ = _fresh()

    def _boom(owner_id, provider):
        raise RuntimeError("boom")

    monkeypatch.setattr(domain_read, "resume_waiting", _boom)
    r = c.post("/api/providers", json={"provider": "openai", "api_key": "sk-test-1234"})
    assert r.status_code == 200


# ---- re-read ----


def _ready_doc(did: str, name: str, *, version: int = 1, status: str = "ready") -> str:
    with session_scope() as s:
        doc = DomainDocument(
            domain_id=uuid.UUID(did),
            filename=name,
            content_type="text/markdown",
            storage_path=f"x/{uuid.uuid4().hex}",
            byte_size=100,
            ingest_status=status,
            version=version,
        )
        s.add(doc)
        s.flush()
        return str(doc.id)


def test_reread_one_file_bumps_its_version_and_starts_reading(started):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    a = _ready_doc(did, "billing-faq.pdf", status="error")
    b = _ready_doc(did, "refund-policy.md")
    r = c.post(f"/api/domains/{did}/reread", json={"document_ids": [a]})
    assert r.status_code == 202, r.text
    assert r.json() == {"reading": 1, "run_tests_after": False, "state": "started"}
    assert _status(a) == ("indexing", 2)
    assert _status(b) == ("ready", 1)
    item = next(d for d in _docs(c, did)["documents"] if d["document_id"] == a)
    assert item["phase"] == "rereading"
    assert item["problem"] is None


def test_reread_everything_and_the_conflict(started):
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    ids = [_ready_doc(did, f"f{i}.md") for i in range(3)]
    r = c.post(f"/api/domains/{did}/reread", json={"run_tests_after": True})
    assert r.status_code == 202, r.text
    assert r.json()["reading"] == 3 and r.json()["run_tests_after"] is True
    assert started[0][4] is True
    assert sorted(_status(i)[1] for i in ids) == [2, 2, 2]
    assert c.get(f"/api/domains/{did}").json()["state"] == "rereading"
    again = c.post(f"/api/domains/{did}/reread", json={})
    assert again.status_code == 409
    assert again.json()["detail"] == "This domain is already re-reading."


def test_reread_without_a_key_waits(started):
    c, _ = _fresh()
    did = _domain(c)
    a = _ready_doc(did, "a.md")
    r = c.post(f"/api/domains/{did}/reread", json={"document_ids": [a]})
    assert r.status_code == 202
    assert r.json()["state"] == "waiting_for_key"
    assert started == []


def test_reread_owner_scoped_and_unknown_files(started):
    c, owner = _fresh()
    did = _domain(c)
    other, _ = _fresh()
    r = other.post(f"/api/domains/{did}/reread", json={})
    assert r.status_code == 404 and r.json()["detail"] == "domain not found"
    r = c.post(f"/api/domains/{did}/reread", json={"document_ids": [str(uuid.uuid4())]})
    assert r.status_code == 404 and r.json()["detail"] == "document not found"
    r = c.post(f"/api/domains/{did}/reread", json={"document_ids": ["nope"]})
    assert r.status_code == 400
    r = c.post(f"/api/domains/{uuid.uuid4()}/reread", json={})
    assert r.status_code == 404


def test_tests_after_a_reread_run_even_when_a_read_was_already_running(
    client, started, fake_embed, monkeypatch
):
    """A re-read that asks for the tests while another file is being read joins that read (DM-90):
    the running workflow reads the file and runs the tests when it's done."""
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    a = _upload(c, did, "refund-policy.md", b"# Refunds\nWithin 30 days.")
    b = _upload(c, did, "billing-faq.md", b"# Billing\nInvoices monthly.")
    assert (a["reading"], b["reading"]) == ("started", "queued")
    r = c.post(
        f"/api/domains/{did}/reread",
        json={"document_ids": [b["document_id"]], "run_tests_after": True},
    )
    assert r.json()["state"] == "queued"
    assert c.get(f"/api/domains/{did}").json()["rereading"]["run_tests_after"] is True
    ran: list[str] = []
    monkeypatch.setattr(
        domain_read, "run_tests_after_read_step", lambda o, d: ran.append(d) or {"ok": True}
    )
    out = domain_read.read_domain_files(str(owner), did, a["document_id"], False)
    assert [d["ok"] for d in out["documents"]] == [True, True]
    assert ran == [did] and out["tests"] == {"ok": True}
    assert _status(b["document_id"]) == ("ready", 2)
    assert c.get(f"/api/domains/{did}").json()["rereading"] is None


def test_files_left_waiting_start_reading_when_the_domain_is_opened(started):
    """Files uploaded before reading was automatic (or left by a read that died) are picked up
    the next time the list or the domain is loaded — not left "Reading" forever."""
    c, owner = _fresh()
    _key(owner)
    dids = [_domain(c, "Support docs"), _domain(c, "Vendor contracts")]
    with session_scope() as s:
        for did in dids:
            s.add(
                DomainDocument(
                    domain_id=uuid.UUID(did),
                    filename="old.md",
                    content_type="text/markdown",
                    storage_path=f"x/{uuid.uuid4().hex}",
                    byte_size=10,
                    ingest_status="pending",
                )
            )
    assert started == []
    assert c.get(f"/api/domains/{dids[0]}").status_code == 200
    assert [call[2] for call in started] == [dids[0]]
    assert c.get(f"/api/domains/{dids[0]}").status_code == 200  # reading now: nothing new
    assert c.get("/api/domains").status_code == 200
    assert [call[2] for call in started] == dids


# ---- review finding 4: Desktop 0.10.0's Ingest button (POST /ingest) joins the automatic read ----


@pytest.fixture
def handles(monkeypatch):
    """Record ``DBOS.start_workflow`` calls; each returns a handle with a known workflow id."""
    calls: list[tuple] = []

    def _record(fn, *args, **kwargs):
        calls.append((fn, *args))
        return type("Handle", (), {"workflow_id": f"wf-{len(calls)}"})()

    monkeypatch.setattr(domain_read.DBOS, "start_workflow", _record)
    return calls


def test_the_old_ingest_button_never_starts_a_second_read(handles):
    """Uploading with a key starts reading; the old Ingest button then must not start the legacy
    ``ingest_domain`` workflow (which re-marks every waiting/reading file ``indexing`` and reads
    them again beside the running read). The answer keeps its old fields."""
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    a = _upload(c, did, "refund-policy.md", b"# Refunds\nWithin 30 days.")
    b = _upload(c, did, "billing-faq.md", b"# Billing\nInvoices monthly.")
    assert (a["reading"], b["reading"]) == ("started", "queued")

    r = c.post(f"/api/domains/{did}/ingest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["domain_id"], body["status"]) == (did, "indexing")
    assert isinstance(body["workflow_id"], str)
    assert [call[0] for call in handles] == [domain_read.read_domain_files]
    assert _status(a["document_id"])[0] == "indexing"  # still its one reader's
    assert _status(b["document_id"])[0] == "pending"  # still queued for that same read


def test_the_old_ingest_button_reads_failed_files_again(handles):
    """The old Ingest retried files that failed; it still does — through the automatic read."""
    c, owner = _fresh()
    _key(owner)
    did = _domain(c)
    a = _upload(c, did, "refund-policy.md", b"# Refunds\nWithin 30 days.")
    with session_scope() as s:
        doc = s.get(DomainDocument, uuid.UUID(a["document_id"]))
        doc.ingest_status, doc.error_message = "error", "no extractable text"

    r = c.post(f"/api/domains/{did}/ingest")
    assert r.status_code == 200, r.text
    assert r.json()["workflow_id"] == "wf-2"
    assert [call[0] for call in handles] == [domain_read.read_domain_files] * 2
    assert handles[1][3] == a["document_id"]
    assert _status(a["document_id"])[0] == "indexing"
