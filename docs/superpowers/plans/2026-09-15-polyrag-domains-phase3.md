# PolyRAG Domains Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 3 only — cited chat for a Domain (`POST /ask` + `GET /messages`), `DomainMessage` persistence with citations JSON + latency, and a Chat tab on domain detail (shared React web+Desktop) — with no canvas Query-domain node, MCP tools, hybrid/rerank, or streaming.

**Architecture:** Extend Phase 2 corpora with owner-scoped `domain_messages`. Ask is **sync HTTP** (not DBOS): embed the question via gateway + owner BYOK → dense cosine retrieve on `DomainChunk.embedding` (ready documents only, `top_k` from config) → build a numbered-excerpt prompt → `complete()` via gateway → persist user + assistant `DomainMessage` rows → return answer + citations. Message history is a simple chronological list for the Chat tab. Generation model comes from `config.generation.model` or the same account-default / settings fallback teams use; missing embed or chat provider keys → 422 (mirror ingest preflight).

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pgvector + pytest (backend); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop). Reuse `tvashtr.gateway` `embed` / `complete`, `normalize_embedding_model` from Phase 2, and `cosine_distance` pattern from `memory_retrieval.py`.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 3 only**.
- **Branch base:** Implement on new branch `feat/polyrag-domains-phase3` created from current `feat/polyrag-domains-phase2` HEAD `034a36a`. Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — Desktop continues same-origin `/api` proxy to Fly; no Desktop-only Domain backend.
- Auth / ownership: `get_current_user` + owner scope; foreign domain ids → **404** (not probeable).
- **ORM name (locked):** `DomainMessage` / table `domain_messages`; migration `0035_domain_messages` revises `0034_domain_documents_chunks`.
- **Retrieve (locked):** dense cosine on `DomainChunk.embedding` via SQLAlchemy `cosine_distance` (same pattern as `memory_retrieval.py`); `top_k` from domain config `retrieval.top_k` (default **8**); only chunks whose document `ingest_status == "ready"`.
- **Ask flow (locked):** sync HTTP, not DBOS — embed question → retrieve top_k → build prompt with numbered excerpts → `complete()` via gateway → persist user+assistant DomainMessages → return answer + citations. Keep under ~30s typical; **no streaming** in Phase 3.
- **Citations JSON (locked):** list of `{ document_id, filename, chunk_id, ordinal, excerpt, score? }` — excerpt truncated to ~**400** chars.
- **Generation model (locked):** `config.generation.model` if set/non-empty; else `account_default_model(held_providers, "thinker")` or `get_settings().default_model` (mirror team node defaults simply); if still none → **422** with clear message.
- **Embedding model (locked):** same normalize as Phase 2 ingest — `normalize_embedding_model(...)` defaulting bare ids to `openai/text-embedding-3-small`.
- **BYOK (locked):** **422** if missing embed and/or chat provider keys (mirror ingest preflight via `held_provider_slugs` + `provider_for_model`).
- **Empty corpus (locked):** if no ready chunks → **422** `"ingest documents before asking"`.
- **Latency (locked):** store optional `latency_ms` on assistant message; `cost_usd` optional if metering is easy — at least latency (wall-clock ask or gateway `CompletionResult.latency_ms`).
- **UI (locked):** Chat tab on detail — **Overview | Documents | Chat | Config**; message list + composer; citations under assistant bubbles; no streaming.
- YAGNI: **no** Query-domain canvas node, **no** MCP/`domain_ask` tool, **no** hybrid/rerank, **no** GraphRAG, **no** streaming SSE.
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` from `git log -1`); **never** `git config`.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Modify** `backend/tvashtr/models.py` | Add `DomainMessage` after `DomainChunk`. |
| **Create** `backend/alembic/versions/0035_domain_messages.py` | Additive `domain_messages` table; `down_revision = 0034_domain_documents_chunks`. |
| **Create** `backend/tvashtr/control_plane/domain_retrieve.py` | Dense cosine retrieve over ready chunks; citation dict builder + excerpt truncate. |
| **Create** `backend/tvashtr/control_plane/domain_ask.py` | Resolve generation model; BYOK check helpers; prompt builder; sync `ask_domain` (embed → retrieve → complete → persist). |
| **Modify** `backend/tvashtr/control_plane/domains.py` | Optional thin serializers / list_messages if kept here; prefer ask module owns message CRUD. |
| **Modify** `backend/tvashtr/routers.py` | `POST /api/domains/{id}/ask`, `GET /api/domains/{id}/messages`. |
| **Create** `backend/tests/test_domain_messages_models.py` | ORM + tablename smoke. |
| **Create** `backend/tests/test_domain_retrieve.py` | Retrieve unit tests (mocked session / cosine order). |
| **Create** `backend/tests/test_domain_ask_helpers.py` | Prompt + model resolve + citation truncate unit tests. |
| **Create** `backend/tests/test_domain_ask_api.py` | Ask/messages API: happy path (mocked gateway), BYOK 422, empty corpus 422, foreign 404. |
| **Modify** `frontend/src/lib/api.ts` | Message types + `askDomain` + `listDomainMessages`. |
| **Create** `frontend/src/lib/domainMessages.test.ts` | Client GET/POST smoke. |
| **Modify** `frontend/src/components/DomainsPage.tsx` | Chat tab UI. |
| **Modify** `frontend/src/components/DomainsPage.test.tsx` | Chat tab tests. |
| **Modify** `frontend/src/index.css` | Chat styles under `.tv-domains*`. |

**Out of scope (do not create for Phase 3):** canvas Query-domain node, MCP tools, hybrid/lexical retrieval, rerank, streaming, GraphRAG, Tigris/S3.

---

### Task 1: DomainMessage model + migration 0035

**Files:**
- Modify: `backend/tvashtr/models.py` (after `DomainChunk`)
- Create: `backend/alembic/versions/0035_domain_messages.py`
- Test: `backend/tests/test_domain_messages_models.py`

**Interfaces:**
- Consumes: `Base`, `Uuid`, `JSONB`, `ForeignKey("domains.id")`, Alembic head `0034_domain_documents_chunks`
- Produces: `DomainMessage` ORM; table `domain_messages`

- [ ] **Step 1: Write the failing model import smoke**

Create `backend/tests/test_domain_messages_models.py`:

```python
"""Phase 3 — DomainMessage ORM smoke."""

