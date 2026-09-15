"""PolyRAG Domains Phase 2 — filesystem storage + text extraction.

Files live under ``settings.domain_files_dir``:
``{dir}/{owner_id}/{domain_id}/{document_id}/{safe_filename}``.
No object storage in Phase 2. Fly prod may mount ``/data/domain-files`` via env.
"""

from __future__ import annotations

import re
import shutil
import uuid
from pathlib import Path

from tvashtr.config import get_settings

ALLOWED_EXTENSIONS: frozenset[str] = frozenset({"pdf", "md", "txt", "html"})
MAX_UPLOAD_BYTES: int = 10 * 1024 * 1024  # 10 MiB

_CONTENT_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "md": "text/markdown",
    "txt": "text/plain",
    "html": "text/html",
}

_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_filename(name: str) -> str:
    base = Path(name).name  # strip directories
    # Drop parentheses so "My Doc (1).TXT" -> "My_Doc_1.TXT"
    base = base.replace("(", "").replace(")", "")
    cleaned = _SAFE_RE.sub("_", base).strip("._") or "upload"
    return cleaned[:200]


def extension_of(filename: str) -> str:
    ext = Path(filename).suffix.lstrip(".").lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(
            f"unsupported file type: {ext or '(none)'} (allowed: pdf, md, txt, html)"
        )
    return ext


def content_type_for_ext(ext: str) -> str:
    return _CONTENT_TYPES[ext]


def relative_storage_path(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    document_id: uuid.UUID,
    filename: str,
) -> str:
    safe = safe_filename(filename)
    return f"{owner_id}/{domain_id}/{document_id}/{safe}"


def absolute_path(relative: str) -> Path:
    root = Path(get_settings().domain_files_dir).resolve()
    full = (root / relative).resolve()
    if not str(full).startswith(str(root)):
        raise ValueError("storage path escapes domain_files_dir")
    return full


def save_bytes(relative: str, data: bytes) -> None:
    path = absolute_path(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def delete_stored(relative: str) -> None:
    path = absolute_path(relative)
    if path.is_file():
        path.unlink()
    for parent in [path.parent, path.parent.parent]:
        try:
            parent.rmdir()
        except OSError:
            break


def delete_domain_tree(owner_id: uuid.UUID, domain_id: uuid.UUID) -> None:
    root = Path(get_settings().domain_files_dir).resolve()
    tree = (root / str(owner_id) / str(domain_id)).resolve()
    if not str(tree).startswith(str(root)):
        return
    if tree.is_dir():
        shutil.rmtree(tree, ignore_errors=True)


def extract_text(absolute: Path, ext: str) -> str:
    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(str(absolute))
        parts: list[str] = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        return "\n\n".join(parts)
    raw = absolute.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    if ext == "html":
        text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text)
        text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
    return text
