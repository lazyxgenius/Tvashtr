"""Automatic reading for Domains (revamp round 2, DM-29/DM-42/DM-48/DM-50; analysis finding 3).

Uploading a file now starts reading it — no Ingest button. ``ensure_reading`` is called after an
upload, a re-read request and a key save. Under a per-domain advisory lock it claims the oldest
waiting file (``pending`` → ``indexing``) and starts the durable workflow ``read_domain_files``,
unless a read is already running for the domain (a file is ``indexing``) — then the running
workflow picks the new file up, because each file's last step claims the next one under the same
lock. So a domain reads ONE file at a time (OQ-24), and uploads made during a read are never lost.

Per-file progress needs no schema: ``prepare_document_step`` inserts every piece with a NULL
embedding (plus ``meta.page`` for PDFs, DM-60), ``embed_batch_step`` fills 16 at a time, and the
file's progress is embedded ÷ total. A file whose reading key is missing stays ``pending`` —
"Waiting for a <provider> key" — and ``resume_waiting`` starts it when that key is saved.

The old ``ingest_domain`` workflow stays defined (in-flight workflows replay); ``POST /ingest`` (the
old Ingest button) now reads through ``read_for_ingest``.
"""

from __future__ import annotations

import uuid
import zlib
from datetime import UTC, datetime

from dbos import DBOS
from sqlalchemy import and_, delete, func, or_, select, text, update

from tvashtr.control_plane.credentials import resolve_owner_api_key
from tvashtr.control_plane.domain_chunking import chunk_spans
from tvashtr.control_plane.domain_embedding import expected_dim, normalize_embedding_model
from tvashtr.control_plane.domain_files import (
    absolute_path,
    extension_of,
    extract_pages,
    page_at,
)
from tvashtr.control_plane.domain_views import held_providers, reading_model_summary
from tvashtr.control_plane.domains import (
    INGEST_ERROR,
    INGEST_INDEXING,
    INGEST_PENDING,
    INGEST_READY,
    READ_STALE_AFTER,
    READ_TESTS_AFTER,
    _apply_domain_aggregates,
    _owned_domain,
    keeps_mark,
    reread_version,
)
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import Domain, DomainChunk, DomainDocument

# Advisory-lock namespace ("DM"); the second key is a 32-bit hash of the domain id.
LOCK_NAMESPACE = 0x444D
EMBED_BATCH = 16
STALE_AFTER = READ_STALE_AFTER


class RereadConflict(Exception):
    """A full re-read was asked for while one is already running."""


def _lock(session, domain_id: uuid.UUID) -> None:
    key = zlib.crc32(domain_id.bytes) - 2**31  # a signed int4
    session.execute(text("SELECT pg_advisory_xact_lock(:ns, :k)"), {"ns": LOCK_NAMESPACE, "k": key})


def _now() -> datetime:
    return datetime.now(UTC)


def reading_model_of(domain: Domain) -> str:
    return normalize_embedding_model(
        str(((domain.config or {}).get("embedding") or {}).get("model") or "text-embedding-3-small")
    )


def _key_saved(session, owner_id: uuid.UUID, domain: Domain) -> bool:
    return bool(
        reading_model_summary(domain.config, held_providers(session, owner_id))["key_saved"]
    )


def _is_reading(session, domain_id: uuid.UUID) -> bool:
    """A live read: some file is ``indexing`` and made progress recently."""
    return (
        session.execute(
            select(DomainDocument.id)
            .where(
                DomainDocument.domain_id == domain_id,
                DomainDocument.ingest_status == INGEST_INDEXING,
                DomainDocument.updated_at >= _now() - STALE_AFTER,
            )
            .limit(1)
        ).first()
        is not None
    )


def _claimable():
    return or_(
        DomainDocument.ingest_status == INGEST_PENDING,
        and_(
            DomainDocument.ingest_status == INGEST_INDEXING,
            DomainDocument.updated_at < _now() - STALE_AFTER,
        ),
    )


def _claim_next(session, domain: Domain) -> uuid.UUID | None:
    """Mark the oldest waiting file ``indexing`` and return its id (caller holds the lock)."""
    doc = (
        session.execute(
            select(DomainDocument)
            .where(DomainDocument.domain_id == domain.id, _claimable())
            .order_by(DomainDocument.created_at, DomainDocument.id)
            .limit(1)
        )
        .scalars()
        .first()
    )
    if doc is None:
        return None
    doc.ingest_status = INGEST_INDEXING
    if not keeps_mark(doc.error_message):
        doc.error_message = None
    doc.updated_at = _now()
    return doc.id


