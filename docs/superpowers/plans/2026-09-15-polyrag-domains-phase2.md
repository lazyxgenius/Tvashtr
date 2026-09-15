# PolyRAG Domains Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 2 only — upload documents to a Domain, DBOS ingest (extract → chunk → embed → pgvector), document ingest status, and a Documents tab on domain detail (shared React web+Desktop) — with no ask, messages, or Chat tab.

**Architecture:** Extend Phase 1 Domains with owner-scoped `domain_documents` + `domain_chunks` (pgvector `Vector(1536)` like `NodeMemory`). Raw files live on the local filesystem under `settings.domain_files_dir` (env `TVASHTR_DOMAIN_FILES_DIR`). Upload APIs write bytes + `pending` rows; `POST /ingest` preflights BYOK then starts a DBOS workflow that extracts text, chunks per domain config, embeds via LiteLLM gateway with owner BYOK, and stores vectors. Domain `status` / `doc_count` are derived from real document rows. Shared React Documents tab calls the same `/api` as Desktop.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pgvector + DBOS + pypdf + pytest (backend); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop).

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 2 only**.
- **Branch base:** Implement on new branch `feat/polyrag-domains-phase2` created from current `feat/polyrag-domains-phase1` HEAD. Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — no Desktop-only Domain backend; Desktop continues same-origin `/api` proxy to Fly.
- Auth / ownership: same pattern as domains/teams — `get_current_user` + owner scope; foreign ids → **404** (not probeable).
- **File storage (locked):** filesystem under `settings.domain_files_dir` (env `TVASHTR_DOMAIN_FILES_DIR`, default `/tmp/tvashtr-domain-files` in tests/dev). Path layout `{dir}/{owner_id}/{domain_id}/{document_id}/{safe_filename}`. **No Tigris/S3 in Phase 2.** Document that Fly may later mount a volume at `/data/domain-files` and set the env in prod.
- **File types (locked):** `pdf`, `md`, `txt`, `html` only; max **10 MiB**.
- **Embeddings (locked):** reuse `tvashtr.gateway` `EmbeddingRequest` / `embed` + owner BYOK via `resolve_owner_api_key`; model from domain config `embedding.model` (default `text-embedding-3-small`); normalize bare model ids to `openai/<id>` for gateway/provider resolution; **Vector(1536)** on chunks like `NodeMemory`.
- **Document.ingest_status (locked):** `pending` | `indexing` | `ready` | `error` (+ optional `error_message` text).
- **Domain.status helpers (locked):** keep Phase 1 string values; recompute: `empty` if 0 docs; `indexing` if any `indexing`/`pending`; `error` if any `error` and none indexing/pending; `ready` if ≥1 `ready` and none indexing/pending (error checked before ready). Document these rules in helpers.
- **doc_count:** real count of documents for the domain (replace hard-coded `0` in `domain_to_dict`).
- **BYOK preflight:** ingest returns **422** with clear detail if embedding provider key missing (mirror team-run / Engines spirit).
- **PDF text:** use `pypdf` (add dependency if missing) — extract text only; skip empty pages.
- **ORM naming:** existing `Document` / `documents` is the PRD work-product table. Phase 2 MUST use **`DomainDocument`** / **`DomainChunk`** (`domain_documents` / `domain_chunks`) — never collide with `tvashtr.models.Document`.
- YAGNI: **no** `/ask`, `/messages`, Chat tab, hybrid/rerank, GraphRAG, MCP/canvas node.
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` from `git log -1`); **never** `git config`.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Modify** `backend/tvashtr/config.py` | Add `domain_files_dir` setting (`TVASHTR_DOMAIN_FILES_DIR`, default `/tmp/tvashtr-domain-files`). |
| **Modify** `backend/tvashtr/models.py` | Add `DomainDocument` + `DomainChunk` (Vector 1536). |
| **Create** `backend/alembic/versions/0034_domain_documents_chunks.py` | Additive tables + indexes; `down_revision = 0033_domains`. |
| **Modify** `backend/pyproject.toml` | Add `pypdf` dependency. |
| **Create** `backend/tvashtr/control_plane/domain_files.py` | Safe filename, path layout, save/delete bytes, text extract (pdf/md/txt/html). |
| **Create** `backend/tvashtr/control_plane/domain_chunking.py` | Fixed-size chunking with overlap from domain config. |
| **Create** `backend/tvashtr/control_plane/domain_ingest.py` | DBOS workflow + steps: mark indexing → extract → chunk → embed → persist → status. |
| **Modify** `backend/tvashtr/control_plane/domains.py` | `compute_domain_status`, real `doc_count`, document CRUD helpers, status refresh, cascade file cleanup on domain delete. |
| **Modify** `backend/tvashtr/routers.py` | `POST/GET/DELETE .../documents`, `POST .../ingest`. |
| **Modify** `backend/tvashtr/main.py` | Import `domain_ingest` so DBOS registers the workflow. |
| **Create** `backend/tests/test_domain_documents_models.py` | ORM + settings smoke. |
| **Create** `backend/tests/test_domain_files.py` | Storage path + extract unit tests. |
| **Create** `backend/tests/test_domain_chunking.py` | Chunking unit tests. |
| **Create** `backend/tests/test_domain_documents_api.py` | Upload/list/delete + auth + type/size limits. |
| **Create** `backend/tests/test_domain_ingest_workflow.py` | Ingest workflow (mocked embed) + normalize model. |
| **Create** `backend/tests/test_domain_ingest_api.py` | Ingest enqueue + BYOK 422. |
| **Modify** `backend/tests/test_domains_helpers.py` | `compute_domain_status` rules. |
| **Modify** `frontend/src/lib/api.ts` | Document types + list/upload/delete/ingest clients. |
| **Create** `frontend/src/lib/domainDocuments.test.ts` | Client GET smoke. |
| **Modify** `frontend/src/components/DomainsPage.tsx` | Documents tab + upload/list/ingest/delete UI. |
| **Modify** `frontend/src/components/DomainsPage.test.tsx` | Documents tab tests. |
| **Modify** `frontend/src/index.css` | Documents tab styles under `.tv-domains*`. |

**Out of scope (do not create for Phase 2):** DomainMessage model, `/ask`, `/messages`, Chat tab, hybrid retrieval, canvas Query-domain node, MCP tools, Tigris/S3.

---


### Task 1: DomainDocument + DomainChunk models, migration, settings, pypdf

**Files:**
- Modify: `backend/tvashtr/config.py`
- Modify: `backend/tvashtr/models.py` (after `Domain`)
- Create: `backend/alembic/versions/0034_domain_documents_chunks.py`
- Modify: `backend/pyproject.toml`
- Test: `backend/tests/test_domain_documents_models.py`

**Interfaces:**
- Consumes: `Base`, `Uuid`, `JSONB`, `Vector`, `ForeignKey("domains.id")`, Alembic head `0033_domains`
- Produces: `DomainDocument`, `DomainChunk`; `settings.domain_files_dir: str`

- [ ] **Step 1: Write the failing model import smoke**

Create `backend/tests/test_domain_documents_models.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_documents_models.py -q`

Expected: FAIL (`DomainDocument` / setting missing).

- [ ] **Step 3: Add `domain_files_dir` to Settings**

In `backend/tvashtr/config.py`, inside `class Settings`, near other path settings, add:

```python
    # PolyRAG Domains Phase 2: filesystem root for uploaded domain files.
    # Path layout: {domain_files_dir}/{owner_id}/{domain_id}/{document_id}/{safe_filename}
    # Dev/tests default to /tmp. Prod on Fly may mount a volume at /data/domain-files and set
    # TVASHTR_DOMAIN_FILES_DIR=/data/domain-files. No Tigris/S3 in Phase 2.
    domain_files_dir: str = Field(
        default="/tmp/tvashtr-domain-files",
        validation_alias=AliasChoices("TVASHTR_DOMAIN_FILES_DIR", "domain_files_dir"),
    )