from tvashtr.models import DomainMessage


def test_domain_message_tablename():
    assert DomainMessage.__tablename__ == "domain_messages"


def test_domain_message_has_citations_and_latency():
    cols = {c.name for c in DomainMessage.__table__.columns}
    assert "domain_id" in cols
    assert "role" in cols
    assert "content" in cols
    assert "citations" in cols
    assert "latency_ms" in cols
    assert "cost_usd" in cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_messages_models.py -q`

Expected: FAIL (`DomainMessage` missing).

- [ ] **Step 3: Add ORM model after `DomainChunk`**

In `backend/tvashtr/models.py`, immediately after the `DomainChunk` class (before `GithubInstallation`), add:

```python
class DomainMessage(Base):
    """One chat turn for a PolyRAG Domain (Phase 3 cited Q&A).

    ``role`` is ``user`` or ``assistant``. Assistant rows may carry ``citations``
    (JSON list of chunk/source refs) plus optional ``latency_ms`` / ``cost_usd``.
    NEVER store provider secrets here.
    """

    __tablename__ = "domain_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # user | assistant
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    citations: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

Ensure `Decimal` is already imported from `decimal` (it is) and `Numeric` / `Integer` are already imported.

- [ ] **Step 4: Add Alembic migration**

Create `backend/alembic/versions/0035_domain_messages.py`:

```python
"""domain_messages — PolyRAG Phase 3 cited chat

Revision ID: 0035_domain_messages
Revises: 0034_domain_documents_chunks
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0035_domain_messages"
down_revision: str | None = "0034_domain_documents_chunks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "domain_messages",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("citations", JSONB(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_messages_domain_id", "domain_messages", ["domain_id"])


def downgrade() -> None:
    op.drop_index("ix_domain_messages_domain_id", table_name="domain_messages")
    op.drop_table("domain_messages")
```

- [ ] **Step 5: Run tests + commit**

```bash
cd backend && uv run pytest tests/test_domain_messages_models.py -q
git add backend/tvashtr/models.py backend/alembic/versions/0035_domain_messages.py backend/tests/test_domain_messages_models.py
git commit -m "$(cat <<'EOF'
feat(domains): DomainMessage model + migration 0035

EOF
)"
```

---

### Task 2: Dense retrieve helper

**Files:**
- Create: `backend/tvashtr/control_plane/domain_retrieve.py`
- Test: `backend/tests/test_domain_retrieve.py`

**Interfaces:**
- Consumes: `DomainChunk`, `DomainDocument`, `session_scope`, `cosine_distance` pattern from `memory_retrieval.py`
- Produces:
  - `EXCERPT_MAX = 400`
  - `truncate_excerpt(text: str, max_chars: int = EXCERPT_MAX) -> str`
  - `retrieve_domain_chunks(domain_id: uuid.UUID, query_embedding: list[float], top_k: int) -> list[dict]`
  - Each dict: `{ chunk_id, document_id, filename, ordinal, text, score }` where `score` is cosine **similarity** `1 - distance` when distance is available, else omitted/`None`

- [ ] **Step 1: Write failing unit tests**

Create `backend/tests/test_domain_retrieve.py`:

```python
"""Phase 3 — dense retrieve + excerpt truncate."""

from tvashtr.control_plane.domain_retrieve import truncate_excerpt


def test_truncate_excerpt_short_unchanged():
    assert truncate_excerpt("hello", 400) == "hello"


def test_truncate_excerpt_long():
    s = "x" * 500
    out = truncate_excerpt(s, 400)
    assert len(out) == 400
    assert out == "x" * 400


def test_retrieve_domain_chunks_callable():
    from tvashtr.control_plane import domain_retrieve as dr

    assert callable(dr.retrieve_domain_chunks)
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_retrieve.py -q`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement retrieve helper**

Create `backend/tvashtr/control_plane/domain_retrieve.py`:

```python
"""PolyRAG Domains Phase 3 — dense cosine retrieve over ready DomainChunks."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from tvashtr.db import session_scope
from tvashtr.models import DomainChunk, DomainDocument

EXCERPT_MAX = 400


def truncate_excerpt(text: str, max_chars: int = EXCERPT_MAX) -> str:
    t = text or ""
    if len(t) <= max_chars:
        return t
    return t[:max_chars]


def retrieve_domain_chunks(
    domain_id: uuid.UUID, query_embedding: list[float], top_k: int
) -> list[dict]:
    """Return up to ``top_k`` ready chunks ranked by cosine distance ascending.

    Only chunks whose parent ``DomainDocument.ingest_status == "ready"`` and whose
    ``embedding`` is non-null are considered. Mirrors ``memory_retrieval`` use of
    ``embedding.cosine_distance(qvec)``.
    """
    k = max(1, int(top_k or 8))
    qvec = query_embedding
    with session_scope() as session:
        dist = DomainChunk.embedding.cosine_distance(qvec)
        stmt = (
            select(DomainChunk, DomainDocument.filename, dist.label("distance"))
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainChunk.embedding.isnot(None),
                DomainDocument.ingest_status == "ready",
            )
            .order_by(dist)
            .limit(k)
        )
        rows = session.execute(stmt).all()
        out: list[dict] = []
        for chunk, filename, distance in rows:
            score = None
            if distance is not None:
                try:
                    score = float(1.0 - float(distance))
                except (TypeError, ValueError):
                    score = None
            out.append(
                {
                    "chunk_id": str(chunk.id),
                    "document_id": str(chunk.document_id),
                    "filename": filename,
                    "ordinal": int(chunk.ordinal),
                    "text": chunk.text,
                    "score": score,
                }
            )
        return out


def citations_from_chunks(chunks: list[dict]) -> list[dict]:
    """Build locked citation JSON (excerpt truncated)."""
    cites: list[dict] = []
    for c in chunks:
        item = {
            "document_id": c["document_id"],
            "filename": c["filename"],
            "chunk_id": c["chunk_id"],
            "ordinal": c["ordinal"],
            "excerpt": truncate_excerpt(c.get("text") or ""),
        }
        if c.get("score") is not None:
            item["score"] = c["score"]
        cites.append(item)
    return cites
```

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_retrieve.py -q
git add backend/tvashtr/control_plane/domain_retrieve.py backend/tests/test_domain_retrieve.py
git commit -m "$(cat <<'EOF'
feat(domains): dense cosine retrieve helper for Phase 3 ask