def ensure_reading(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    run_tests_after: bool = False,
    handles: list | None = None,
) -> str:
    """Start reading the domain's waiting files if nothing is reading them yet.

    Returns ``"started"`` (a workflow was started), ``"queued"`` (a read is running and will take
    the files), ``"waiting_for_key"`` (files wait for the reading model's key) or ``"idle"``
    (nothing to read, or no such domain). ``handles`` gets the started workflow's handle.
    """
    with session_scope() as session:
        _lock(session, domain_id)
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return "idle"
        waiting = session.execute(
            select(func.count())
            .select_from(DomainDocument)
            .where(DomainDocument.domain_id == domain_id, _claimable())
        ).scalar_one()
        if not _key_saved(session, owner_id, domain):
            return "waiting_for_key" if waiting else "idle"
        if _is_reading(session, domain_id):
            return "queued"
        first = _claim_next(session, domain)
        if first is None:
            return "idle"
        _apply_domain_aggregates(session, domain)
    try:
        handle = DBOS.start_workflow(
            read_domain_files, str(owner_id), str(domain_id), str(first), run_tests_after
        )
    except Exception:
        # Give the file back so the next upload, re-read or key save starts it.
        with session_scope() as session:
            session.execute(
                update(DomainDocument)
                .where(DomainDocument.id == first, DomainDocument.ingest_status == INGEST_INDEXING)
                .values(ingest_status=INGEST_PENDING)
            )
        raise
    if handles is not None:
        handles.append(handle)
    return "started"


def read_for_ingest(owner_id: uuid.UUID, domain_id: uuid.UUID) -> str:
    """``POST /ingest`` (Desktop 0.10.0's Ingest button): files that failed go back to waiting, as
    the old ingest retried them, then reading starts — or the read already running takes them, so a
    file is never read by two readers. Returns the started workflow's id, else ``""``."""
    with session_scope() as session:
        _lock(session, domain_id)
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return ""
        session.execute(
            update(DomainDocument)
            .where(
                DomainDocument.domain_id == domain_id, DomainDocument.ingest_status == INGEST_ERROR
            )
            .values(ingest_status=INGEST_PENDING, error_message=None)
        )
        _apply_domain_aggregates(session, domain)
    handles: list = []
    ensure_reading(owner_id, domain_id, handles=handles)
    return str(handles[0].workflow_id) if handles else ""


def resume_stalled(owner_id: uuid.UUID, domain_ids: list[uuid.UUID]) -> None:
    """Start reading the domains whose files wait while nothing reads them — files uploaded before
    reading was automatic, or left by a read that died. The list and the detail call it for the
    domains they show as reading, so a "Reading" state always has a reader behind it.
    Best-effort: a failure is logged, never raised to the page."""
    if not domain_ids:
        return
    with session_scope() as session:
        live = select(DomainDocument.domain_id).where(
            DomainDocument.ingest_status == INGEST_INDEXING,
            DomainDocument.updated_at >= _now() - STALE_AFTER,
        )
        stalled = list(
            session.execute(
                select(DomainDocument.domain_id)
                .where(
                    DomainDocument.domain_id.in_(domain_ids),
                    _claimable(),
                    DomainDocument.domain_id.not_in(live),
                )
                .distinct()
            ).scalars()
        )
    for did in stalled:
        try:
            ensure_reading(owner_id, did)
        except Exception as exc:  # pragma: no cover - logged, never raised to a page load
            DBOS.logger.warning(f"resume_stalled: domain {did} did not start: {exc}")


def resume_waiting(owner_id: uuid.UUID, provider: str) -> int:
    """After a key save: start reading every domain whose files wait for ``provider``'s key.

    Returns how many domains started reading. Best-effort per domain — one failure never stops the
    others (the caller never fails a key save over it).
    """
    with session_scope() as session:
        rows = list(
            session.execute(
                select(Domain)
                .where(
                    Domain.owner_id == owner_id,
                    Domain.id.in_(
                        select(DomainDocument.domain_id).where(
                            DomainDocument.ingest_status == INGEST_PENDING
                        )
                    ),
                )
                .order_by(Domain.created_at, Domain.id)
            ).scalars()
        )
        wanted = [
            d.id for d in rows if reading_model_summary(d.config, set())["provider"] == provider
        ]
    started = 0
    for did in wanted:
        try:
            if ensure_reading(owner_id, did) == "started":
                started += 1
        except Exception as exc:  # pragma: no cover - logged, never raised to the key save
            DBOS.logger.warning(f"resume_waiting: domain {did} did not start: {exc}")
    return started