```

- [ ] **Step 4: Add ORM models after `Domain`**

In `backend/tvashtr/models.py`, immediately after the `Domain` class, add:

```python
class DomainDocument(Base):
    """One uploaded file belonging to a PolyRAG Domain (Phase 2).

    Distinct from :class:`Document` (PRD work products). Raw bytes live on the
    filesystem under ``settings.domain_files_dir``; ``storage_path`` is the
    relative path under that root. NEVER store provider secrets here.
    """

    __tablename__ = "domain_documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    # Relative path under settings.domain_files_dir
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    byte_size: Mapped[int] = mapped_column(Integer, nullable=False)
    # pending | indexing | ready | error
    ingest_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending", default="pending"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1", default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DomainChunk(Base):
    """One embedded text chunk for a DomainDocument (Phase 2).

    ``embedding`` is ``vector(1536)`` — pinned to text-embedding-3-small like NodeMemory.
    """

    __tablename__ = "domain_chunks"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domain_documents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

Ensure `Integer` is already imported from sqlalchemy (it is, for NodeMemory).

- [ ] **Step 5: Add migration `0034_domain_documents_chunks.py`**

Create `backend/alembic/versions/0034_domain_documents_chunks.py`:

```python
"""domain_documents + domain_chunks — PolyRAG Phase 2 ingest

Revision ID: 0034_domain_documents_chunks
Revises: 0033_domains
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0034_domain_documents_chunks"
down_revision: str | None = "0033_domains"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "domain_documents",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("storage_path", sa.Text(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("ingest_status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_documents_domain_id", "domain_documents", ["domain_id"])

    op.create_table(
        "domain_chunks",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "document_id",
            sa.Uuid(),
            sa.ForeignKey("domain_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("meta", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_chunks_domain_id", "domain_chunks", ["domain_id"])
    op.create_index("ix_domain_chunks_document_id", "domain_chunks", ["document_id"])


def downgrade() -> None:
    op.drop_index("ix_domain_chunks_document_id", table_name="domain_chunks")
    op.drop_index("ix_domain_chunks_domain_id", table_name="domain_chunks")
    op.drop_table("domain_chunks")
    op.drop_index("ix_domain_documents_domain_id", table_name="domain_documents")
    op.drop_table("domain_documents")
```

- [ ] **Step 6: Add `pypdf` dependency**

In `backend/pyproject.toml` `dependencies` list, add:

```toml
    "pypdf>=5.0",
```

Then run: `cd backend && uv lock && uv sync`

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_domain_documents_models.py -q`

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/tvashtr/config.py backend/tvashtr/models.py \
  backend/alembic/versions/0034_domain_documents_chunks.py \
  backend/pyproject.toml backend/uv.lock \
  backend/tests/test_domain_documents_models.py
# set GIT_AUTHOR_* / GIT_COMMITTER_* from git log -1 — never git config
git commit -m "$(cat <<'EOF'
feat(domains): DomainDocument/Chunk models + files dir setting

EOF
)"
```

---

### Task 2: Filesystem storage + text extraction

**Files:**
- Create: `backend/tvashtr/control_plane/domain_files.py`
- Test: `backend/tests/test_domain_files.py`

**Interfaces:**
- Consumes: `get_settings().domain_files_dir`, `pypdf`
- Produces: `ALLOWED_EXTENSIONS`, `MAX_UPLOAD_BYTES`, `safe_filename`, `extension_of`, `content_type_for_ext`, `relative_storage_path`, `absolute_path`, `save_bytes`, `delete_stored`, `delete_domain_tree`, `extract_text`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_domain_files.py`:

```python
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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domain_files.py::test_safe_filename_strips_paths_and_keeps_ext -q`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement `domain_files.py`**

Create `backend/tvashtr/control_plane/domain_files.py`:

```python
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
```

- [ ] **Step 4: Run tests to pass**

Run: `cd backend && uv run pytest tests/test_domain_files.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_files.py backend/tests/test_domain_files.py
git commit -m "$(cat <<'EOF'
feat(domains): filesystem storage + text extraction helpers

EOF
)"
```

---


### Task 3: Document helpers + upload / list / delete API

**Files:**
- Modify: `backend/tvashtr/control_plane/domains.py`
- Modify: `backend/tvashtr/routers.py`
- Test: `backend/tests/test_domain_documents_api.py`

**Interfaces:**
- Consumes: `DomainDocument`, `domain_files.*`, owner-scoped `Domain`
- Produces: `document_to_dict`, `list_documents`, `create_document`, `delete_document`, `compute_domain_status`, `_apply_domain_aggregates`; HTTP `POST/GET/DELETE .../documents`

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_domain_documents_api.py`:

```python
"""Phase 2 — document upload / list / delete (owner-scoped)."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"docs-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "docs-password"},
        ).status_code
        == 200
    )
    return c


def _domain(c: TestClient) -> str:
    row = c.post("/api/domains", json={"template": "support", "name": "Docs"}).json()
    return row["domain_id"]


def test_upload_list_delete_txt():
    c = _fresh()
    did = _domain(c)
    files = {"file": ("notes.txt", b"hello world", "text/plain")}
    resp = c.post(f"/api/domains/{did}/documents", files=files)
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["filename"] == "notes.txt"
    assert doc["ingest_status"] == "pending"
    assert doc["byte_size"] == 11
    listed = c.get(f"/api/domains/{did}/documents").json()["documents"]
    assert len(listed) == 1
    domain = c.get(f"/api/domains/{did}").json()
    assert domain["doc_count"] == 1
    assert domain["status"] == "indexing"  # pending => indexing aggregate
    assert c.delete(f"/api/domains/{did}/documents/{doc['document_id']}").status_code == 200
    assert c.get(f"/api/domains/{did}/documents").json()["documents"] == []
    assert c.get(f"/api/domains/{did}").json()["doc_count"] == 0
    assert c.get(f"/api/domains/{did}").json()["status"] == "empty"


def test_reject_png_and_oversize():
    c = _fresh()
    did = _domain(c)
    assert (
        c.post(
            f"/api/domains/{did}/documents",
            files={"file": ("x.png", b"abc", "image/png")},
        ).status_code
        == 422
    )
    big = b"x" * (10 * 1024 * 1024 + 1)
    assert (
        c.post(
            f"/api/domains/{did}/documents",
            files={"file": ("big.txt", big, "text/plain")},
        ).status_code
        == 422
    )


def test_foreign_domain_documents_404():
    a = _fresh()
    b = _fresh()
    did = _domain(a)
    assert b.get(f"/api/domains/{did}/documents").status_code == 404
    assert (
        b.post(
            f"/api/domains/{did}/documents",
            files={"file": ("a.txt", b"a", "text/plain")},
        ).status_code
        == 404
    )
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domain_documents_api.py::test_upload_list_delete_txt -q`

Expected: FAIL (route missing).

- [ ] **Step 3: Add helpers to `domains.py`**

Update imports and replace/extend helpers in `backend/tvashtr/control_plane/domains.py`:

```python
from sqlalchemy import func, select

from tvashtr.control_plane import domain_files as domain_files_cp
from tvashtr.db import session_scope
from tvashtr.models import Domain, DomainDocument


INGEST_PENDING = "pending"
INGEST_INDEXING = "indexing"
INGEST_READY = "ready"
INGEST_ERROR = "error"


def compute_domain_status(ingest_statuses: list[str]) -> str:
    """Aggregate Domain.status from document ingest_status values.

    Rules (Phase 2):
    - 0 docs → ``empty``
    - any ``indexing`` or ``pending`` → ``indexing``
    - else any ``error`` → ``error``
    - else any ``ready`` → ``ready``
    - else → ``empty``
    """
    if not ingest_statuses:
        return "empty"
    if any(s in (INGEST_INDEXING, INGEST_PENDING) for s in ingest_statuses):
        return "indexing"
    if any(s == INGEST_ERROR for s in ingest_statuses):
        return "error"
    if any(s == INGEST_READY for s in ingest_statuses):
        return "ready"
    return "empty"


def _owned_domain(session, owner_id: uuid.UUID, domain_id: uuid.UUID) -> Domain | None:
    return session.execute(
        select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
    ).scalar_one_or_none()


def _doc_count(session, domain_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(DomainDocument)
            .where(DomainDocument.domain_id == domain_id)
        ).scalar_one()
    )


def _apply_domain_aggregates(session, domain: Domain) -> None:
    statuses = list(
        session.execute(
            select(DomainDocument.ingest_status).where(DomainDocument.domain_id == domain.id)
        ).scalars()
    )
    domain.status = compute_domain_status(statuses)


def document_to_dict(doc: DomainDocument) -> dict:
    return {
        "document_id": str(doc.id),
        "domain_id": str(doc.domain_id),
        "filename": doc.filename,
        "content_type": doc.content_type,
        "byte_size": doc.byte_size,
        "ingest_status": doc.ingest_status,
        "error_message": doc.error_message,
        "version": doc.version,
        "created_at": doc.created_at.isoformat(),
        "updated_at": doc.updated_at.isoformat(),
    }


def domain_to_dict(domain: Domain, *, doc_count: int) -> dict:
    return {
        "domain_id": str(domain.id),
        "name": domain.name,
        "template": domain.template,
        "config": domain.config or {},
        "status": domain.status,
        "doc_count": doc_count,
        "created_at": domain.created_at.isoformat(),
        "updated_at": domain.updated_at.isoformat(),
    }
```

Update every call site of `domain_to_dict` inside `list_domains` / `create_domain` / `get_domain` / `update_domain` to pass `doc_count=_doc_count(session, row.id)` while the session is open.

Add document CRUD + update `delete_domain`:

```python
def list_documents(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        rows = (
            session.execute(
                select(DomainDocument)
                .where(DomainDocument.domain_id == domain_id)
                .order_by(DomainDocument.created_at, DomainDocument.id)
            )
            .scalars()
            .all()
        )
        return [document_to_dict(r) for r in rows]


def create_document(
    owner_id: uuid.UUID, domain_id: uuid.UUID, filename: str, data: bytes
) -> dict:
    if len(data) > domain_files_cp.MAX_UPLOAD_BYTES:
        raise ValueError("file exceeds 10 MiB limit")
    ext = domain_files_cp.extension_of(filename)
    content_type = domain_files_cp.content_type_for_ext(ext)
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        doc = DomainDocument(
            domain_id=domain.id,
            filename=domain_files_cp.safe_filename(filename),
            content_type=content_type,
            storage_path="pending",
            byte_size=len(data),
            ingest_status=INGEST_PENDING,
        )
        session.add(doc)
        session.flush()
        rel = domain_files_cp.relative_storage_path(
            owner_id, domain.id, doc.id, doc.filename
        )
        domain_files_cp.save_bytes(rel, data)
        doc.storage_path = rel
        _apply_domain_aggregates(session, domain)
        session.flush()
        return document_to_dict(doc)


def delete_document(
    owner_id: uuid.UUID, domain_id: uuid.UUID, document_id: uuid.UUID
) -> bool:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return False
        doc = session.execute(
            select(DomainDocument).where(
                DomainDocument.id == document_id,
                DomainDocument.domain_id == domain_id,
            )
        ).scalar_one_or_none()
        if doc is None:
            return False
        rel = doc.storage_path
        session.delete(doc)  # cascades chunks via FK
        session.flush()
        _apply_domain_aggregates(session, domain)
        session.flush()
    domain_files_cp.delete_stored(rel)
    return True


def delete_domain(owner_id: uuid.UUID, domain_id: uuid.UUID) -> bool:
    with session_scope() as session:
        row = session.execute(
            select(Domain).where(Domain.id == domain_id, Domain.owner_id == owner_id)
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)  # cascades domain_documents / domain_chunks
        session.flush()
    domain_files_cp.delete_domain_tree(owner_id, domain_id)
    return True
```

