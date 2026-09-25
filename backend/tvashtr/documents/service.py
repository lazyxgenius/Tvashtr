"""Versioned-document store: small, transaction-safe helpers.

A ``Document`` is an ordered chain of immutable ``DocumentVersion`` rows.
``add_version`` is idempotent on its ``idempotency_key`` so an at-least-once
DBOS step re-run does not append a duplicate version — the same convention that
governs metering. Each helper owns its own transaction via ``session_scope``.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from tvashtr.db import session_scope
from tvashtr.models import Document, DocumentVersion, Run


@dataclass(frozen=True)
class LatestVersionInfo:
    """A detached snapshot of a document's newest version (safe to use after the session closes)."""

    version_no: int
    created_by: str
    author_node_id: uuid.UUID | None


class StaleVersionError(Exception):
    """:func:`add_version` was told which version the writer started from (``expected_base``) and
    the document has moved on since — someone else saved a newer version in between. Carries the
    newest version so the caller can say who saved it."""

    def __init__(self, latest: LatestVersionInfo | None) -> None:
        super().__init__("document has a newer version than the edit's base")
        self.latest = latest


def _touch(session, document_id: uuid.UUID) -> None:
    """Bump ``documents.updated_at`` in the writer's transaction. The column's ORM ``onupdate``
    never fires, because appending a version inserts a ``DocumentVersion`` only — so every version
    writer calls this explicitly. ``now()`` is the transaction start, the same instant the new
    version's ``created_at`` gets."""
    session.execute(
        update(Document).where(Document.id == document_id).values(updated_at=func.now())
    )


