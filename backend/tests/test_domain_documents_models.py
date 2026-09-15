"""Phase 2 — DomainDocument / DomainChunk ORM smoke."""

from tvashtr.config import get_settings
from tvashtr.models import DomainChunk, DomainDocument


def test_domain_document_tablename():
    assert DomainDocument.__tablename__ == "domain_documents"
    assert DomainChunk.__tablename__ == "domain_chunks"


def test_domain_files_dir_default(monkeypatch):
    monkeypatch.delenv("TVASHTR_DOMAIN_FILES_DIR", raising=False)
    get_settings.cache_clear()
    assert get_settings().domain_files_dir == "/tmp/tvashtr-domain-files"
    get_settings.cache_clear()