def start_reread(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    document_ids: list[uuid.UUID] | None,
    *,
    run_tests_after: bool = False,
) -> dict | None:
    """Read files again (DM-50, DM-89): each named file — or every file — goes back to waiting
    with its ``version`` bumped (``version > 1`` is what "Re-reading" means), then reading starts.
    The files share one version (``reread_version``: a re-read asked for during another joins it),
    and ``run_tests_after`` is kept on them, so a read that is already running runs the tests too.

    ``None`` when the domain isn't the owner's. ``LookupError`` when a named file isn't in the
    domain. ``RereadConflict`` when every file was asked for while a full re-read is running.
    """
    with session_scope() as session:
        _lock(session, domain_id)
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        docs = list(
            session.execute(
                select(DomainDocument).where(DomainDocument.domain_id == domain_id)
            ).scalars()
        )
        if document_ids is None:
            active = [d for d in docs if d.ingest_status in (INGEST_PENDING, INGEST_INDEXING)]
            if docs and len(active) == len(docs) and any(d.version > 1 for d in active):
                raise RereadConflict
            targets = docs
        else:
            by_id = {d.id: d for d in docs}
            missing = [i for i in document_ids if i not in by_id]
            if missing:
                raise LookupError("document not found")
            targets = [by_id[i] for i in dict.fromkeys(document_ids)]
        live = _now() - STALE_AFTER
        version = reread_version(session, domain_id)
        for doc in targets:
            # A file being read right now is left to that read: re-queueing it would start a
            # second reader beside the running one (a domain reads one file at a time).
            if doc.ingest_status == INGEST_INDEXING and doc.updated_at >= live:
                continue
            doc.version = version
            doc.ingest_status = INGEST_PENDING
            doc.error_message = READ_TESTS_AFTER if run_tests_after else None
        _apply_domain_aggregates(session, domain)
        count = len(targets)
    state = "idle"
    if count:
        state = ensure_reading(owner_id, domain_id, run_tests_after=run_tests_after)
    return {"reading": count, "run_tests_after": run_tests_after, "state": state}


# ---- the workflow ----


def _doc(session, domain_id: uuid.UUID, document_id: uuid.UUID) -> DomainDocument | None:
    return session.execute(
        select(DomainDocument).where(
            DomainDocument.id == document_id, DomainDocument.domain_id == domain_id
        )
    ).scalar_one_or_none()


@DBOS.step()
def prepare_document_step(owner_id: str, domain_id: str, document_id: str) -> dict:
    """Extract and cut one file into pieces, stored with no embedding yet (the progress base).

    Returns ``{"pieces": n, "error": None}`` or ``{"pieces": 0, "error": "<raw reason>"}``, plus
    ``tests_after`` when a re-read asked to run the tests once reading is done.
    """
    oid, did, doc_id = uuid.UUID(owner_id), uuid.UUID(domain_id), uuid.UUID(document_id)
    try:
        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            doc = _doc(session, did, doc_id) if domain is not None else None
            if domain is None or doc is None:
                return {"pieces": 0, "error": "document not found"}
            chunking = (domain.config or {}).get("chunking") or {}
            size = int(chunking.get("size") or 800)
            overlap = int(chunking.get("overlap") or 100)
            filename, rel = doc.filename, doc.storage_path
            tests_after = doc.error_message == READ_TESTS_AFTER
        body, starts = extract_pages(absolute_path(rel), extension_of(filename))
        spans = chunk_spans(body, size=size, overlap=overlap)
        if not spans:
            return {"pieces": 0, "error": "no extractable text", "tests_after": tests_after}
        with session_scope() as session:
            doc = _doc(session, did, doc_id)
            if doc is None:
                return {"pieces": 0, "error": "document not found"}
            session.execute(delete(DomainChunk).where(DomainChunk.document_id == doc_id))
            for ordinal, (offset, piece) in enumerate(spans):
                meta: dict = {"filename": filename, "chunk_size": size}
                page = page_at(starts, offset)
                if page is not None:
                    meta["page"] = page
                session.add(
                    DomainChunk(
                        domain_id=did,
                        document_id=doc_id,
                        ordinal=ordinal,
                        text=piece,
                        embedding=None,
                        meta=meta,
                    )
                )
            doc.updated_at = _now()
        return {"pieces": len(spans), "error": None, "tests_after": tests_after}
    except Exception as exc:
        return {"pieces": 0, "error": str(exc)[:2000] or exc.__class__.__name__}