def _latest_info(session, document_id: uuid.UUID) -> LatestVersionInfo | None:
    row = session.execute(
        select(
            DocumentVersion.version_no, DocumentVersion.created_by, DocumentVersion.author_node_id
        )
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_no.desc())
        .limit(1)
    ).first()
    return None if row is None else LatestVersionInfo(row[0], row[1], row[2])


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
    note: str | None = None,
    author_node_id: uuid.UUID | None = None,
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

    Revamp (``0041``): ``note`` (the version's change note) and ``author_node_id`` (the AUTHORED
    node that wrote it) are optional; both default ``None`` (derived at read time).
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
                note=note,
                author_node_id=author_node_id,
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
    note: str | None = None,
    author_node_id: uuid.UUID | None = None,
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
                note=note,
                author_node_id=author_node_id,
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
        _touch(session, document.id)
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
    *,
    note: str | None = None,
    author_node_id: uuid.UUID | None = None,
    expected_base: int | None = None,
) -> DocumentVersion:
    """Append the next version to a document — idempotent on ``idempotency_key``.

    If a version already exists for this key, return it unchanged (no duplicate).
    The ``version_no`` is the document's current max + 1. The unique-violation
    race (two writers, same key) is handled by catching ``IntegrityError`` and
    re-reading the winning row.

    Revamp: ``note`` / ``author_node_id`` are stored on the new row; ``documents.updated_at`` is
    bumped in the same transaction. ``expected_base`` (a human live edit) is the version number
    the writer started from: when the document's newest version is not that one — checked in the
    SAME transaction as the insert, with the document row locked — nothing is written and
    :class:`StaleVersionError` is raised. A concurrent agent insert that wins the
    ``(document_id, version_no)`` race is reported the same way.
    """
    with session_scope() as session:
        existing = session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == idempotency_key)
        ).scalar_one_or_none()
        if existing is not None:
            return existing

        if expected_base is not None:
            # Serialize human saves on this document (agents rely on the unique constraint).
            session.execute(select(Document.id).where(Document.id == document_id).with_for_update())
        max_no = session.execute(
            select(func.max(DocumentVersion.version_no)).where(
                DocumentVersion.document_id == document_id
            )
        ).scalar()
        if expected_base is not None and (max_no or 0) != expected_base:
            raise StaleVersionError(_latest_info(session, document_id))
        version = DocumentVersion(
            document_id=document_id,
            version_no=(max_no or 0) + 1,
            content=content,
            created_by=created_by,
            idempotency_key=idempotency_key,
            note=note,
            author_node_id=author_node_id,
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
            if expected_base is not None:
                raise StaleVersionError(_latest_info(session, document_id)) from None
            raise  # genuine version_no contention, not an idempotent retry
        _touch(session, document_id)
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


def latest_version_by_name(run_id: uuid.UUID, name: str) -> dict | None:
    """Revamp: like :func:`latest_content_by_name` but also says WHICH version it is —
    ``{"document_id", "version_no", "content"}`` of the ``(run_id, name)`` document's newest
    version, or ``None`` when there is no such document (or it has no versions yet)."""
    with session_scope() as session:
        row = session.execute(
            select(DocumentVersion.document_id, DocumentVersion.version_no, DocumentVersion.content)
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(Document.run_id == run_id, Document.name == name)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        ).first()
    if row is None:
        return None
    return {"document_id": str(row[0]), "version_no": row[1], "content": row[2]}


def latest_version_of(document_id: uuid.UUID) -> dict | None:
    """Revamp: the document's newest version as ``{"document_id", "version_no", "content",
    "name"}`` (``name`` is the document's run-scoped name), or ``None`` when it has no versions."""
    with session_scope() as session:
        row = session.execute(
            select(DocumentVersion.version_no, DocumentVersion.content, Document.name)
            .join(Document, Document.id == DocumentVersion.document_id)
            .where(DocumentVersion.document_id == document_id)
            .order_by(DocumentVersion.version_no.desc())
            .limit(1)
        ).first()
    if row is None:
        return None
    return {
        "document_id": str(document_id),
        "version_no": row[0],
        "content": row[1],
        "name": row[2],
    }


def get_document_with_versions(document_id: uuid.UUID) -> Document | None:
    """Return a document with its versions eagerly loaded in version order."""
    with session_scope() as session:
        return session.execute(
            select(Document)
            .where(Document.id == document_id)
            .options(selectinload(Document.versions))
        ).scalar_one_or_none()


def list_documents() -> list[Document]:
    """Return all documents (metadata only), oldest first. NOT owner-scoped — internal use only;
    the HTTP list goes through :func:`list_documents_for_owner`."""
    with session_scope() as session:
        return list(session.execute(select(Document).order_by(Document.created_at)).scalars().all())


def owned_by(owner_id: uuid.UUID):
    """The SQL predicate "this document belongs to ``owner_id``". A document is owned through its
    run: ``documents.run_id → runs.owner_id``, or — for a legacy pre-0028 document with no
    ``run_id`` — the run whose ``pm_document_id`` points at it. A document with neither (the
    ``doc_writer`` proof workflow) belongs to nobody, so no account can reach it over HTTP."""
    owned_runs = select(Run.id).where(Run.owner_id == owner_id)
    legacy_specs = select(Run.pm_document_id).where(
        Run.owner_id == owner_id, Run.pm_document_id.is_not(None)
    )
    return or_(
        Document.run_id.in_(owned_runs),
        and_(Document.run_id.is_(None), Document.id.in_(legacy_specs)),
    )


def list_documents_for_owner(owner_id: uuid.UUID) -> list[Document]:
    """Every document ``owner_id`` owns (metadata only), oldest first — ``GET /api/documents``."""
    with session_scope() as session:
        return list(
            session.execute(
                select(Document).where(owned_by(owner_id)).order_by(Document.created_at)
            )
            .scalars()
            .all()
        )


def get_owned_document_with_versions(
    document_id: uuid.UUID, owner_id: uuid.UUID
) -> Document | None:
    """The document with its versions (in version order) iff ``owner_id`` owns it, else ``None`` —
    the callers turn ``None`` into a 404 so another account's document is not even probeable."""
    with session_scope() as session:
        return session.execute(
            select(Document)
            .where(Document.id == document_id, owned_by(owner_id))
            .options(selectinload(Document.versions))
        ).scalar_one_or_none()


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
