"""Versioned-document store: small, transaction-safe helpers.

A ``Document`` is an ordered chain of immutable ``DocumentVersion`` rows.
``add_version`` is idempotent on its ``idempotency_key`` so an at-least-once
DBOS step re-run does not append a duplicate version — the same convention that
governs metering. Each helper owns its own transaction via ``session_scope``.
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from tvashtr.db import session_scope
from tvashtr.models import Document, DocumentVersion


def create_document(title: str, doc_type: str) -> Document:
    """Create an (initially version-less) document and return it."""
    with session_scope() as session:
        document = Document(title=title, doc_type=doc_type)
        session.add(document)
        session.flush()  # assign the client-side uuid PK
        session.refresh(document)  # populate server defaults (created_at/updated_at)
        return document


def create_document_with_initial_version(
    title: str,
    doc_type: str,
    content: str,
    created_by: str,
    idempotency_key: str,
    run_id: uuid.UUID | None = None,
    name: str | None = None,
) -> Document:
    """Create a Document **and** its version-1 DocumentVersion in ONE transaction,
    idempotent on ``idempotency_key``.

    If a version already exists for the key, return its parent document (no new
    document) — this closes the orphan-``Document`` hazard of the two-transaction
    create->add sequence. The unique-violation race is handled by re-reading.

    M-docs (migration ``0028``): ``run_id`` + ``name`` are optional and stamp the new document as
    run-scoped + named. Both default ``None`` — the ``doc_writer`` proof workflow keeps calling this
    byte-identically (an un-scoped, un-named legacy doc); the entry/PM writer passes them so its
    "spec" document cascade-deletes with the run and is find-or-createable by name.
    """
    with session_scope() as session:
        existing = session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return session.execute(
                select(Document).where(Document.id == existing.document_id)
            ).scalar_one()

        document = Document(title=title, doc_type=doc_type, run_id=run_id, name=name)
        session.add(document)
        session.flush()  # assign the document uuid
        session.add(
            DocumentVersion(
                document_id=document.id,
                version_no=1,
                content=content,
                created_by=created_by,
                idempotency_key=idempotency_key,
            )
        )
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            won = session.execute(
                select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
            ).scalar_one_or_none()
            if won is not None:
                return session.execute(
                    select(Document).where(Document.id == won.document_id)
                ).scalar_one()
            raise
        session.refresh(document)
        return document


def find_or_create_run_document(
    *,
    run_id: uuid.UUID,
    name: str,
    title: str,
    doc_type: str,
    content: str,
    created_by: str,
    idempotency_key: str,
) -> Document:
    """M-docs: find or create the ``(run_id, name)`` document, then append ``content`` as its next
    version — idempotent on ``idempotency_key``. The find-or-create the executor uses to route a
    NON-entry node's ``config["writes_to"]`` output into its OWN run-scoped, named document (the
    entry/PM keeps :func:`create_document_with_initial_version`, which additionally sets
    ``Run.pm_document_id``). Doc lookup/create + version append happen in ONE transaction; the
    ``idempotency_key`` (run/workflow id + node + iteration) makes a DBOS step-replay
    insert-or-return, never duplicating a version or stranding a second document for the same name.
    Returns the document."""
    with session_scope() as session:
        # Idempotent replay: a version already written under this key ⇒ return its parent document
        # unchanged (no duplicate version, no second document for the same (run_id, name)).
        existing = session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return session.execute(
                select(Document).where(Document.id == existing.document_id)
            ).scalar_one()
        # find-or-create on (run_id, name). ``.first()`` (oldest) is defensive — even if a duplicate
        # ever slipped in, the find-or-create stays stable (always resolves to the same document).
        document = (
            session.execute(
                select(Document)
                .where(Document.run_id == run_id, Document.name == name)
                .order_by(Document.created_at)
            )
            .scalars()
            .first()
        )
        if document is None:
            document = Document(title=title, doc_type=doc_type, run_id=run_id, name=name)
            session.add(document)
            session.flush()  # assign the document uuid
        max_no = session.execute(
            select(func.max(DocumentVersion.version_no)).where(
                DocumentVersion.document_id == document.id
            )
        ).scalar()
        session.add(
            DocumentVersion(
                document_id=document.id,
                version_no=(max_no or 0) + 1,
                content=content,
                created_by=created_by,
                idempotency_key=idempotency_key,
            )
        )
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            won = session.execute(
                select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
            ).scalar_one_or_none()
            if won is not None:
                return session.execute(
                    select(Document).where(Document.id == won.document_id)
                ).scalar_one()
            raise  # genuine (document_id, version_no) contention, not an idempotent retry
        session.refresh(document)
        return document


def get_version_by_key(idempotency_key: str) -> DocumentVersion | None:
    """Return the version previously written under this key, if any."""
    with session_scope() as session:
        return session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one_or_none()


def add_version(
    document_id: uuid.UUID,
    content: str,
    created_by: str,
    idempotency_key: str,
) -> DocumentVersion:
    """Append the next version to a document — idempotent on ``idempotency_key``.

    If a version already exists for this key, return it unchanged (no duplicate).
    The ``version_no`` is the document's current max + 1. The unique-violation
    race (two writers, same key) is handled by catching ``IntegrityError`` and
    re-reading the winning row.
    """
    with session_scope() as session:
        existing = session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        max_no = session.execute(
            select(func.max(DocumentVersion.version_no)).where(
                DocumentVersion.document_id == document_id
            )
        ).scalar()
        version = DocumentVersion(
            document_id=document_id,
            version_no=(max_no or 0) + 1,
            content=content,
            created_by=created_by,
            idempotency_key=idempotency_key,
        )
        session.add(version)
        try:
            session.flush()
        except IntegrityError:
            session.rollback()
            won = session.execute(
                select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
            ).scalar_one_or_none()
            if won is not None:
                return won
            raise  # genuine version_no contention, not an idempotent retry
        session.refresh(version)
        return version


def get_latest_version(document_id: uuid.UUID) -> DocumentVersion | None:
    """Return the document's most recent version (the row with the max ``version_no``), or
    ``None`` if the document has no versions yet. Its own transaction, like the other helpers.

    The live-document re-source (P1.7a) reads through here: the latest version IS the current
    PRD, so a human edit (a freshly-appended version) is what the next agent read picks up."""
    with session_scope() as session:
        return session.execute(
            select(DocumentVersion)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        ).scalar_one_or_none()


def latest_content_by_name(run_id: uuid.UUID, name: str) -> str | None:
    """M-docs: the LATEST version content of the ``(run_id, name)`` document, or ``None`` if no such
    document exists (or it has no versions yet). The per-name read behind a node's
    ``config["reads_from"]`` (the executor's ``read_named_documents_step``). One joined query — no
    nested ``session_scope`` — so it composes inside a recorded step."""
    with session_scope() as session:
        return session.execute(
            select(DocumentVersion.content)
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(Document.run_id == run_id, Document.name == name)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        ).scalar_one_or_none()


def get_document_with_versions(document_id: uuid.UUID) -> Document | None:
    """Return a document with its versions eagerly loaded in version order."""
    with session_scope() as session:
        return session.execute(
            select(Document)
            .where(Document.id == document_id)
            .options(selectinload(Document.versions))
        ).scalar_one_or_none()


def list_documents() -> list[Document]:
    """Return all documents (metadata only), oldest first."""
    with session_scope() as session:
        return list(session.execute(select(Document).order_by(Document.created_at)).scalars().all())


def list_documents_for_run(run_id: uuid.UUID) -> list[Document]:
    """M-docs: every document THIS run produced (metadata only), oldest first — backs the endpoint
    ``GET /api/runs/{run_id}/documents`` (the run-view document picker). Scoped by the ``run_id`` FK
    added in migration ``0028``; a run with no run-scoped documents returns ``[]``."""
    with session_scope() as session:
        return list(
            session.execute(
                select(Document).where(Document.run_id == run_id).order_by(Document.created_at)
            )
            .scalars()
            .all()
        )