- [ ] **Step 4: Wire router endpoints**

Near existing domain routes in `backend/tvashtr/routers.py`, import helpers and add:

```python
from fastapi import File, UploadFile
from tvashtr.control_plane.domains import (
    create_document,
    delete_document,
    list_documents,
    # keep existing domain CRUD imports
)


def _parse_doc_id(document_id: str) -> uuid.UUID:
    try:
        return uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid document id") from exc


@router.get("/api/domains/{domain_id}/documents")
def get_domain_documents(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    rows = list_documents(uuid.UUID(current_user.id), _parse_domain_id(domain_id))
    if rows is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"documents": rows}


@router.post("/api/domains/{domain_id}/documents")
async def post_domain_document(
    domain_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
    file: UploadFile = File(...),
) -> dict:
    raw = await file.read()
    name = file.filename or "upload.txt"
    try:
        return create_document(
            uuid.UUID(current_user.id), _parse_domain_id(domain_id), name, raw
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="domain not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete("/api/domains/{domain_id}/documents/{document_id}")
def delete_domain_document_endpoint(
    domain_id: str,
    document_id: str,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    ok = delete_document(
        uuid.UUID(current_user.id),
        _parse_domain_id(domain_id),
        _parse_doc_id(document_id),
    )
    if not ok:
        raise HTTPException(status_code=404, detail="document not found")
    return {"document_id": document_id, "deleted": True}
```

- [ ] **Step 5: Run API tests**

Run: `cd backend && uv run pytest tests/test_domain_documents_api.py -q`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/tvashtr/control_plane/domains.py backend/tvashtr/routers.py \
  backend/tests/test_domain_documents_api.py
git commit -m "$(cat <<'EOF'
feat(domains): document upload list delete API

EOF
)"
```

---

### Task 4: Fixed-size chunking helper

**Files:**
- Create: `backend/tvashtr/control_plane/domain_chunking.py`
- Test: `backend/tests/test_domain_chunking.py`

**Interfaces:**
- Consumes: domain config `chunking.size` / `chunking.overlap`
- Produces: `chunk_text(text: str, *, size: int, overlap: int) -> list[str]`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_domain_chunking.py`:

```python
"""Phase 2 — fixed chunking with overlap."""

import pytest

from tvashtr.control_plane.domain_chunking import chunk_text


def test_chunk_text_basic_overlap():
    text = "abcdefghijklmnopqrstuvwxyz"  # 26 chars
    parts = chunk_text(text, size=10, overlap=2)
    assert parts[0] == "abcdefghij"
    assert parts[1].startswith("ij")
    assert all(len(p) <= 10 for p in parts)
    assert len(parts) >= 3


def test_chunk_text_empty():
    assert chunk_text("", size=100, overlap=10) == []
    assert chunk_text("   ", size=100, overlap=10) == []


def test_chunk_text_rejects_bad_params():
    with pytest.raises(ValueError):
        chunk_text("hi", size=0, overlap=0)
    with pytest.raises(ValueError):
        chunk_text("hi", size=5, overlap=5)
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_chunking.py -q`

Expected: FAIL

- [ ] **Step 3: Implement**

Create `backend/tvashtr/control_plane/domain_chunking.py`:

```python
"""PolyRAG Domains Phase 2 — fixed-size character chunking with overlap."""

from __future__ import annotations


def chunk_text(text: str, *, size: int, overlap: int) -> list[str]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap < 0 or overlap >= size:
        raise ValueError("chunk overlap must be >= 0 and < size")
    cleaned = text.strip()
    if not cleaned:
        return []
    chunks: list[str] = []
    start = 0
    n = len(cleaned)
    step = size - overlap
    while start < n:
        end = min(start + size, n)
        piece = cleaned[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= n:
            break
        start += step
    return chunks
```

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_chunking.py -q
git add backend/tvashtr/control_plane/domain_chunking.py backend/tests/test_domain_chunking.py
git commit -m "$(cat <<'EOF'
feat(domains): fixed-size chunking helper

EOF
)"
```

---


### Task 5: DBOS ingest workflow (chunk → embed → pgvector)

**Files:**
- Create: `backend/tvashtr/control_plane/domain_ingest.py`
- Modify: `backend/tvashtr/main.py` (import workflow module for DBOS registration)
- Test: `backend/tests/test_domain_ingest_workflow.py`

**Interfaces:**
- Consumes: `extract_text`, `chunk_text`, `embed` / `EmbeddingRequest`, `resolve_owner_api_key`, models, `record_embedding_cost`
- Produces: `normalize_embedding_model`, `@DBOS.workflow() ingest_domain`, steps `mark_docs_indexing_step`, `ingest_one_document_step`, `refresh_domain_status_step`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_domain_ingest_workflow.py`:

```python
"""Phase 2 — DBOS ingest workflow with mocked gateway embed."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select

from tvashtr.config import get_settings
from tvashtr.control_plane.domain_ingest import (
    ingest_one_document_step,
    normalize_embedding_model,
)
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import DomainChunk, DomainDocument


def test_normalize_embedding_model():
    assert normalize_embedding_model("text-embedding-3-small") == "openai/text-embedding-3-small"
    assert (
        normalize_embedding_model("openai/text-embedding-3-small")
        == "openai/text-embedding-3-small"
    )


def _fresh_client() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"ingest-wf-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ingest-password"},
        ).status_code
        == 200
    )
    return c


def test_ingest_one_document_creates_chunks(monkeypatch, tmp_path):
    monkeypatch.setenv("TVASHTR_DOMAIN_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()

    fake_vec = [0.01] * 1536

    class FakeResult:
        vectors = [fake_vec]
        model = "openai/text-embedding-3-small"
        prompt_tokens = 1
        total_tokens = 1
        cost_usd = 0.0

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.embed",
        lambda req: FakeResult(),
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.record_embedding_cost",
        lambda **kwargs: None,
    )
    # DBOS.workflow_id may be unset outside a workflow — stub it for the step.
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ingest.DBOS.workflow_id",
        "test-wf",
        raising=False,
    )

    c = _fresh_client()
    me = c.get("/api/auth/me").json()
    owner_id = me["id"]
    did = c.post("/api/domains", json={"template": "support", "name": "WF"}).json()["domain_id"]
    doc = c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("notes.txt", b"hello world from domain ingest", "text/plain")},
    ).json()

    out = ingest_one_document_step(owner_id, did, doc["document_id"])
    assert out["ok"] is True
    assert out["chunks"] >= 1

    with session_scope() as session:
        row = session.execute(
            select(DomainDocument).where(DomainDocument.id == uuid.UUID(doc["document_id"]))
        ).scalar_one()
        assert row.ingest_status == "ready"
        n = session.execute(
            select(DomainChunk).where(DomainChunk.document_id == row.id)
        ).scalars().all()
        assert len(n) >= 1
        assert n[0].embedding is not None
        assert len(n[0].embedding) == 1536

    get_settings.cache_clear()
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_ingest_workflow.py::test_normalize_embedding_model -q`

