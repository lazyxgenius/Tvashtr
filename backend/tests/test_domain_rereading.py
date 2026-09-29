"""Revamp Domains — changing how files are read (DM-88…DM-90, OQ-17, OQ-24; DmF-Embed, DmF-Piece).

A reading-model change re-reads every file whenever the model's weights differ (finding 1: the old
rule cleared vectors only on a dimension change, so 3-small → ada-002 kept stale vectors). The
same weights through another route (OpenRouter) keep their vectors. The PATCH says what saving
meant (``reread``), the detail carries the running re-read (``rereading``), and asking pauses while
a model change is being read.
"""

import threading
import time
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from tvashtr.control_plane import domain_read
from tvashtr.control_plane import domains as domains_cp
from tvashtr.control_plane.domain_embedding import (
    READ_PIECES_PER_SECOND,
    read_seconds,
    same_embedding_weights,
)
from tvashtr.control_plane.domains import model_rereading
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingResult
from tvashtr.main import app
from tvashtr.models import DomainChunk, DomainDocument, ProviderCredential


@pytest.fixture
def started(monkeypatch):
    """Record ``DBOS.start_workflow`` calls instead of starting workflows."""
    calls: list[tuple] = []
    monkeypatch.setattr(domain_read.DBOS, "start_workflow", lambda fn, *a, **k: calls.append(a))
    return calls


