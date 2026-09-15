"""Phase 2 — domain file storage layout + text extract."""

import uuid

import pytest

from tvashtr.config import get_settings
from tvashtr.control_plane import domain_files as df


def test_safe_filename_strips_paths_and_keeps_ext():
    assert df.safe_filename("../../evil.pdf") == "evil.pdf"
    assert df.safe_filename("My Doc (1).TXT") == "My_Doc_1.TXT"


def test_rejects_disallowed_extension():
    with pytest.raises(ValueError, match="unsupported"):
        df.extension_of("photo.png")


def test_save_and_extract_txt(tmp_path, monkeypatch):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()
    owner = uuid.uuid4()
    domain = uuid.uuid4()
    doc = uuid.uuid4()
    rel = df.relative_storage_path(owner, domain, doc, "hello.txt")
    df.save_bytes(rel, b"Hello domain\n")
    abs_path = df.absolute_path(rel)
    assert abs_path.is_file()
    assert df.extract_text(abs_path, "txt") == "Hello domain\n"
    get_settings.cache_clear()


def test_extract_pdf_blank_page_ok(tmp_path):
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    path = tmp_path / "blank.pdf"
    with path.open("wb") as f:
        writer.write(f)
    text = df.extract_text(path, "pdf")
    assert isinstance(text, str)