Expected: FAIL

- [ ] **Step 3: Implement `domain_ingest.py`**

Create `backend/tvashtr/control_plane/domain_ingest.py`:

```python
"""PolyRAG Domains Phase 2 — DBOS ingest: extract → chunk → embed → pgvector."""

from __future__ import annotations

import uuid

from dbos import DBOS
from sqlalchemy import delete, select

from tvashtr.control_plane.credentials import NoCredentialError, resolve_owner_api_key
from tvashtr.control_plane.domain_chunking import chunk_text
from tvashtr.control_plane.domain_files import absolute_path, extension_of, extract_text
from tvashtr.control_plane.domains import (
    INGEST_ERROR,
    INGEST_INDEXING,
    INGEST_PENDING,
    INGEST_READY,
    _apply_domain_aggregates,
    _owned_domain,
)
from tvashtr.db import session_scope
from tvashtr.gateway import EmbeddingRequest, GatewayError, embed
from tvashtr.metering import record_embedding_cost
from tvashtr.models import DomainChunk, DomainDocument


def normalize_embedding_model(model: str) -> str:
    m = (model or "").strip() or "text-embedding-3-small"
    if "/" not in m:
        return f"openai/{m}"
    return m


@DBOS.step()
def mark_docs_indexing_step(owner_id: str, domain_id: str) -> list[str]:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    with session_scope() as session:
        domain = _owned_domain(session, oid, did)
        if domain is None:
            return []
        rows = (
            session.execute(
                select(DomainDocument).where(
                    DomainDocument.domain_id == did,
                    DomainDocument.ingest_status.in_([INGEST_PENDING, INGEST_ERROR]),
                )
            )
            .scalars()
            .all()
        )
        ids: list[str] = []
        for doc in rows:
            doc.ingest_status = INGEST_INDEXING
            doc.error_message = None
            ids.append(str(doc.id))
        _apply_domain_aggregates(session, domain)
        session.flush()
        return ids


@DBOS.step()
def ingest_one_document_step(owner_id: str, domain_id: str, document_id: str) -> dict:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    doc_id = uuid.UUID(document_id)
    try:
        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            if domain is None:
                return {"document_id": document_id, "ok": False, "error": "domain not found"}
            doc = session.execute(
                select(DomainDocument).where(
                    DomainDocument.id == doc_id, DomainDocument.domain_id == did
                )
            ).scalar_one_or_none()
            if doc is None:
                return {"document_id": document_id, "ok": False, "error": "document not found"}
            cfg = domain.config or {}
            chunking = cfg.get("chunking") or {}
            size = int(chunking.get("size") or 800)
            overlap = int(chunking.get("overlap") or 100)
            emb_model = normalize_embedding_model(
                str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
            )
            rel = doc.storage_path
            filename = doc.filename

        ext = extension_of(filename)
        text = extract_text(absolute_path(rel), ext)
        pieces = chunk_text(text, size=size, overlap=overlap)
        api_key = resolve_owner_api_key(oid, emb_model)

        vectors: list[list[float]] = []
        wf = getattr(DBOS, "workflow_id", None) or "no-wf"
        if pieces:
            batch = 16
            for i in range(0, len(pieces), batch):
                sub = pieces[i : i + batch]
                result = embed(
                    EmbeddingRequest(model=emb_model, input=sub, api_key=api_key)
                )
                record_embedding_cost(
                    workflow_id=None,
                    idempotency_key=f"domain-ingest:{document_id}:{i}:{wf}",
                    model=result.model,
                    prompt_tokens=result.prompt_tokens,
                    total_tokens=result.total_tokens,
                    cost_usd=result.cost_usd,
                )
                vectors.extend(result.vectors)

        with session_scope() as session:
            domain = _owned_domain(session, oid, did)
            doc = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one()
            session.execute(delete(DomainChunk).where(DomainChunk.document_id == doc_id))
            if pieces and len(vectors) != len(pieces):
                doc.ingest_status = INGEST_ERROR
                doc.error_message = "embedding provider returned unexpected vector count"
            else:
                for ordinal, piece in enumerate(pieces):
                    vec = vectors[ordinal]
                    if len(vec) != 1536:
                        doc.ingest_status = INGEST_ERROR
                        doc.error_message = f"embedding dim {len(vec)} != 1536"
                        break
                    session.add(
                        DomainChunk(
                            domain_id=did,
                            document_id=doc_id,
                            ordinal=ordinal,
                            text=piece,
                            embedding=vec,
                            meta={"filename": filename},
                        )
                    )
                else:
                    doc.ingest_status = INGEST_READY
                    doc.error_message = None
            if domain is not None:
                _apply_domain_aggregates(session, domain)
            session.flush()
        with session_scope() as session:
            doc2 = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one()
            return {
                "document_id": document_id,
                "ok": doc2.ingest_status == INGEST_READY,
                "chunks": len(pieces),
                "status": doc2.ingest_status,
            }
    except (NoCredentialError, GatewayError, ValueError, OSError) as exc:
        with session_scope() as session:
            doc = session.execute(
                select(DomainDocument).where(DomainDocument.id == doc_id)
            ).scalar_one_or_none()
            if doc is not None:
                doc.ingest_status = INGEST_ERROR
                doc.error_message = str(exc)[:2000]
            domain = _owned_domain(session, oid, did)
            if domain is not None:
                _apply_domain_aggregates(session, domain)
            session.flush()
        return {"document_id": document_id, "ok": False, "error": str(exc)}


@DBOS.step()
def refresh_domain_status_step(owner_id: str, domain_id: str) -> str:
    oid = uuid.UUID(owner_id)
    did = uuid.UUID(domain_id)
    with session_scope() as session:
        domain = _owned_domain(session, oid, did)
        if domain is None:
            return "missing"
        _apply_domain_aggregates(session, domain)
        session.flush()
        return domain.status


@DBOS.workflow()
def ingest_domain(owner_id: str, domain_id: str) -> dict:
    """Durable ingest for all pending/error documents on a domain."""
    wf = DBOS.workflow_id
    DBOS.logger.info(f"ingest_domain start wf={wf} domain={domain_id}")
    doc_ids = mark_docs_indexing_step(owner_id, domain_id)
    results = [ingest_one_document_step(owner_id, domain_id, doc_id) for doc_id in doc_ids]
    status = refresh_domain_status_step(owner_id, domain_id)
    DBOS.logger.info(f"ingest_domain done wf={wf} status={status}")
    return {"domain_id": domain_id, "status": status, "documents": results}
```

