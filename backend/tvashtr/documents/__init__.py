"""The versioned-document layer: a ``Document`` is an ordered chain of immutable
``DocumentVersion`` rows, editable later by both humans and agents."""

from tvashtr.documents.service import (
    add_version,
    create_document,
    get_document_with_versions,
    get_version_by_key,
    list_documents,
)

__all__ = [
    "add_version",
    "create_document",
    "get_document_with_versions",
    "get_version_by_key",
    "list_documents",
]