@DBOS.step()
def embed_batch_step(owner_id: str, domain_id: str, document_id: str, start: int, end: int) -> dict:
    """Embed pieces ``[start, end)`` of one file, record the cost, check the dimension."""
    oid, did, doc_id = uuid.UUID(owner_id), uuid.UUID(domain_id), uuid.UUID(document_id)
    try:
        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            if domain is None:
                return {"error": "document not found"}
            model = reading_model_of(domain)
            rows = session.execute(
                select(DomainChunk.id, DomainChunk.text)
                .where(
                    DomainChunk.document_id == doc_id,
                    DomainChunk.ordinal >= start,
                    DomainChunk.ordinal < end,
                )
                .order_by(DomainChunk.ordinal)
            ).all()
        if not rows:
            return {"error": "document not found"}
        result = embed(
            EmbeddingRequest(
                model=model,
                input=[t for _, t in rows],
                api_key=resolve_owner_api_key(oid, model),
            )
        )
        wf = getattr(DBOS, "workflow_id", None) or "no-wf"
        record_embedding_cost(
            workflow_id=None,
            idempotency_key=f"domain-read:{document_id}:{start}:{wf}",
            model=result.model,
            prompt_tokens=result.prompt_tokens,
            total_tokens=result.total_tokens,
            cost_usd=result.cost_usd,
        )
        if len(result.vectors) != len(rows):
            return {"error": "embedding provider returned unexpected vector count"}
        want = expected_dim(model)
        for vec in result.vectors:
            if len(vec) != want:
                return {"error": f"embedding dim {len(vec)} != {want}"}
        with session_scope() as session:
            _lock(session, did)  # a model change waits until this batch is stored, then clears it
            current = _owned_domain(session, oid, did)
            if current is None or reading_model_of(current) != model:
                # The model changed while this batch was out: these vectors can't be compared
                # with the new model's. Leave the pieces unembedded; the file is read again.
                return {"error": None}
            for (chunk_id, _), vec in zip(rows, result.vectors, strict=True):
                session.execute(
                    update(DomainChunk).where(DomainChunk.id == chunk_id).values(embedding=vec)
                )
            session.execute(
                update(DomainDocument).where(DomainDocument.id == doc_id).values(updated_at=_now())
            )
        return {"error": None}
    except Exception as exc:
        return {"error": str(exc)[:2000] or exc.__class__.__name__}


def _unembedded(session, document_id: uuid.UUID) -> bool:
    return (
        session.execute(
            select(DomainChunk.id)
            .where(DomainChunk.document_id == document_id, DomainChunk.embedding.is_(None))
            .limit(1)
        ).first()
        is not None
    )


@DBOS.step()
def finish_document_step(
    owner_id: str, domain_id: str, document_id: str, error: str | None
) -> str | None:
    """Mark the file ready (or needing attention) and claim the next waiting file, atomically."""
    oid, did, doc_id = uuid.UUID(owner_id), uuid.UUID(domain_id), uuid.UUID(document_id)
    with session_scope() as session:
        _lock(session, did)
        domain = _owned_domain(session, oid, did)
        if domain is None:
            return None
        doc = _doc(session, did, doc_id)
        # A file re-queued while it was being read (a second re-read) stays queued.
        if doc is not None and doc.ingest_status == INGEST_INDEXING:
            if error is None and _unembedded(session, doc_id):
                # The reading model changed while this file was read: its vectors were cleared,
                # so it waits (keeping the model mark) and is read again with the new model.
                doc.ingest_status = INGEST_PENDING
            elif error is None:
                doc.ingest_status = INGEST_READY
                doc.error_message = None
            else:
                session.execute(delete(DomainChunk).where(DomainChunk.document_id == doc_id))
                doc.ingest_status = INGEST_ERROR
                doc.error_message = error[:2000]
        nxt = _claim_next(session, domain) if _key_saved(session, oid, domain) else None
        _apply_domain_aggregates(session, domain)
        return str(nxt) if nxt is not None else None


@DBOS.step()
def run_tests_after_read_step(owner_id: str, domain_id: str) -> dict | None:
    """Run the domain's test questions once reading is done (a re-read asked for it)."""
    from tvashtr.control_plane.domain_eval import run_domain_eval

    try:
        return run_domain_eval(uuid.UUID(owner_id), uuid.UUID(domain_id))
    except Exception as exc:
        return {"error": str(exc)[:2000]}


@DBOS.workflow()
def read_domain_files(
    owner_id: str, domain_id: str, document_id: str, run_tests_after: bool = False
) -> dict:
    """Read ``document_id``, then every file waiting after it, one at a time."""
    read: list[dict] = []
    current: str | None = document_id
    while current is not None:
        prepared = prepare_document_step(owner_id, domain_id, current)
        run_tests_after = run_tests_after or bool(prepared.get("tests_after"))
        error = prepared.get("error")
        total = int(prepared.get("pieces") or 0)
        start = 0
        while error is None and start < total:
            end = min(start + EMBED_BATCH, total)
            error = embed_batch_step(owner_id, domain_id, current, start, end).get("error")
            start = end
        read.append({"document_id": current, "ok": error is None})
        current = finish_document_step(owner_id, domain_id, current, error)
    tests = run_tests_after_read_step(owner_id, domain_id) if run_tests_after else None
    return {"domain_id": domain_id, "documents": read, "tests": tests}