Also export `_owned_domain` and `_apply_domain_aggregates` from `domains.py` (they are used by the ingest module). If you prefer not to export underscored helpers, move them to a shared private module — but Phase 2 may import them from `domains` as shown.

In `backend/tvashtr/main.py`, near other workflow imports, add:

```python
import tvashtr.control_plane.domain_ingest  # noqa: F401  — register DBOS workflow
```

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_ingest_workflow.py -q
git add backend/tvashtr/control_plane/domain_ingest.py backend/tvashtr/main.py \
  backend/tests/test_domain_ingest_workflow.py backend/tvashtr/control_plane/domains.py
git commit -m "$(cat <<'EOF'
feat(domains): DBOS ingest workflow chunk embed pgvector

EOF
)"
```

---

### Task 6: Ingest API + BYOK preflight

**Files:**
- Modify: `backend/tvashtr/routers.py`
- Test: `backend/tests/test_domain_ingest_api.py`

**Interfaces:**
- Consumes: `held_provider_slugs`, `provider_for_model`, `DBOS.start_workflow`, `ingest_domain`, `get_domain`
- Produces: `POST /api/domains/{id}/ingest` → `{ domain_id, workflow_id, status }` or **422**

- [ ] **Step 1: Write failing tests**

Create `backend/tests/test_domain_ingest_api.py`:

```python
"""Phase 2 — ingest enqueue + BYOK 422."""

import uuid
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"ingest-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ingest-password"},
        ).status_code
        == 200
    )
    return c


def test_ingest_without_openai_key_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "I"}).json()["domain_id"]
    c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    monkeypatch.setattr("tvashtr.routers.held_provider_slugs", lambda owner_id: set())
    resp = c.post(f"/api/domains/{did}/ingest")
    assert resp.status_code == 422, resp.text
    detail = resp.json()["detail"]
    blob = detail if isinstance(detail, str) else str(detail)
    assert "openai" in blob.lower() or "API key" in blob or "embed" in blob.lower()


