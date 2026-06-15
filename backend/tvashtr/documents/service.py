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