def _fresh() -> tuple[TestClient, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"domain-reread-{uuid.uuid4().hex}@tvashtr.local"
    r = c.post("/api/auth/register", json={"email": email, "password": "domains-password"})
    assert r.status_code == 200
    return c, uuid.UUID(c.get("/api/auth/me").json()["id"])


def _key(owner: uuid.UUID, provider: str = "openai") -> None:
    with session_scope() as s:
        s.add(
            ProviderCredential(
                owner_id=owner, provider=provider, secret_encrypted="x", key_last4="abcd"
            )
        )


def _domain(c: TestClient) -> tuple[str, dict]:
    r = c.post("/api/domains", json={"name": "Support docs", "template": "support"})
    assert r.status_code == 200, r.text
    return r.json()["domain_id"], r.json()["config"]


def _read_doc(did: str, name: str, pieces: int = 2, dim: int = 1536) -> str:
    """A file read with embedded pieces (as the workflow leaves it)."""
    with session_scope() as s:
        doc = DomainDocument(
            domain_id=uuid.UUID(did),
            filename=name,
            content_type="text/markdown",
            storage_path=f"x/{uuid.uuid4().hex}",
            byte_size=100,
            ingest_status="ready",
        )
        s.add(doc)
        s.flush()
        for i in range(pieces):
            s.add(
                DomainChunk(
                    domain_id=uuid.UUID(did),
                    document_id=doc.id,
                    ordinal=i,
                    text=f"piece {i} of {name}",
                    embedding=[0.1] * dim,
                    meta={},
                )
            )
        return str(doc.id)


def _model(cfg: dict, slug: str) -> dict:
    return {**cfg, "embedding": {**cfg["embedding"], "model": slug}}


def _doc(doc_id: str) -> DomainDocument:
    with session_scope() as s:
        doc = s.get(DomainDocument, uuid.UUID(doc_id))
        s.expunge(doc)
        return doc


def _embedded(doc_id: str) -> int:
    with session_scope() as s:
        return len(
            s.execute(
                select(DomainChunk.id).where(
                    DomainChunk.document_id == uuid.UUID(doc_id), DomainChunk.embedding.isnot(None)
                )
            ).all()
        )


# ---- the same-weights rule (OQ-17) ----


def test_same_embedding_weights_ignores_only_the_route():
    assert same_embedding_weights("text-embedding-3-small", "openai/text-embedding-3-small")
    assert same_embedding_weights(
        "openai/text-embedding-3-small", "openrouter/openai/text-embedding-3-small"
    )
    assert not same_embedding_weights(
        "openai/text-embedding-3-small", "openai/text-embedding-ada-002"
    )
    assert not same_embedding_weights(
        "openrouter/openai/text-embedding-3-small", "openai/text-embedding-ada-002"
    )
    assert not same_embedding_weights(
        "openai/text-embedding-3-small", "gemini/gemini-embedding-001"
    )


def test_switching_to_other_weights_of_the_same_size_clears_the_vectors(started):
    """Finding 1: 3-small → ada-002 (both 1536) kept 3-small vectors that ada-002 can't compare."""
    c, owner = _fresh()
    _key(owner)
    did, cfg = _domain(c)
    doc = _read_doc(did, "refund-policy.md")
    r = c.patch(
        f"/api/domains/{did}", json={"config": _model(cfg, "openai/text-embedding-ada-002")}
    )
    assert r.status_code == 200, r.text
    assert _embedded(doc) == 0
    assert _doc(doc).ingest_status in ("pending", "indexing")


def test_the_same_weights_through_openrouter_keep_their_vectors(started):
    c, owner = _fresh()
    _key(owner)
    did, cfg = _domain(c)
    doc = _read_doc(did, "refund-policy.md")
    r = c.patch(
        f"/api/domains/{did}",
        json={"config": _model(cfg, "openrouter/openai/text-embedding-3-small")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["reread"] == {"needed": "none", "reason": None}
    assert _embedded(doc) == 2
    assert _doc(doc).ingest_status == "ready"
    assert started == []


def test_read_seconds_is_pieces_at_the_models_pace():
    # The Embed/Piece boards' "about 2 minutes" for Support docs' 1,212 pieces.
    assert READ_PIECES_PER_SECOND["gemini"] == 10.0
    assert read_seconds(1212, "gemini/gemini-embedding-001") == 121
    assert read_seconds(1212, "text-embedding-3-small") == 121
    assert read_seconds(1212, "huggingface/BAAI/bge-small-en-v1.5") == 606
    assert read_seconds(0, "text-embedding-3-small") == 0
    assert read_seconds(1, "text-embedding-3-small") == 1


# ---- what saving meant (PATCH ``reread``) and the running re-read (detail ``rereading``) ----


def test_a_new_reading_model_rereads_every_file_and_pauses_asking(started):
    c, owner = _fresh()
    _key(owner)
    _key(owner, "gemini")
    did, cfg = _domain(c)
    docs = [_read_doc(did, n, pieces=3) for n in ("refund-policy.md", "billing-faq.pdf")]
    r = c.patch(f"/api/domains/{did}", json={"config": _model(cfg, "gemini/gemini-embedding-001")})
    assert r.status_code == 200, r.text
    assert r.json()["reread"] == {"needed": "required", "reason": "reading_model"}
    assert len(started) == 1  # reading started: one file at a time (OQ-24)
    assert sorted(_doc(d).version for d in docs) == [2, 2]
    assert all(_embedded(d) == 0 for d in docs)
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["state"] == "rereading"
    assert detail["rereading"] == {
        "total": 2,
        "done": 0,
        "eta_seconds": 1,  # 6 pieces at 10 a second
        "reason": "reading_model",
        "run_tests_after": False,
    }
    # One file read with the new model: one done, asking still paused until the last one.
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(docs[0])).ingest_status = "ready"
        s.get(DomainDocument, uuid.UUID(docs[0])).error_message = None
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["rereading"]["done"] == 1 and detail["rereading"]["total"] == 2
    ask = c.post(f"/api/domains/{did}/ask", json={"question": "How long do refunds take?"})
    assert ask.status_code == 409
    assert ask.json()["detail"] == "Ask is paused while Support docs re-reads its files."
    found = c.post(f"/api/domains/{did}/retrieve", json={"query": "refunds"})
    assert found.status_code == 409
    # The last one read: the re-read is over.
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(docs[1])).ingest_status = "ready"
        s.get(DomainDocument, uuid.UUID(docs[1])).error_message = None
    assert c.get(f"/api/domains/{did}").json()["rereading"] is None


def test_a_new_reading_model_on_an_empty_domain_needs_no_reread(started):
    c, owner = _fresh()
    did, cfg = _domain(c)
    r = c.patch(
        f"/api/domains/{did}", json={"config": _model(cfg, "openai/text-embedding-ada-002")}
    )
    assert r.status_code == 200, r.text
    assert r.json()["reread"] == {"needed": "none", "reason": None}
    assert started == []
    assert c.get(f"/api/domains/{did}").json()["rereading"] is None


def test_a_new_piece_size_leaves_files_until_they_are_read_again(started):
    c, owner = _fresh()
    _key(owner)
    did, cfg = _domain(c)
    docs = [_read_doc(did, f"f{i}.md") for i in range(3)]
    pieces = {**cfg, "chunking": {**cfg["chunking"], "size": 400}}
    r = c.patch(f"/api/domains/{did}", json={"config": pieces})
    assert r.status_code == 200, r.text
    assert r.json()["reread"] == {"needed": "optional", "reason": "pieces"}
    assert started == []
    assert all(_doc(d).ingest_status == "ready" and _embedded(d) == 2 for d in docs)
    # DM-90 with both boxes ticked: re-read all, then run the tests.
    r = c.post(f"/api/domains/{did}/reread", json={"run_tests_after": True})
    assert r.status_code == 202, r.text
    detail = c.get(f"/api/domains/{did}").json()
    assert detail["rereading"] == {
        "total": 3,
        "done": 0,
        "eta_seconds": 1,
        "reason": "files",
        "run_tests_after": True,
    }
    # Asking isn't paused by a piece-size re-read (the model's vectors still compare).
    assert not model_rereading(uuid.UUID(did))


def test_a_reread_asked_for_during_another_joins_it(started):
    c, owner = _fresh()
    _key(owner)
    did, _ = _domain(c)
    docs = [_read_doc(did, f"f{i}.md") for i in range(3)]
    assert c.post(f"/api/domains/{did}/reread", json={}).status_code == 202
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(docs[0])).ingest_status = "ready"
    # Re-reading the finished file again keeps it in the same re-read.
    r = c.post(f"/api/domains/{did}/reread", json={"document_ids": [docs[0]]})
    assert r.status_code == 202, r.text
    assert sorted(_doc(d).version for d in docs) == [2, 2, 2]
    assert c.get(f"/api/domains/{did}").json()["rereading"]["total"] == 3
    # Once it's over, a later single-file re-read is a re-read of its own.
    with session_scope() as s:
        for d in docs:
            s.get(DomainDocument, uuid.UUID(d)).ingest_status = "ready"
    assert c.post(f"/api/domains/{did}/reread", json={"document_ids": [docs[1]]}).status_code == 202
    assert _doc(docs[1]).version == 3
    rereading = c.get(f"/api/domains/{did}").json()["rereading"]
    assert (rereading["total"], rereading["done"], rereading["reason"]) == (1, 0, "files")