def test_ingest_starts_workflow(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "blank", "name": "I2"}).json()["domain_id"]
    c.post(
        f"/api/domains/{did}/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    handle = MagicMock()
    handle.workflow_id = "wf-domain-ingest-1"
    monkeypatch.setattr("tvashtr.routers.DBOS.start_workflow", lambda *a, **k: handle)
    resp = c.post(f"/api/domains/{did}/ingest")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["workflow_id"] == "wf-domain-ingest-1"
    assert body["domain_id"] == did
    assert body["status"] == "indexing"


def test_ingest_foreign_domain_404(monkeypatch):
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()["domain_id"]
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    assert b.post(f"/api/domains/{did}/ingest").status_code == 404
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_ingest_api.py -q`

Expected: FAIL

- [ ] **Step 3: Implement endpoint**

Ensure `DBOS` is imported in `routers.py` (already used for `generate_doc` / `run_team`). Add:

```python
from tvashtr.control_plane.credentials import held_provider_slugs, provider_for_model
from tvashtr.control_plane.domain_ingest import ingest_domain, normalize_embedding_model


@router.post("/api/domains/{domain_id}/ingest")
def post_domain_ingest(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    model = normalize_embedding_model(
        str(
            (row.get("config") or {})
            .get("embedding", {})
            .get("model")
            or "text-embedding-3-small"
        )
    )
    provider = provider_for_model(model)
    if provider not in held_provider_slugs(owner_id):
        raise HTTPException(
            status_code=422,
            detail={
                "message": (
                    f"you have no API key for: {provider} — needed to embed domain documents. "
                    "Add a key under Engines before ingesting."
                ),
                "missing_providers": [provider],
            },
        )
    handle = DBOS.start_workflow(ingest_domain, str(owner_id), str(did))
    return {
        "domain_id": str(did),
        "workflow_id": str(handle.workflow_id),
        "status": "indexing",
    }
```

Confirm `held_provider_slugs` is imported in routers (already used for team launch) or import from credentials as above.

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_ingest_api.py -q
git add backend/tvashtr/routers.py backend/tests/test_domain_ingest_api.py
git commit -m "$(cat <<'EOF'
feat(domains): ingest API with BYOK preflight

EOF
)"
```

---

### Task 7: Harden doc_count + status helper tests

**Files:**
- Modify: `backend/tvashtr/control_plane/domains.py` (remove any leftover hard-coded `doc_count: 0`)
- Modify: `backend/tests/test_domains_helpers.py`

**Interfaces:**
- Produces: unit coverage for `compute_domain_status`; serializers always use real counts

- [ ] **Step 1: Write helper tests**

Append to `backend/tests/test_domains_helpers.py`:

```python
from tvashtr.control_plane.domains import compute_domain_status


def test_compute_domain_status_rules():
    assert compute_domain_status([]) == "empty"
    assert compute_domain_status(["pending"]) == "indexing"
    assert compute_domain_status(["indexing", "ready"]) == "indexing"
    assert compute_domain_status(["ready", "error"]) == "error"
    assert compute_domain_status(["ready", "ready"]) == "ready"
    assert compute_domain_status(["error"]) == "error"
```

- [ ] **Step 2: Run**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py::test_compute_domain_status_rules -q`

Expected: PASS (helper landed in Task 3)

- [ ] **Step 3: Grep for hard-coded stub**

```bash
rg -n 'doc_count.: 0|Phase 2 wires' backend/tvashtr/control_plane/domains.py || true
```

Remove any remaining Phase 1 hard-coded `0` stub.

- [ ] **Step 4: Regression**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domains.py backend/tests/test_domains_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): real doc_count and status aggregation helpers

EOF
)"
```

---


### Task 8: Frontend API client for documents + ingest

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/domainDocuments.test.ts`

**Interfaces:**
- Produces: `DomainDocumentSummary`, `listDomainDocuments`, `uploadDomainDocument`, `deleteDomainDocument`, `ingestDomain`

- [ ] **Step 1: Write failing client test**

Create `frontend/src/lib/domainDocuments.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain document client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainDocuments hits GET documents", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ documents: [] }), { status: 200 }),
    );
    const rows = await api.listDomainDocuments("d1");
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/documents");
  });
});
```

- [ ] **Step 2: Run fail**

Run: `cd frontend && npm test -- src/lib/domainDocuments.test.ts`

Expected: FAIL (`listDomainDocuments` missing)

- [ ] **Step 3: Implement client**

Append to `frontend/src/lib/api.ts` (after existing Domain helpers):

```typescript
export interface DomainDocumentSummary {
  document_id: string;
  domain_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  ingest_status: "pending" | "indexing" | "ready" | "error" | string;
  error_message: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function listDomainDocuments(domainId: string): Promise<DomainDocumentSummary[]> {
  const data = await getJSON<{ documents: DomainDocumentSummary[] }>(
    `/api/domains/${domainId}/documents`,
  );
  return data.documents;
}

export async function uploadDomainDocument(
  domainId: string,
  file: File,
): Promise<DomainDocumentSummary> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch(apiUrl(`/api/domains/${domainId}/documents`), {
    method: "POST",
    body,
  });
  if (!res.ok) {
    let detail = `POST /api/domains/${domainId}/documents -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail && typeof j.detail === "object" && "message" in (j.detail as object)) {
        detail = String((j.detail as { message: string }).message);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as DomainDocumentSummary;
}

export async function deleteDomainDocument(domainId: string, documentId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/documents/${documentId}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(res.status, `DELETE document -> ${res.status}`);
}

export async function ingestDomain(
  domainId: string,
): Promise<{ domain_id: string; workflow_id: string; status: string }> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/ingest`), { method: "POST" });
  if (!res.ok) {
    let detail = `POST ingest -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail && typeof j.detail === "object" && "message" in (j.detail as object)) {
        detail = String((j.detail as { message: string }).message);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as { domain_id: string; workflow_id: string; status: string };
}
```

- [ ] **Step 4: Run pass + commit**

```bash
cd frontend && npm test -- src/lib/domainDocuments.test.ts
git add frontend/src/lib/api.ts frontend/src/lib/domainDocuments.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): domain documents + ingest API client

EOF
)"
```

---

### Task 9: Documents tab UI on domain detail

**Files:**
- Modify: `frontend/src/components/DomainsPage.tsx`
- Modify: `frontend/src/components/DomainsPage.test.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: document client APIs from Task 8
- Produces: detail tabs **Overview | Documents | Config** (no Chat)

- [ ] **Step 1: Write failing UI test**

Update the `vi.mock("../lib/api", …)` block in `DomainsPage.test.tsx` to include:

```typescript
  listDomainDocuments: vi.fn(),
  uploadDomainDocument: vi.fn(),
  deleteDomainDocument: vi.fn(),
  ingestDomain: vi.fn(),
```

Extend the typed `m` object accordingly. Add:

```typescript
it("shows Documents tab with ingest and no Chat tab", async () => {
  const user = userEvent.setup();
  m.listDomains.mockResolvedValue([
    {
      domain_id: "d1",
      name: "Support docs",
      template: "support",
      config: { embedding: { model: "text-embedding-3-small" } },
      status: "empty",
      doc_count: 0,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    },
  ]);
  m.getDomain.mockResolvedValue({
    domain_id: "d1",
    name: "Support docs",
    template: "support",
    config: {
      chunking: { strategy: "fixed", size: 600, overlap: 100 },
      embedding: { model: "text-embedding-3-small" },
      retrieval: { top_k: 8, mode: "dense" },
      generation: { model: null },
    },
    status: "indexing",
    doc_count: 1,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
  });
  m.listDomainDocuments.mockResolvedValue([
    {
      document_id: "doc1",
      domain_id: "d1",
      filename: "notes.txt",
      content_type: "text/plain",
      byte_size: 5,
      ingest_status: "pending",
      error_message: null,
      version: 1,
      created_at: "2026-09-15T00:00:00Z",
      updated_at: "2026-09-15T00:00:00Z",
    },
  ]);
  m.ingestDomain.mockResolvedValue({
    domain_id: "d1",
    workflow_id: "wf1",
    status: "indexing",
  });

  render(<DomainsPage />);
  await user.click(await screen.findByRole("button", { name: /Support docs/i }));
  await user.click(await screen.findByRole("tab", { name: /Documents/i }));
  expect(await screen.findByText("notes.txt")).toBeTruthy();
  expect(screen.getByText(/pending/i)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /Ingest/i }));
  await waitFor(() => expect(m.ingestDomain).toHaveBeenCalledWith("d1"));
  expect(screen.queryByRole("tab", { name: /Chat/i })).toBeNull();
});
```

- [ ] **Step 2: Run fail**

Run: `cd frontend && npm test -- src/components/DomainsPage.test.tsx`

Expected: FAIL (no Documents tab)

- [ ] **Step 3: Implement Documents tab**

In `DomainsPage.tsx`:

1. Change `type DetailTab = "overview" | "documents" | "config";`
2. Import `listDomainDocuments`, `uploadDomainDocument`, `deleteDomainDocument`, `ingestDomain`, `type DomainDocumentSummary`.
3. Add `const [documents, setDocuments] = useState<DomainDocumentSummary[]>([]);`
4. When `selectedId` / detail loads, also fetch documents when tab is documents (or always prefetch on detail open).
5. Add Documents tab button between Overview and Config.
6. Render Documents panel:

```tsx
{tab === "documents" && (
  <section className="tv-domains__panel" aria-label="Documents">
    <div className="tv-domains__docs-actions">
      <label className="tv-btn tv-btn--ghost">
        Upload
        <input
          type="file"
          accept=".pdf,.md,.txt,.html,application/pdf,text/plain,text/markdown,text/html"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void (async () => {
              setBusy(true);
              try {
                await uploadDomainDocument(detail.domain_id, f);
                setDocuments(await listDomainDocuments(detail.domain_id));
                setDetail(await getDomain(detail.domain_id));
                await refresh();
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Upload failed");
              } finally {
                if (mountedRef.current) setBusy(false);
              }
            })();
          }}
        />
      </label>
      <button
        type="button"
        className="tv-btn"
        disabled={busy}
        onClick={() => {
          void (async () => {
            setBusy(true);
            try {
              await ingestDomain(detail.domain_id);
              setDocuments(await listDomainDocuments(detail.domain_id));
              setDetail(await getDomain(detail.domain_id));
              await refresh();
              setError(null);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Ingest failed");
            } finally {
              if (mountedRef.current) setBusy(false);
            }
          })();
        }}
      >
        Ingest
      </button>
    </div>
    {error && (
      <div className="tv-dash__error" role="alert">
        {error}
      </div>
    )}
    {documents.length === 0 ? (
      <p className="tv-domains__empty">
        No documents yet. Upload a pdf, md, txt, or html file (max 10 MiB).
      </p>
    ) : (
      <ul className="tv-domains__docs-list">
        {documents.map((doc) => (
          <li key={doc.document_id} className="tv-domains__docs-row">
            <span className="tv-domains__docs-name">{doc.filename}</span>
            <span className="tv-domains__docs-status">{doc.ingest_status}</span>
            {doc.error_message ? (
              <span className="tv-domains__docs-err">{doc.error_message}</span>
            ) : null}
            <button
              type="button"
              className="tv-btn tv-btn--ghost"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await deleteDomainDocument(detail.domain_id, doc.document_id);
                    setDocuments(await listDomainDocuments(detail.domain_id));
                    setDetail(await getDomain(detail.domain_id));
                    await refresh();
                  } finally {
                    if (mountedRef.current) setBusy(false);
                  }
                })();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
)}
```

7. On detail open (`useEffect` on `selectedId`), call `listDomainDocuments` and `setDocuments`.
8. Update Overview: show `{detail.doc_count}` without “later phase”; hint that Chat arrives in Phase 3.
9. Update list lede: “create a domain, upload docs, ingest with your Engines keys.”

Add CSS in `index.css`:

```css
.tv-domains__docs-actions {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}
.tv-domains__docs-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tv-domains__docs-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--tv-border, #2a2a2a);
  border-radius: 8px;
}
.tv-domains__docs-name {
  font-weight: 600;
}
.tv-domains__docs-status {
  opacity: 0.8;
  text-transform: lowercase;
}
.tv-domains__docs-err {
  color: var(--tv-danger, #f87171);
  font-size: 0.85rem;
}
```

- [ ] **Step 4: Run pass + commit**

```bash
cd frontend && npm test -- src/components/DomainsPage.test.tsx
git add frontend/src/components/DomainsPage.tsx \
  frontend/src/components/DomainsPage.test.tsx frontend/src/index.css
git commit -m "$(cat <<'EOF'
feat(frontend): Domains Documents tab upload ingest delete

EOF
)"
```

---

### Task 10: Regression gate

**Files:** none new (verification only)

- [ ] **Step 1: Confirm implementation branch**

When starting implementation (not for this docs commit):

```bash
git checkout feat/polyrag-domains-phase1
git pull --ff-only  # if tracking
git checkout -b feat/polyrag-domains-phase2
```

- [ ] **Step 2: Backend regression**

```bash
cd backend && uv run pytest \
  tests/test_domain_documents_models.py \
  tests/test_domain_files.py \
  tests/test_domain_chunking.py \
  tests/test_domain_documents_api.py \
  tests/test_domain_ingest_workflow.py \
  tests/test_domain_ingest_api.py \
  tests/test_domains_helpers.py \
  tests/test_domains_api.py -q
