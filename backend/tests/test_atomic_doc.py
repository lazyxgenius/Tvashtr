"""Atomic document+version helper — no network.

`create_document_with_initial_version` creates a Document and its version-1
DocumentVersion in ONE transaction, idempotent on the version key — so a
crash-retry never strands an empty orphan Document (the P0.2 two-transaction
hazard, fixed here).
"""

from uuid import uuid4

from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.documents.service import create_document_with_initial_version
from tvashtr.models import Document, DocumentVersion


def test_atomic_doc_creates_doc_and_v1_idempotently_no_orphan():
    key = f"test:{uuid4().hex}:v1"
    title = f"AtomicDoc-{uuid4().hex}"

    first = create_document_with_initial_version(title, "prd", "the content", "agent:pm", key)
    second = create_document_with_initial_version(title, "prd", "the content", "agent:pm", key)

    # Same document returned — no second/orphan document.
    assert second.id == first.id

    with session_scope() as session:
        n_docs = session.execute(
            select(func.count()).select_from(Document).where(Document.title == title)
        ).scalar_one()
        version = session.execute(
            select(DocumentVersion).where(DocumentVersion.idempotency_key == key)
        ).scalar_one()  # exactly one (raises if 0 or >1)

    assert n_docs == 1  # no orphan/duplicate Document
    assert version.version_no == 1
    assert version.content == "the content"
    assert version.document_id == first.id