# ---- review findings (FINISH stage) ----


def test_a_model_change_mid_read_leaves_the_file_to_the_running_read(started, monkeypatch):
    """A new reading model while a file is being read must not start a second reader (OQ-24):
    the file being read keeps its reader, and that reader puts it back to waiting when its
    pieces lost their vectors, then carries on with the next file."""
    c, owner = _fresh()
    _key(owner)
    _key(owner, "gemini")
    did, cfg = _domain(c)
    docs = [_read_doc(did, n) for n in ("a.md", "b.md", "c.md")]
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(docs[1])).ingest_status = "indexing"  # read right now
    r = c.patch(f"/api/domains/{did}", json={"config": _model(cfg, "gemini/gemini-embedding-001")})
    assert r.status_code == 200, r.text
    assert started == []  # the running read takes the re-read over
    reading = _doc(docs[1])
    assert reading.ingest_status == "indexing" and reading.version == 2
    assert reading.error_message.startswith("embedding model")
    assert [_doc(d).ingest_status for d in (docs[0], docs[2])] == ["pending", "pending"]
    # The running read finishes its file: the old vectors are gone, so it goes back to waiting
    # (keeping the mark) and the same read claims the oldest waiting file next.
    nxt = domain_read.finish_document_step(str(owner), did, docs[1], None)
    assert nxt == docs[0]
    back = _doc(docs[1])
    assert back.ingest_status == "pending" and back.error_message.startswith("embedding model")
    assert model_rereading(uuid.UUID(did))