```

Expected: PASS

- [ ] **Step 3: Frontend regression**

```bash
cd frontend && npm test -- \
  src/components/DomainsPage.test.tsx \
  src/lib/domainDocuments.test.ts \
  src/components/AppShell.test.tsx
```

Expected: PASS

- [ ] **Step 4: YAGNI grep**

```bash
rg -n "/ask|/messages|DomainMessage|role=\"tab\".*Chat|hybrid|rerank" \
  backend/tvashtr/control_plane/domains.py \
  backend/tvashtr/control_plane/domain_ingest.py \
  backend/tvashtr/routers.py \
  frontend/src/components/DomainsPage.tsx || true
```

Expected: no Phase 3 ask/messages/Chat or Phase 5 hybrid implementations.

- [ ] **Step 5: Final fixup commit only if needed**

```bash
git commit -m "$(cat <<'EOF'
test(domains): Phase 2 regression gate green

EOF
)"
```

---

## Self-review checklist (Phase 2 spec → tasks)

| Spec Phase 2 item | Task(s) |
|-------------------|---------|
| Upload documents | Task 3 (API) + Task 9 (UI) |
| Filesystem storage under `TVASHTR_DOMAIN_FILES_DIR`, path layout, no S3 | Task 1 (setting) + Task 2 |
| File types pdf/md/txt/html, max 10 MiB | Task 2 + Task 3 tests |
| DBOS ingest: chunk → embed → pgvector | Task 4 + Task 5 |
| `pypdf` text extract, skip empty pages | Task 2 |
| Embeddings via gateway + owner BYOK; Vector(1536) | Task 1 (column) + Task 5 + Task 6 |
| Document ingest_status pending/indexing/ready/error (+ error_message) | Task 1 + Task 3 + Task 5 |
| Domain.status aggregate rules | Task 3 helpers + Task 7 |
| Real `doc_count` | Task 3 + Task 7 |
| APIs POST/GET/DELETE documents + POST ingest | Task 3 + Task 6 |
| BYOK preflight 422 on ingest | Task 6 |
| Auth owner-scoped; foreign → 404 | Task 3 + Task 6 tests |
| UI Documents tab (shared React); no Chat/ask | Task 8 + Task 9 |
| Branch `feat/polyrag-domains-phase2` from phase1 | Global Constraints + Task 10 |
| YAGNI: no ask/messages/hybrid/rerank | Global Constraints + Task 10 grep |

### Plan completeness notes

- **No TBDs** for storage (filesystem locked), file types, embedding dim, status enums, or branch base.
- **Naming collision resolved:** `DomainDocument` / `DomainChunk` (not `Document`) because PRD `Document` already exists.
- **Fly volume:** documented via env `TVASHTR_DOMAIN_FILES_DIR=/data/domain-files` — no code change required in Phase 2 beyond the setting.
- **Embedding model string:** domain config stores bare `text-embedding-3-small`; ingest normalizes to `openai/text-embedding-3-small` for gateway + BYOK provider slug.