EOF
)"
```

---

### Task 3: Ask helpers — generation model, prompt, BYOK preflight

**Files:**
- Create: `backend/tvashtr/control_plane/domain_ask.py` (helpers first; full ask in Task 4)
- Test: `backend/tests/test_domain_ask_helpers.py`

**Interfaces:**
- Consumes: `account_default_model`, `held_provider_slugs`, `provider_for_model`, `get_settings`, `normalize_embedding_model`, `citations_from_chunks`
- Produces:
  - `resolve_domain_generation_model(owner_id: uuid.UUID, config: dict) -> str` (raises `ValueError` if none)
  - `build_ask_messages(question: str, chunks: list[dict]) -> list[dict]` (system + user for `CompletionRequest`)
  - `missing_ask_providers(owner_id, embed_model, gen_model) -> list[str]` (sorted unique missing provider slugs)

- [ ] **Step 1: Write failing helper tests**

Create `backend/tests/test_domain_ask_helpers.py`:

```python
"""Phase 3 — ask prompt + generation model resolve."""

import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane.domain_ask import (
    build_ask_messages,
    missing_ask_providers,
    resolve_domain_generation_model,
)


def test_build_ask_messages_numbers_excerpts():
    chunks = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.txt",
            "ordinal": 0,
            "text": "Alpha facts",
            "score": 0.9,
        },
        {
            "chunk_id": "c2",
            "document_id": "d2",
            "filename": "b.txt",
            "ordinal": 1,
            "text": "Beta facts",
            "score": 0.8,
        },
    ]
    msgs = build_ask_messages("What is alpha?", chunks)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert "[1]" in msgs[0]["content"]
    assert "Alpha facts" in msgs[0]["content"]
    assert "[2]" in msgs[0]["content"]
    assert msgs[1]["role"] == "user"
    assert msgs[1]["content"] == "What is alpha?"


def test_resolve_uses_config_generation_model():
    oid = uuid.uuid4()
    model = resolve_domain_generation_model(
        oid, {"generation": {"model": "openai/gpt-4o-mini"}}
    )
    assert model == "openai/gpt-4o-mini"


def test_resolve_falls_back_to_account_default(monkeypatch):
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value={"openai"},
    ), patch(
        "tvashtr.control_plane.domain_ask.account_default_model",
        return_value="openai/gpt-4o-mini",
    ):
        model = resolve_domain_generation_model(oid, {"generation": {"model": None}})
    assert model == "openai/gpt-4o-mini"


def test_resolve_raises_when_none(monkeypatch):
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value=set(),
    ), patch(
        "tvashtr.control_plane.domain_ask.account_default_model",
        return_value=None,
    ), patch(
        "tvashtr.control_plane.domain_ask.get_settings",
    ) as gs:
        gs.return_value.default_model = ""
        with pytest.raises(ValueError, match="generation model"):
            resolve_domain_generation_model(oid, {"generation": {"model": None}})


def test_missing_ask_providers_reports_both():
    oid = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        return_value=set(),
    ):
        missing = missing_ask_providers(
            oid,
            "openai/text-embedding-3-small",
            "anthropic/claude-3-5-sonnet-20241022",
        )
    assert missing == ["anthropic", "openai"]
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_ask_helpers.py -q`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement helpers in `domain_ask.py`**

Create `backend/tvashtr/control_plane/domain_ask.py`:

```python
"""PolyRAG Domains Phase 3 — sync cited ask (embed → retrieve → complete → persist)."""

from __future__ import annotations

import time
import uuid
from decimal import Decimal

from sqlalchemy import func, select

from tvashtr.config import get_settings
from tvashtr.control_plane.credentials import (
    NoCredentialError,
    held_provider_slugs,
    provider_for_model,
    resolve_owner_api_key,
)
from tvashtr.control_plane.domain_ingest import normalize_embedding_model
from tvashtr.control_plane.domain_retrieve import (
    citations_from_chunks,
    retrieve_domain_chunks,
)
from tvashtr.control_plane.domains import _owned_domain
from tvashtr.control_plane.teams import account_default_model
from tvashtr.db import session_scope
from tvashtr.gateway import (
    CompletionRequest,
    EmbeddingRequest,
    GatewayError,
    complete,
    embed,
)
from tvashtr.models import DomainChunk, DomainDocument, DomainMessage

ROLE_USER = "user"
ROLE_ASSISTANT = "assistant"


def resolve_domain_generation_model(owner_id: uuid.UUID, config: dict) -> str:
    """Prefer ``config.generation.model``; else account thinker default / settings."""
    raw = (config or {}).get("generation") or {}
    configured = raw.get("model") if isinstance(raw, dict) else None
    if configured is not None and str(configured).strip():
        return str(configured).strip()
    held = held_provider_slugs(owner_id)
    model = account_default_model(held, "thinker") or (get_settings().default_model or "")
    model = str(model).strip()
    if not model:
        raise ValueError(
            "no generation model configured — set config.generation.model or add a "
            "provider key under Engines"
        )
    return model


def missing_ask_providers(
    owner_id: uuid.UUID, embed_model: str, gen_model: str
) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(embed_model), provider_for_model(gen_model)}
    return sorted(p for p in needed if p not in held)


def build_ask_messages(question: str, chunks: list[dict]) -> list[dict]:
    """System prompt with numbered excerpts + user question (no prior chat history)."""
    lines = [
        "You are a helpful assistant answering questions using ONLY the numbered "
        "context excerpts below. Cite sources by number like [1] when you use them. "
        "If the context is insufficient, say you do not have enough information.",
        "",
        "Context:",
    ]
    for i, c in enumerate(chunks, start=1):
        fn = c.get("filename") or "document"
        text = (c.get("text") or "").strip()
        lines.append(f"[{i}] ({fn}) {text}")
    system = "\n".join(lines)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]