def test_a_batch_embedded_with_the_old_model_is_not_stored(started, monkeypatch):
    c, owner = _fresh()
    _key(owner)
    _key(owner, "gemini")
    did, cfg = _domain(c)
    doc = _read_doc(did, "a.md")
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(doc)).ingest_status = "indexing"
        for ch in s.execute(select(DomainChunk).where(DomainChunk.document_id == uuid.UUID(doc))):
            ch[0].embedding = None

    def _embed(req):
        # The model changes while this batch is out at the provider.
        c.patch(f"/api/domains/{did}", json={"config": _model(cfg, "gemini/gemini-embedding-001")})
        return EmbeddingResult(
            vectors=[[0.01] * 1536 for _ in req.input],
            model=req.model,
            prompt_tokens=1,
            total_tokens=1,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=1.0,
        )

    monkeypatch.setattr(domain_read, "embed", _embed)
    monkeypatch.setattr(domain_read, "resolve_owner_api_key", lambda oid, model: "sk-test")
    monkeypatch.setattr(domain_read, "record_embedding_cost", lambda **kwargs: None)
    assert domain_read.embed_batch_step(str(owner), did, doc, 0, 2) == {"error": None}
    assert _embedded(doc) == 0


def test_an_old_model_mark_on_a_first_read_does_not_pause_asking():
    """Files reset by the pre-revamp dimension-change path carry the old mark at version 1: they
    are a first read, not a model re-read, so asking isn't paused."""
    c, owner = _fresh()
    did, _ = _domain(c)
    doc = _read_doc(did, "a.md")
    with session_scope() as s:
        row = s.get(DomainDocument, uuid.UUID(doc))
        row.ingest_status = "pending"
        row.error_message = "embedding model dimension changed — re-ingest required"
    assert not model_rereading(uuid.UUID(did))


def test_a_reread_with_the_same_model_keeps_the_files_searchable(started):
    """DM-90: re-reading with new piece sizes keeps the old pieces answering questions until
    each file's new pieces replace them."""
    from tvashtr.control_plane.domain_ask import count_ready_chunks
    from tvashtr.control_plane.domain_retrieve import retrieve_domain_chunks

    c, owner = _fresh()
    _key(owner)
    did, _ = _domain(c)
    for i in range(2):
        _read_doc(did, f"f{i}.md")
    assert c.post(f"/api/domains/{did}/reread", json={}).status_code == 202
    assert c.get(f"/api/domains/{did}").json()["pieces"] == 4
    with session_scope() as s:
        assert count_ready_chunks(s, uuid.UUID(did)) == 4
    assert len(retrieve_domain_chunks(uuid.UUID(did), [0.1] * 1536, 8)) == 4


# ---- review finding 2: a model change is serialized with the reader (the domain's lock) ----
#
# Each test pauses one side at the racy point in a thread, lets the other side run until it either
# finishes or waits on a database lock (read from ``pg_stat_activity``), then lets the first go on.
# Without the domain's advisory lock on both sides the second side never waits, so the stale write
# lands; with it, the second side waits and the two run one after the other.