def message_to_dict(row: DomainMessage) -> dict:
    return {
        "message_id": str(row.id),
        "domain_id": str(row.domain_id),
        "role": row.role,
        "content": row.content,
        "citations": row.citations,
        "latency_ms": row.latency_ms,
        "cost_usd": float(row.cost_usd) if row.cost_usd is not None else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def count_ready_chunks(session, domain_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(DomainChunk)
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainChunk.embedding.isnot(None),
                DomainDocument.ingest_status == "ready",
            )
        ).scalar_one()
    )


def list_domain_messages(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            return None
        rows = (
            session.execute(
                select(DomainMessage)
                .where(DomainMessage.domain_id == domain_id)
                .order_by(DomainMessage.created_at, DomainMessage.id)
            )
            .scalars()
            .all()
        )
        return [message_to_dict(r) for r in rows]


# ask_domain implemented in Task 4
```

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_ask_helpers.py -q
git add backend/tvashtr/control_plane/domain_ask.py backend/tests/test_domain_ask_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): ask helpers — model resolve, prompt, BYOK check

EOF
)"
```

---

### Task 4: Sync `ask_domain` (embed → retrieve → complete → persist)

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_ask.py`
- Test: extend `backend/tests/test_domain_ask_helpers.py` (or create `backend/tests/test_domain_ask_flow.py`)

**Interfaces:**
- Produces: `ask_domain(owner_id, domain_id, question: str) -> dict` raising typed errors the router maps:
  - `DomainAskError` with `.code` in `{not_found, empty_corpus, no_model, missing_providers, gateway}` and `.detail`
  - Success dict: `{ answer, citations, message_id, user_message_id, latency_ms, cost_usd? }`

- [ ] **Step 1: Write failing flow test (mocked gateway)**

Append to `backend/tests/test_domain_ask_helpers.py` **or** create `backend/tests/test_domain_ask_flow.py`:

```python
"""Phase 3 — ask_domain sync flow with mocked gateway."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_ask import DomainAskError, ask_domain
from tvashtr.db import session_scope
from tvashtr.gateway import CompletionResult, EmbeddingResult
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _register() -> tuple[TestClient, uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askflow-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "ask-password"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "AskFlow"}).json()["domain_id"]
    )
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        owner_id = domain.owner_id
    return c, owner_id, did


def test_ask_domain_persists_messages(monkeypatch):
    _c, owner_id, did = _register()
    # seed ready doc + chunk
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        doc = DomainDocument(
            domain_id=did,
            filename="faq.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/faq.txt",
            byte_size=12,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        # 1536-dim zero vector is fine for cosine ordering with a single row
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take 5 business days.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()

    emb = EmbeddingResult(
        vectors=[[0.0] * 1536],
        model="openai/text-embedding-3-small",
        prompt_tokens=1,
        total_tokens=1,
        cost_usd=0.0,
        raw_provider="openai",
        latency_ms=1.0,
    )
    cmp = CompletionResult(
        text="Refunds take 5 business days [1].",
        model_requested="openai/gpt-4o-mini",
        model_used="openai/gpt-4o-mini",
        prompt_tokens=10,
        completion_tokens=5,
        total_tokens=15,
        cost_usd=0.001,
        raw_provider="openai",
        latency_ms=12.0,
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_owner_api_key",
        lambda oid, model: "sk-test",
    )
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.embed", lambda req: emb)
    monkeypatch.setattr("tvashtr.control_plane.domain_ask.complete", lambda req: cmp)

    result = ask_domain(owner_id, did, "How long do refunds take?")
    assert "5 business days" in result["answer"]
    assert result["citations"]
    assert result["citations"][0]["filename"] == "faq.txt"
    assert result["latency_ms"] is not None

    from tvashtr.control_plane.domain_ask import list_domain_messages

    msgs = list_domain_messages(owner_id, did)
    assert msgs is not None
    assert len(msgs) >= 2
    assert msgs[-2]["role"] == "user"
    assert msgs[-1]["role"] == "assistant"
    assert msgs[-1]["citations"]


def test_ask_domain_empty_corpus(monkeypatch):
    _c, owner_id, did = _register()
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.held_provider_slugs",
        lambda oid: {"openai"},
    )
    monkeypatch.setattr(
        "tvashtr.control_plane.domain_ask.resolve_domain_generation_model",
        lambda oid, cfg: "openai/gpt-4o-mini",
    )
    with pytest.raises(DomainAskError) as ei:
        ask_domain(owner_id, did, "Anything?")
    assert ei.value.code == "empty_corpus"
```

**Note for implementers:** Resolve `owner_id` from the created `Domain.owner_id` after register+create (as above). Keep the same TestClient register pattern as `test_domain_ingest_api.py`.

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_ask_flow.py -q`

Expected: FAIL (`ask_domain` / `DomainAskError` missing).

- [ ] **Step 3: Implement `ask_domain` + `DomainAskError`**

Append to `backend/tvashtr/control_plane/domain_ask.py`:

```python
class DomainAskError(Exception):
    def __init__(self, code: str, detail: str | dict):
        self.code = code
        self.detail = detail
        super().__init__(str(detail))


def ask_domain(owner_id: uuid.UUID, domain_id: uuid.UUID, question: str) -> dict:
    """Sync cited ask. Raises DomainAskError for mapped HTTP statuses."""
    q = (question or "").strip()
    if not q:
        raise DomainAskError("bad_request", "question must be non-empty")

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        cfg = dict(domain.config or {})
        ready_n = count_ready_chunks(session, domain_id)
        if ready_n < 1:
            raise DomainAskError("empty_corpus", "ingest documents before asking")
        top_k = int((cfg.get("retrieval") or {}).get("top_k") or 8)
        emb_model = normalize_embedding_model(
            str((cfg.get("embedding") or {}).get("model") or "text-embedding-3-small")
        )

    try:
        gen_model = resolve_domain_generation_model(owner_id, cfg)
    except ValueError as e:
        raise DomainAskError("no_model", str(e)) from e

    missing = missing_ask_providers(owner_id, emb_model, gen_model)
    if missing:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    "you have no API key for: "
                    + ", ".join(missing)
                    + " — needed to embed the question and generate an answer. "
                    "Add keys under Engines before asking."
                ),
                "missing_providers": missing,
            },
        )

    try:
        embed_key = resolve_owner_api_key(owner_id, emb_model)
        chat_key = resolve_owner_api_key(owner_id, gen_model)
    except NoCredentialError as e:
        raise DomainAskError(
            "missing_providers",
            {
                "message": (
                    f"you have no API key for: {e.provider} — needed for domain ask. "
                    "Add a key under Engines before asking."
                ),
                "missing_providers": [e.provider],
            },
        ) from e

    started = time.perf_counter()
    try:
        emb_result = embed(
            EmbeddingRequest(model=emb_model, input=[q], api_key=embed_key)
        )
    except GatewayError as e:
        raise DomainAskError("gateway", f"embedding failed: {e}") from e
    if not emb_result.vectors:
        raise DomainAskError("gateway", "embedding provider returned no vectors")

    chunks = retrieve_domain_chunks(domain_id, emb_result.vectors[0], top_k)
    if not chunks:
        raise DomainAskError("empty_corpus", "ingest documents before asking")

    messages = build_ask_messages(q, chunks)
    try:
        completion = complete(
            CompletionRequest(model=gen_model, messages=messages, api_key=chat_key)
        )
    except GatewayError as e:
        raise DomainAskError("gateway", f"generation failed: {e}") from e

    wall_ms = int((time.perf_counter() - started) * 1000)
    latency_ms = int(completion.latency_ms) if completion.latency_ms else wall_ms
    cost_val: Decimal | None = None
    try:
        cost_val = Decimal(str(completion.cost_usd))
    except Exception:  # noqa: BLE001
        cost_val = None

    citations = citations_from_chunks(chunks)
    answer = completion.text or ""

    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise DomainAskError("not_found", "domain not found")
        user_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_USER,
            content=q,
            citations=None,
        )
        asst_row = DomainMessage(
            domain_id=domain_id,
            role=ROLE_ASSISTANT,
            content=answer,
            citations=citations,
            latency_ms=latency_ms,
            cost_usd=cost_val,
        )
        session.add(user_row)
        session.add(asst_row)
        session.flush()
        return {
            "answer": answer,
            "citations": citations,
            "message_id": str(asst_row.id),
            "user_message_id": str(user_row.id),
            "latency_ms": latency_ms,
            "cost_usd": float(cost_val) if cost_val is not None else None,
            "model": completion.model_used,
        }
```

If `NoCredentialError` does not expose `.provider`, inspect `credentials.py` and use the attribute or `str(e)` consistently with ingest — do not invent a different error shape.

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_ask_helpers.py tests/test_domain_ask_flow.py -q
git add backend/tvashtr/control_plane/domain_ask.py backend/tests/test_domain_ask_flow.py backend/tests/test_domain_ask_helpers.py
git commit -m "$(cat <<'EOF'
feat(domains): sync ask_domain embed/retrieve/complete/persist

EOF
)"
```

---

### Task 5: Ask + messages HTTP API

**Files:**
- Modify: `backend/tvashtr/routers.py`
- Test: `backend/tests/test_domain_ask_api.py`

**Interfaces:**
- Consumes: `ask_domain`, `list_domain_messages`, `DomainAskError`
- Produces:
  - `POST /api/domains/{domain_id}/ask` body `{ "question": str }` → `{ answer, citations, message_id, user_message_id, latency_ms, cost_usd?, model? }`
  - `GET /api/domains/{domain_id}/messages` → `{ messages: [...] }`
  - Map: `not_found`→404, `empty_corpus`/`no_model`/`missing_providers`/`bad_request`→422, `gateway`→502 (or 422 if prefer consistency — **use 502 for provider failures, 422 for preflight/empty**)

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_domain_ask_api.py`:

```python
"""Phase 3 — ask + messages API."""

import uuid
from unittest.mock import patch

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"askapi-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "ask-password"},
        ).status_code
        == 200
    )
    return c


def test_ask_foreign_domain_404(monkeypatch):
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()[
        "domain_id"
    ]
    monkeypatch.setattr(
        "tvashtr.routers.ask_domain",
        lambda *a, **k: (_ for _ in ()).throw(DomainAskError("not_found", "domain not found")),
    )
    # even without mock, ownership 404: prefer real path
    assert b.post(f"/api/domains/{did}/ask", json={"question": "hi"}).status_code == 404


def test_messages_foreign_domain_404():
    a = _fresh()
    b = _fresh()
    did = a.post("/api/domains", json={"template": "blank", "name": "Secret"}).json()[
        "domain_id"
    ]
    assert b.get(f"/api/domains/{did}/messages").status_code == 404


def test_ask_empty_corpus_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Empty"}).json()[
        "domain_id"
    ]
    monkeypatch.setattr(
        "tvashtr.routers.held_provider_slugs",
        lambda owner_id: {"openai"},
    )
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "What?"})
    assert resp.status_code == 422, resp.text
    blob = str(resp.json().get("detail", ""))
    assert "ingest" in blob.lower()


def test_ask_missing_keys_422(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Keys"}).json()[
        "domain_id"
    ]

    def _boom(*a, **k):
        raise DomainAskError(
            "missing_providers",
            {
                "message": "you have no API key for: openai — needed to embed...",
                "missing_providers": ["openai"],
            },
        )

    monkeypatch.setattr("tvashtr.routers.ask_domain", _boom)
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "What?"})
    assert resp.status_code == 422, resp.text


def test_ask_happy_path(monkeypatch):
    c = _fresh()
    did = c.post("/api/domains", json={"template": "support", "name": "Ok"}).json()[
        "domain_id"
    ]

    def _ok(owner_id, domain_id, question):
        return {
            "answer": "Hello cited",
            "citations": [
                {
                    "document_id": str(uuid.uuid4()),
                    "filename": "a.txt",
                    "chunk_id": str(uuid.uuid4()),
                    "ordinal": 0,
                    "excerpt": "Hello",
                    "score": 0.9,
                }
            ],
            "message_id": str(uuid.uuid4()),
            "user_message_id": str(uuid.uuid4()),
            "latency_ms": 42,
            "cost_usd": 0.001,
            "model": "openai/gpt-4o-mini",
        }

    monkeypatch.setattr("tvashtr.routers.ask_domain", _ok)
    resp = c.post(f"/api/domains/{did}/ask", json={"question": "Hi?"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["answer"] == "Hello cited"
    assert body["citations"][0]["filename"] == "a.txt"
    assert body["latency_ms"] == 42


def test_list_messages_empty():
    c = _fresh()
    did = c.post("/api/domains", json={"template": "blank", "name": "M"}).json()[
        "domain_id"
    ]
    resp = c.get(f"/api/domains/{did}/messages")
    assert resp.status_code == 200, resp.text
    assert resp.json()["messages"] == []
```

- [ ] **Step 2: Run fail**

Run: `cd backend && uv run pytest tests/test_domain_ask_api.py -q`

Expected: FAIL (routes missing / 404/405).

- [ ] **Step 3: Wire routes in `routers.py`**

Near other domain imports, add:

```python
from tvashtr.control_plane.domain_ask import (
    DomainAskError,
    ask_domain,
    list_domain_messages,
)
```

Add request model near other domain schemas (or inline):

```python
class DomainAskRequest(BaseModel):
    question: str
```

After `post_domain_ingest`, add:

```python
@router.post("/api/domains/{domain_id}/ask")
def post_domain_ask(
    domain_id: str,
    body: DomainAskRequest,
    current_user: Annotated[UserOut, Depends(get_current_user)],
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    # ownership probe first so foreign ids stay 404 even if ask would 422
    row = get_domain(owner_id, did)
    if row is None:
        raise HTTPException(status_code=404, detail="domain not found")
    try:
        return ask_domain(owner_id, did, body.question)
    except DomainAskError as e:
        if e.code == "not_found":
            raise HTTPException(status_code=404, detail="domain not found") from e
        if e.code == "gateway":
            raise HTTPException(status_code=502, detail=e.detail) from e
        raise HTTPException(status_code=422, detail=e.detail) from e


@router.get("/api/domains/{domain_id}/messages")
def get_domain_messages(
    domain_id: str, current_user: Annotated[UserOut, Depends(get_current_user)]
) -> dict:
    owner_id = uuid.UUID(current_user.id)
    did = _parse_domain_id(domain_id)
    msgs = list_domain_messages(owner_id, did)
    if msgs is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"messages": msgs}
```

- [ ] **Step 4: Run pass + commit**

```bash
cd backend && uv run pytest tests/test_domain_ask_api.py -q
git add backend/tvashtr/routers.py backend/tests/test_domain_ask_api.py
git commit -m "$(cat <<'EOF'
feat(api): domain ask + messages endpoints

EOF
)"
```

---

### Task 6: Frontend API client for ask + messages

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/domainMessages.test.ts`

**Interfaces:**
- Produces:
  - `DomainCitation`, `DomainMessageSummary`
  - `listDomainMessages(domainId: string): Promise<DomainMessageSummary[]>`
  - `askDomain(domainId: string, question: string): Promise<DomainAskResult>`

- [ ] **Step 1: Write failing client test**

Create `frontend/src/lib/domainMessages.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain messages client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainMessages hits GET messages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ messages: [] }), { status: 200 }),
    );
    const rows = await api.listDomainMessages("d1");
    expect(rows).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/messages");
  });

  it("askDomain posts question", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          answer: "Hi",
          citations: [],
          message_id: "m1",
          user_message_id: "m0",
          latency_ms: 10,
        }),
        { status: 200 },
      ),
    );
    const result = await api.askDomain("d1", "Hello?");
    expect(result.answer).toBe("Hi");
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/api/domains/d1/ask");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("Hello?");
  });
});
```

- [ ] **Step 2: Run fail**

Run: `cd frontend && npm test -- src/lib/domainMessages.test.ts`

Expected: FAIL (`listDomainMessages` / `askDomain` missing).

- [ ] **Step 3: Implement client**

Append to `frontend/src/lib/api.ts` after domain document helpers:

```typescript
export interface DomainCitation {
  document_id: string;
  filename: string;
  chunk_id: string;
  ordinal: number;
  excerpt: string;
  score?: number | null;
}

export interface DomainMessageSummary {
  message_id: string;
  domain_id: string;
  role: "user" | "assistant" | string;
  content: string;
  citations: DomainCitation[] | null;
  latency_ms: number | null;
  cost_usd: number | null;
  created_at: string | null;
}

export interface DomainAskResult {
  answer: string;
  citations: DomainCitation[];
  message_id: string;
  user_message_id: string;
  latency_ms: number | null;
  cost_usd?: number | null;
  model?: string;
}

export async function listDomainMessages(domainId: string): Promise<DomainMessageSummary[]> {
  const data = await getJSON<{ messages: DomainMessageSummary[] }>(
    `/api/domains/${domainId}/messages`,
  );
  return data.messages;
}

export async function askDomain(domainId: string, question: string): Promise<DomainAskResult> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/ask`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    let detail = `POST /api/domains/${domainId}/ask -> ${res.status}`;
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
  return (await res.json()) as DomainAskResult;
}
```

- [ ] **Step 4: Run pass + commit**

```bash
cd frontend && npm test -- src/lib/domainMessages.test.ts
git add frontend/src/lib/api.ts frontend/src/lib/domainMessages.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): domain ask + messages API client

EOF
)"
```

---

### Task 7: Chat tab UI on domain detail

**Files:**
- Modify: `frontend/src/components/DomainsPage.tsx`
- Modify: `frontend/src/components/DomainsPage.test.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: `listDomainMessages`, `askDomain` from Task 6
- Produces: detail tabs **Overview | Documents | Chat | Config**; Chat = message list + composer + citations under assistant bubbles; no streaming

- [ ] **Step 1: Write failing UI tests**

Update the `vi.mock("../lib/api", …)` block in `DomainsPage.test.tsx` to include:

```typescript
  listDomainMessages: vi.fn(),
  askDomain: vi.fn(),
```

Extend the typed mock object with `listDomainMessages` and `askDomain`. In `beforeEach`, default:

```typescript
    m.listDomainMessages.mockResolvedValue([]);
    m.askDomain.mockResolvedValue({
      answer: "Cited answer",
      citations: [
        {
          document_id: "doc1",
          filename: "faq.txt",
          chunk_id: "c1",
          ordinal: 0,
          excerpt: "Refunds take 5 days",
          score: 0.9,
        },
      ],
      message_id: "m1",
      user_message_id: "m0",
      latency_ms: 12,
    });
```

Add a new describe block:

```typescript
describe("DomainsPage Chat tab", () => {
  const detail = {
    domain_id: "d1",
    name: "Support docs",
    template: "support",
    config: {
      chunking: { strategy: "fixed", size: 600, overlap: 100 },
      embedding: { model: "text-embedding-3-small" },
      retrieval: { top_k: 8, mode: "dense" },
      generation: { model: null },
    },
    status: "ready",
    doc_count: 1,
    created_at: "2026-09-15T00:00:00Z",
    updated_at: "2026-09-15T00:00:00Z",
  };

  beforeEach(() => {
    m.listDomains.mockResolvedValue([
      {
        domain_id: "d1",
        name: "Support docs",
        template: "support",
        config: detail.config,
        status: "ready",
        doc_count: 1,
        created_at: detail.created_at,
        updated_at: detail.updated_at,
      },
    ]);
    m.getDomain.mockResolvedValue(detail);
    m.listDomainDocuments.mockResolvedValue([]);
    m.listDomainMessages.mockResolvedValue([
      {
        message_id: "u1",
        domain_id: "d1",
        role: "user",
        content: "How long for refunds?",
        citations: null,
        latency_ms: null,
        cost_usd: null,
        created_at: "2026-09-15T01:00:00Z",
      },
      {
        message_id: "a1",
        domain_id: "d1",
        role: "assistant",
        content: "About 5 business days.",
        citations: [
          {
            document_id: "doc1",
            filename: "faq.txt",
            chunk_id: "c1",
            ordinal: 0,
            excerpt: "Refunds take 5 business days.",
          },
        ],
        latency_ms: 40,
        cost_usd: null,
        created_at: "2026-09-15T01:00:01Z",
      },
    ]);
  });

  it("shows Chat tab and loads messages", async () => {
    const user = userEvent.setup();
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    const chatTab = await screen.findByRole("tab", { name: /^Chat$/i });
    await user.click(chatTab);
    await waitFor(() => expect(m.listDomainMessages).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/How long for refunds/i)).toBeTruthy();
    expect(screen.getByText(/About 5 business days/i)).toBeTruthy();
    expect(screen.getByText(/faq\.txt/i)).toBeTruthy();
  });

  it("sends a question via composer", async () => {
    const user = userEvent.setup();
    m.listDomainMessages.mockResolvedValue([]);
    render(<DomainsPage />);
    await user.click(await screen.findByRole("button", { name: /Support docs/i }));
    await user.click(await screen.findByRole("tab", { name: /^Chat$/i }));
    const input = await screen.findByLabelText(/Ask the domain/i);
    await user.type(input, "What is the refund policy?");
    await user.click(screen.getByRole("button", { name: /^Ask$/i }));
    await waitFor(() =>
      expect(m.askDomain).toHaveBeenCalledWith("d1", "What is the refund policy?"),
    );
  });
});
```

Also update Overview hint copy tests if they assert "Chat arrives in Phase 3" — change expectation to mention Chat is available / remove the Phase 3 teaser.

- [ ] **Step 2: Run fail**

Run: `cd frontend && npm test -- src/components/DomainsPage.test.tsx`

Expected: FAIL (no Chat tab).

- [ ] **Step 3: Implement Chat tab**

In `DomainsPage.tsx`:

1. Extend import from `../lib/api` with `askDomain`, `listDomainMessages`, and types `DomainMessageSummary`.
2. Change `type DetailTab = "overview" | "documents" | "chat" | "config";`
3. Add state:

```typescript
  const [messages, setMessages] = useState<DomainMessageSummary[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
```

4. When `selectedId` / `tab === "chat"`, load messages (same cancel pattern as documents):

```typescript
  useEffect(() => {
    if (!selectedId || tab !== "chat") return;
    let cancelled = false;
    listDomainMessages(selectedId)
      .then((rows) => {
        if (!cancelled) setMessages(rows);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, tab]);
```

5. Insert Chat tab button between Documents and Config:

```tsx
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chat"}
            className={`tv-domains__tab${tab === "chat" ? " tv-domains__tab--active" : ""}`}
            onClick={() => setTab("chat")}
          >
            Chat
          </button>
```

6. Add Chat panel (before Config):

```tsx
        {tab === "chat" && detail && (
          <section className="tv-domains__panel" aria-label="Chat">
            <div className="tv-domains__chat-log" role="log" aria-live="polite">
              {messages.length === 0 ? (
                <p className="tv-domains__hint">
                  Ask a question about ingested documents. Answers include citations.
                </p>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.message_id}
                    className={`tv-domains__chat-bubble tv-domains__chat-bubble--${m.role}`}
                  >
                    <div className="tv-domains__chat-role">{m.role}</div>
                    <div className="tv-domains__chat-content">{m.content}</div>
                    {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                      <ul className="tv-domains__citations">
                        {m.citations.map((c) => (
                          <li key={`${c.chunk_id}-${c.ordinal}`}>
                            <span className="tv-domains__cite-source">{c.filename}</span>
                            <span className="tv-domains__cite-excerpt">{c.excerpt}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {m.role === "assistant" && m.latency_ms != null && (
                      <div className="tv-domains__chat-meta">{m.latency_ms} ms</div>
                    )}
                  </div>
                ))
              )}
            </div>
            {chatError && <p className="tv-domains__docs-err">{chatError}</p>}
            <form
              className="tv-domains__chat-composer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!detail || !chatDraft.trim() || chatBusy) return;
                setChatBusy(true);
                setChatError(null);
                try {
                  await askDomain(detail.domain_id, chatDraft.trim());
                  setChatDraft("");
                  setMessages(await listDomainMessages(detail.domain_id));
                } catch (err) {
                  setChatError(err instanceof Error ? err.message : String(err));
                } finally {
                  setChatBusy(false);
                }
              }}
            >
              <label className="tv-domains__chat-label" htmlFor="domain-chat-input">
                Ask the domain
              </label>
              <textarea
                id="domain-chat-input"
                className="tv-domains__chat-input"
                rows={3}
                value={chatDraft}
                disabled={chatBusy}
                onChange={(ev) => setChatDraft(ev.target.value)}
              />
              <button type="submit" disabled={chatBusy || !chatDraft.trim()}>
                Ask
              </button>
            </form>
          </section>
        )}
```

7. Update Overview hint: remove "Chat arrives in Phase 3"; say chat is under Chat after ingest.

8. CSS in `frontend/src/index.css` under domains section:

```css
.tv-domains__chat-log {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-height: 28rem;
  overflow: auto;
  margin-bottom: 1rem;
}
.tv-domains__chat-bubble {
  border: 1px solid var(--tv-border, #333);
  border-radius: 8px;
  padding: 0.75rem;
}
.tv-domains__chat-bubble--user {
  background: rgba(255, 255, 255, 0.03);
}
.tv-domains__chat-bubble--assistant {
  background: rgba(80, 140, 255, 0.06);
}
.tv-domains__chat-role {
  font-size: 0.75rem;
  opacity: 0.7;
  text-transform: uppercase;
  margin-bottom: 0.25rem;
}
.tv-domains__citations {
  margin: 0.5rem 0 0;
  padding-left: 1rem;
  font-size: 0.85rem;
}
.tv-domains__cite-source {
  font-weight: 600;
  margin-right: 0.35rem;
}
.tv-domains__cite-excerpt {
  opacity: 0.85;
}
.tv-domains__chat-composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.tv-domains__chat-input {
  width: 100%;
  resize: vertical;
}
.tv-domains__chat-meta {
  font-size: 0.75rem;
  opacity: 0.6;
  margin-top: 0.35rem;
}
```

Citations: showing filename + excerpt satisfies "excerpt + source doc"; making filename a button that switches to Documents tab is optional nicety if cheap — not required for Phase 3.

- [ ] **Step 4: Run pass + commit**

```bash
cd frontend && npm test -- src/components/DomainsPage.test.tsx
git add frontend/src/components/DomainsPage.tsx frontend/src/components/DomainsPage.test.tsx frontend/src/index.css
git commit -m "$(cat <<'EOF'
feat(frontend): Domains Chat tab with citations

EOF
)"
```

---

### Task 8: Branch cut + regression gate

**Files:** none new (verification only)

- [ ] **Step 1: Create implementation branch from Phase 2 HEAD**

When starting implementation (not for this docs commit):

```bash
git checkout feat/polyrag-domains-phase2
git pull --ff-only  # if tracking
# confirm HEAD contains 034a36a ancestry
git checkout -b feat/polyrag-domains-phase3
```

- [ ] **Step 2: Backend regression**

```bash
cd backend && uv run pytest \
  tests/test_domain_messages_models.py \
  tests/test_domain_retrieve.py \
  tests/test_domain_ask_helpers.py \
  tests/test_domain_ask_flow.py \
  tests/test_domain_ask_api.py \
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
  src/lib/domainMessages.test.ts \
  src/lib/domainDocuments.test.ts \
  src/components/AppShell.test.tsx
```

Expected: PASS

- [ ] **Step 4: YAGNI grep (Phase 4+/5 must stay absent)**

```bash
rg -n "Query domain|domain_ask|QueryDomain|hybrid|rerank|EventSource|text/event-stream" \
  backend/tvashtr/control_plane/domain_ask.py \
  backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/routers.py \
  frontend/src/components/DomainsPage.tsx || true
```

Expected: no canvas Query-domain node, no MCP `domain_ask` tool wiring, no hybrid/rerank, no streaming.

Confirm Phase 3 surfaces **are** present:

```bash
rg -n "DomainMessage|/ask|/messages|role=\"tab\".*Chat|askDomain" \
  backend/tvashtr/models.py \
  backend/tvashtr/routers.py \
  frontend/src/components/DomainsPage.tsx \
  frontend/src/lib/api.ts
```

Expected: matches for ask/messages/DomainMessage/Chat.

- [ ] **Step 5: Final fixup commit only if needed**

```bash
git commit -m "$(cat <<'EOF'
test(domains): Phase 3 regression gate green

EOF
)"
```

---

## Self-review checklist (Phase 3 spec → tasks)

| Spec / locked decision | Task(s) |
|------------------------|---------|
| `POST /api/domains/{id}/ask` + `GET .../messages` | Task 5 (+ Task 4 flow) |
| `DomainMessage` (`domain_messages`): role, content, citations JSON, optional latency/cost | Task 1 + Task 4 |
| Migration `0035_domain_messages` revises `0034_...` | Task 1 |
| Dense cosine retrieve on ready chunks; `top_k` from config (default 8) | Task 2 + Task 4 |
| Sync HTTP ask (not DBOS); no streaming | Task 4 + Task 5 + Task 7 |
| Citations `{ document_id, filename, chunk_id, ordinal, excerpt, score? }` ~400 chars | Task 2 (`citations_from_chunks`) + Task 4 |
| Generation model: config → account thinker default → settings; else 422 | Task 3 |
| Embedding normalize = Phase 2 (`openai/text-embedding-3-small`) | Task 3/4 (`normalize_embedding_model`) |
| BYOK 422 for missing embed and/or chat keys | Task 3 + Task 5 |
| Owner-scoped; foreign → 404 | Task 5 tests |
| Empty corpus → 422 ingest documents before asking | Task 4 + Task 5 |
| Store `latency_ms` on assistant (+ cost if easy) | Task 1 columns + Task 4 |
| UI Chat tab: Overview \| Documents \| Chat \| Config; citations under bubbles | Task 7 |
| Branch `feat/polyrag-domains-phase3` from phase2 `034a36a` | Global Constraints + Task 8 |
| YAGNI: no Query-domain node, MCP, hybrid/rerank, streaming | Global Constraints + Task 8 grep |
| FE client + regression | Task 6 + Task 8 |

### Plan completeness notes

- **No TBDs** for ORM name, migration id, retrieve algorithm, citation shape, empty-corpus behavior, or branch base.
- **Ask is sync HTTP** deliberately (locked) — keep typical latency under ~30s; do not introduce DBOS for Phase 3.
- **Default generation model** mirrors teams via `account_default_model(held, "thinker")` then `settings.default_model`.
- **Phase 4+ deferred:** canvas Query-domain node and MCP tools wrap the same `/ask` later; do not stub them now.