def _until_a_lock_waiter_or(done: threading.Event, timeout: float = 10.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and not done.is_set():
        with session_scope() as s:
            waiting = s.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity"
                    " WHERE datname = current_database() AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
        if waiting:
            return
        time.sleep(0.02)


def _in_thread(fn, *args, **kwargs) -> tuple[threading.Thread, threading.Event, dict]:
    done, out = threading.Event(), {}

    def _run():
        try:
            out["value"] = fn(*args, **kwargs)
        except BaseException as exc:  # surfaced by the test's asserts
            out["error"] = exc
        finally:
            done.set()

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return t, done, out


def test_a_model_change_mid_finish_leaves_no_file_ready_without_vectors(monkeypatch):
    """Interleaving: the model change clears the vectors while the reader is finishing the file.
    The reader must see the cleared vectors (file back to waiting), never mark it ready."""
    c, owner = _fresh()
    _key(owner)
    _key(owner, "gemini")
    did, cfg = _domain(c)
    doc = _read_doc(did, "a.md")
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(doc)).ingest_status = "indexing"

    paused, release = threading.Event(), threading.Event()
    real = domains_cp._apply_domain_aggregates

    def _slow(session, domain):
        session.flush()  # the model change's writes are made; it has not committed yet
        paused.set()
        release.wait(10)
        return real(session, domain)

    monkeypatch.setattr(domains_cp, "_apply_domain_aggregates", _slow)
    change, change_done, change_out = _in_thread(
        domains_cp.update_domain,
        owner,
        uuid.UUID(did),
        config=_model(cfg, "gemini/gemini-embedding-001"),
    )
    assert paused.wait(10)
    finish, finish_done, finish_out = _in_thread(
        domain_read.finish_document_step, str(owner), did, doc, None
    )
    _until_a_lock_waiter_or(finish_done)
    release.set()
    change.join(10)
    finish.join(10)
    assert "error" not in change_out and "error" not in finish_out
    assert _embedded(doc) == 0
    assert _doc(doc).ingest_status != "ready"
    assert finish_out["value"] == doc  # back to waiting, and claimed again for the new model


def test_a_batch_checked_against_the_old_model_is_not_stored_after_the_change(monkeypatch):
    """Interleaving: the reader checks the model, the model change commits, then the reader writes
    its old-model vectors. With the lock the change waits until the batch is written, then clears
    it — no old-model vector survives the change."""
    c, owner = _fresh()
    _key(owner)
    _key(owner, "gemini")
    did, cfg = _domain(c)
    doc = _read_doc(did, "a.md")
    with session_scope() as s:
        s.get(DomainDocument, uuid.UUID(doc)).ingest_status = "indexing"
        for ch in s.execute(select(DomainChunk).where(DomainChunk.document_id == uuid.UUID(doc))):
            ch[0].embedding = None

    monkeypatch.setattr(
        domain_read,
        "embed",
        lambda req: EmbeddingResult(
            vectors=[[0.01] * 1536 for _ in req.input],
            model=req.model,
            prompt_tokens=1,
            total_tokens=1,
            cost_usd=0.0,
            raw_provider="openai",
            latency_ms=1.0,
        ),
    )
    monkeypatch.setattr(domain_read, "resolve_owner_api_key", lambda oid, model: "sk-test")
    monkeypatch.setattr(domain_read, "record_embedding_cost", lambda **kwargs: None)
    paused, release = threading.Event(), threading.Event()
    real, calls = domain_read.reading_model_of, []

    def _slow(domain):
        calls.append(1)
        model = real(domain)
        if len(calls) == 2:  # the re-check just before the vectors are written
            paused.set()
            release.wait(10)
        return model

    monkeypatch.setattr(domain_read, "reading_model_of", _slow)
    batch, _, batch_out = _in_thread(domain_read.embed_batch_step, str(owner), did, doc, 0, 2)
    assert paused.wait(10)
    change, change_done, change_out = _in_thread(
        domains_cp.update_domain,
        owner,
        uuid.UUID(did),
        config=_model(cfg, "gemini/gemini-embedding-001"),
    )
    _until_a_lock_waiter_or(change_done)
    release.set()
    batch.join(10)
    change.join(10)
    assert batch_out.get("value") == {"error": None} and "error" not in change_out
    assert _embedded(doc) == 0
