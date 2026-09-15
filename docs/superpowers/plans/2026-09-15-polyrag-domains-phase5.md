# PolyRAG Domains Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 5 only — hybrid lexical + dense retrieval (Postgres FTS + pgvector, fused with Reciprocal Rank Fusion) and rerank **knobs** in domain config + DomainConfigForm — by upgrading the **shared** retrieve path so Domain Chat, Canvas Query-domain, HTTP retrieve, and MCP `domain_ask` / `domain_retrieve` all pick it up automatically. **No GraphRAG, ColBERT, eval golden sets, or new MCP tools.**

**Architecture:** Add a generated stored `tsvector` (`text_tsv`) on `domain_chunks` plus a GIN index. Keep `retrieve_domain_chunks` as the dense cosine inner retriever. Add `retrieve_lexical_chunks` (`plainto_tsquery('english', query)` ranked by `ts_rank`) and a single dispatcher `retrieve_for_query` that selects dense / lexical / hybrid, fuses with RRF (`k=60`), optionally expands the candidate pool when `retrieval.rerank.enabled`, then cuts to `top_k`. `ask_domain` and `retrieve_domain` call **only** `retrieve_for_query` (skip query embedding when mode is `lexical`). Config `retrieval.mode` is `dense` | `lexical` | `hybrid` with default still **`dense`**. Rerank v1 is knobs + candidate expansion + a passthrough hook — no paid rerank provider.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic + Postgres FTS (`tsvector` / `ts_rank`) + pgvector + pytest (backend); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop). Reuse `retrieve_domain_chunks`, `citations_from_chunks`, `ask_domain`, `retrieve_domain`, `validate_domain_config`, `default_config_for_template`, `DomainConfigForm`.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 5 only** (Hybrid lexical + dense retrieval, rerank knobs in config/UI).
- **Branch base:** Implement on `feat/polyrag-domains-phase5` created from `feat/polyrag-domains-phase4b` tip `bdb4aed`. Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — Desktop continues same-origin `/api` proxy to Fly; no Desktop-only retrieve backend.
- **Shared retrieve path (locked):** Chat (`ask_domain`), Query-domain node (`ask_domain`), HTTP `POST /retrieve` (`retrieve_domain`), MCP `domain_ask` / `domain_retrieve` (same helpers) must all flow through **`retrieve_for_query`**. Do **not** add a second RAG loop or new MCP tools.
- **Lexical (locked):** Postgres FTS. Alembic `0036_domain_chunks_fts` revises `0035_domain_messages`. Generated stored column `domain_chunks.text_tsv` = `to_tsvector('english', coalesce(text, ''))` + GIN index. Query with `plainto_tsquery('english', query)` ranked by `ts_rank`. Filter ready documents (`DomainDocument.ingest_status == "ready"`), same as dense. Do **not** require a non-null embedding for lexical hits.
- **Hybrid fusion (locked):** Reciprocal Rank Fusion over the dense ranked list and the lexical ranked list. `RRF_K = 60`. Fused `score` is the RRF sum. `retrieval.mode`: **`dense` | `lexical` | `hybrid`**. Default stays **`dense`** for existing domains and `default_config_for_template`.
- **Rerank v1 (locked — YAGNI):** optional `retrieval.rerank` object `{ enabled: bool, model: string | null, top_n: int }`. Defaults `{ enabled: false, model: null, top_n: 20 }`. When `enabled`, expand each retriever's fetch to `candidate_k = max(top_k, top_n)` then cut to `top_k` after fusion + `apply_rerank`. **`apply_rerank` is identity/passthrough** (including when `model` is non-null) — there is no cheap first-party rerank API in this repo; do not add a paid provider, cross-encoder, or LiteLLM rerank call. `model` is a reserved knob for a future hook. Do **not** put `rerank` at the config top level (existing PATCH test rejects top-level `rerank`).
- **Config (locked):** extend `default_config_for_template` retrieval block with `mode` + `rerank`. `validate_domain_config` on PATCH: `retrieval.mode` if present must be the enum; `retrieval.rerank` if present must be an object with `enabled` bool, `model` string|null, `top_n` int >= 1. Missing `mode` / missing `rerank` remain valid (coerce at retrieve time) so existing domains keep working.
- **Embed / BYOK (locked):** `dense` and `hybrid` still embed the query (same BYOK as today). **`lexical` skips query embedding** and the embed-provider check. `ask_domain` still requires a generation model + chat BYOK in every mode.
- **UI (locked):** `DomainConfigForm` (shared React) — retrieval mode **`<select>`** with options dense / lexical / hybrid (replace the current free-text input + "Phase 1: dense only" hint). Rerank: enabled checkbox, top_n number, optional model text. Hint must say v1 expands the candidate pool and does not call a paid reranker.
- **Citations (locked):** unchanged Phase 3 shape `{ document_id, filename, chunk_id, ordinal, excerpt, score? }`. After hybrid, `score` is the RRF sum (or ts_rank for lexical-only, cosine similarity for dense-only).
- YAGNI: **no** GraphRAG, **no** ColBERT, **no** eval golden sets (phase 6), **no** new MCP tools, **no** Domain Chat retrieve tab, **no** streaming, **no** new canvas node fields, **no** ingest rewrite (generated `text_tsv` backfills from `text`).
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`); **never** `git config`.

---

## Rerank v1 — what ships vs what does not

There is **no** LiteLLM/Cohere/Jina rerank call in this repo today. Phase 5 therefore ships:

| Knob | Effect in v1 |
|------|----------------|
| `retrieval.rerank.enabled = false` (default) | Fetch `top_k` from the active retriever(s); no extra pool. |
| `retrieval.rerank.enabled = true` | Fetch `candidate_k = max(top_k, top_n)` from each active retriever, fuse (if hybrid), **passthrough** `apply_rerank`, slice to `top_k`. |
| `retrieval.rerank.model` | Stored on the domain; **ignored at runtime** in v1 (hook argument only). Empty / `null` is the normal state. |
| `apply_rerank(chunks, query, rerank) -> list[dict]` | Pluggable function; v1 body is `return chunks`. Future phase may call a provider when `model` is set. |

Do **not** implement a score-blend substitute beyond RRF (RRF already is the fusion). Do **not** download a cross-encoder.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `backend/alembic/versions/0036_domain_chunks_fts.py` | Generated stored `text_tsv` + GIN index; `down_revision = 0035_domain_messages`. |
| **Modify** `backend/tvashtr/models.py` | Map `DomainChunk.text_tsv` as `TSVECTOR` + `Computed(..., persisted=True)`. |
| **Modify** `backend/tvashtr/control_plane/domain_retrieve.py` | Keep dense `retrieve_domain_chunks`. Add coerce helpers, `rrf_fuse`, `apply_rerank`, `retrieve_lexical_chunks`, dispatcher `retrieve_for_query`. |
| **Create** `backend/tests/test_domain_retrieve_fusion.py` | Unit tests for mode/rerank coerce, RRF, candidate_k, passthrough rerank, dispatcher (mocked inners). |
| **Create** `backend/tests/test_domain_retrieve_lexical.py` | Postgres FTS integration: keyword chunk ranks above a distractor. |
| **Modify** `backend/tvashtr/control_plane/domains.py` | Default retrieval block includes `rerank`; validate mode enum + rerank object on PATCH. |
| **Modify** `backend/tvashtr/control_plane/domain_ask.py` | `ask_domain` + `retrieve_domain` call `retrieve_for_query`; skip embed when mode is `lexical`. |
| **Modify** `backend/tests/test_domain_retrieve_helper.py` | Patch `retrieve_for_query`; add lexical-skips-embed case. |
| **Modify** `backend/tests/test_domains_helpers.py` / `test_domains_api.py` | Defaults include rerank; PATCH hybrid OK; invalid mode 422; top-level `rerank` still 422. |
| **Modify** `frontend/src/lib/domains.ts` | `retrieval.mode` union + optional `rerank` on `DomainConfig`. |
| **Modify** `frontend/src/components/DomainConfigForm.tsx` | Mode `<select>` dense/lexical/hybrid; rerank checkbox + top_n + model. |
| **Modify** `frontend/src/components/DomainConfigForm.test.tsx` | Mode select + rerank knobs save. |

**Out of scope (do not create for Phase 5):** GraphRAG, ColBERT, eval golden sets, new MCP tools, canvas node changes, ingest rewrite, LiteLLM rerank HTTP client, top-level `config.rerank`.

---

### Task 1: Generated `text_tsv` + GIN index (Alembic 0036 + ORM)

**Files:**
- Create: `backend/alembic/versions/0036_domain_chunks_fts.py`
- Modify: `backend/tvashtr/models.py` (`DomainChunk` after `text`; imports)
- Test: `backend/tests/test_domain_documents_models.py` (extend)

**Interfaces:**
- Consumes: Alembic head `0035_domain_messages`; `DomainChunk.text`
- Produces: table column `domain_chunks.text_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED`; index `ix_domain_chunks_text_tsv` USING GIN; ORM `DomainChunk.text_tsv`

- [ ] **Step 1: Write the failing ORM smoke**

Append to `backend/tests/test_domain_documents_models.py`:

```python
def test_domain_chunk_has_text_tsv():
    from sqlalchemy.dialects.postgresql import TSVECTOR

    assert "text_tsv" in DomainChunk.__table__.c
    col = DomainChunk.__table__.c.text_tsv
    assert isinstance(col.type, TSVECTOR)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_documents_models.py::test_domain_chunk_has_text_tsv -q`

Expected: FAIL (`text_tsv` missing).

- [ ] **Step 3: Add ORM column + migration**

In `backend/tvashtr/models.py` imports, add `Computed` to the sqlalchemy import list and:

```python
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
```

On `DomainChunk`, immediately after `text`:

```python
    text: Mapped[str] = mapped_column(Text, nullable=False)
    text_tsv: Mapped[object | None] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('english', coalesce(text, ''))", persisted=True),
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
```

SQLAlchemy `Computed(persisted=True)` must be omitted from INSERT (ingest keeps writing `text` only; Postgres fills `text_tsv`).

Create `backend/alembic/versions/0036_domain_chunks_fts.py`:

```python
"""domain_chunks FTS tsvector — PolyRAG Phase 5 hybrid retrieval

Revision ID: 0036_domain_chunks_fts
Revises: 0035_domain_messages
Create Date: 2026-09-15
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0036_domain_chunks_fts"
down_revision: str | None = "0035_domain_messages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE domain_chunks
          ADD COLUMN text_tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
        """
    )
    op.execute(
        "CREATE INDEX ix_domain_chunks_text_tsv ON domain_chunks USING GIN (text_tsv)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_domain_chunks_text_tsv")
    op.execute("ALTER TABLE domain_chunks DROP COLUMN IF EXISTS text_tsv")
```

Apply: `cd backend && uv run alembic upgrade head`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_documents_models.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0036_domain_chunks_fts.py \
  backend/tvashtr/models.py \
  backend/tests/test_domain_documents_models.py
git commit -m "$(cat <<'EOF'
feat(domains): generated tsvector + GIN index on domain_chunks

EOF
)"
```

---

### Task 2: Retrieval knobs + RRF + passthrough rerank (pure)

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_retrieve.py`
- Test: `backend/tests/test_domain_retrieve_fusion.py`

**Interfaces:**
- Consumes: domain `config` dict shape (`retrieval.mode`, `retrieval.rerank`, `retrieval.top_k`)
- Produces:
  - `RETRIEVAL_MODES = ("dense", "lexical", "hybrid")`
  - `DEFAULT_RETRIEVAL_MODE = "dense"`
  - `RRF_K = 60`
  - `DEFAULT_RERANK = {"enabled": False, "model": None, "top_n": 20}`
  - `coerce_retrieval_mode(config: dict | None, default: str = DEFAULT_RETRIEVAL_MODE) -> str`
  - `coerce_rerank_config(config: dict | None) -> dict` returning `{enabled: bool, model: str | None, top_n: int}`
  - `candidate_k(top_k: int, rerank: dict) -> int` = `top_k` if not enabled else `max(top_k, top_n)`
  - `rrf_fuse(ranked_lists: list[list[dict]], k: int = RRF_K) -> list[dict]` — merge by `chunk_id`; `score` becomes RRF sum; first-seen chunk fields win; descending score
  - `apply_rerank(chunks: list[dict], query: str, rerank: dict) -> list[dict]` — v1 **identity**

- [ ] **Step 1: Write the failing helper tests**

Create `backend/tests/test_domain_retrieve_fusion.py`:

```python
"""Phase 5 — retrieval knobs, RRF fusion, rerank passthrough."""

from tvashtr.control_plane.domain_retrieve import (
    DEFAULT_RETRIEVAL_MODE,
    RRF_K,
    apply_rerank,
    candidate_k,
    coerce_rerank_config,
    coerce_retrieval_mode,
    rrf_fuse,
)


def test_coerce_retrieval_mode_defaults_and_enum():
    assert coerce_retrieval_mode(None) == "dense"
    assert coerce_retrieval_mode({}) == "dense"
    assert coerce_retrieval_mode({"retrieval": {"mode": "hybrid"}}) == "hybrid"
    assert coerce_retrieval_mode({"retrieval": {"mode": "LEXICAL"}}) == "lexical"
    assert coerce_retrieval_mode({"retrieval": {"mode": "colbert"}}) == DEFAULT_RETRIEVAL_MODE
    assert coerce_retrieval_mode({"retrieval": "nope"}) == "dense"


def test_coerce_rerank_config_defaults():
    out = coerce_rerank_config(None)
    assert out == {"enabled": False, "model": None, "top_n": 20}
    out2 = coerce_rerank_config(
        {"retrieval": {"rerank": {"enabled": True, "model": "cohere/rerank", "top_n": 12}}}
    )
    assert out2 == {"enabled": True, "model": "cohere/rerank", "top_n": 12}
    out3 = coerce_rerank_config({"retrieval": {"rerank": {"enabled": True, "top_n": 0}}})
    assert out3["enabled"] is True
    assert out3["top_n"] == 20  # invalid top_n falls back


def test_candidate_k_expands_only_when_enabled():
    assert candidate_k(8, {"enabled": False, "top_n": 20}) == 8
    assert candidate_k(8, {"enabled": True, "top_n": 20}) == 20
    assert candidate_k(8, {"enabled": True, "top_n": 4}) == 8
    assert candidate_k(8, {"enabled": True, "top_n": 8}) == 8


def test_rrf_prefers_items_in_both_lists():
    assert RRF_K == 60
    dense = [
        {"chunk_id": "x", "text": "x", "filename": "a.md", "score": 0.9},
        {"chunk_id": "y", "text": "y", "filename": "a.md", "score": 0.8},
    ]
    lexical = [
        {"chunk_id": "y", "text": "y", "filename": "a.md", "score": 0.7},
        {"chunk_id": "z", "text": "z", "filename": "b.md", "score": 0.6},
    ]
    fused = rrf_fuse([dense, lexical])
    ids = [c["chunk_id"] for c in fused]
    assert ids[0] == "y"
    assert set(ids) == {"x", "y", "z"}
    assert fused[0]["score"] > fused[1]["score"]
    assert fused[0]["text"] == "y"


def test_rrf_single_list_preserves_order():
    only = [
        {"chunk_id": "a", "text": "a", "score": 0.5},
        {"chunk_id": "b", "text": "b", "score": 0.4},
    ]
    fused = rrf_fuse([only])
    assert [c["chunk_id"] for c in fused] == ["a", "b"]


def test_apply_rerank_is_passthrough_even_with_model():
    chunks = [
        {"chunk_id": "a", "text": "a", "score": 1.0},
        {"chunk_id": "b", "text": "b", "score": 0.5},
    ]
    out = apply_rerank(
        chunks,
        "query",
        {"enabled": True, "model": "some-rerank-model", "top_n": 20},
    )
    assert out is chunks or [c["chunk_id"] for c in out] == ["a", "b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_fusion.py -q`

Expected: FAIL (symbols missing).

- [ ] **Step 3: Implement helpers in `domain_retrieve.py`**

Append (keep existing `retrieve_domain_chunks` / `citations_from_chunks` unchanged):

```python
RETRIEVAL_MODES = ("dense", "lexical", "hybrid")
DEFAULT_RETRIEVAL_MODE = "dense"
RRF_K = 60
DEFAULT_RERANK: dict = {"enabled": False, "model": None, "top_n": 20}


def coerce_retrieval_mode(
    config: dict | None, default: str = DEFAULT_RETRIEVAL_MODE
) -> str:
    raw = (config or {}).get("retrieval") or {}
    if not isinstance(raw, dict):
        return default
    mode = str(raw.get("mode") or default).strip().lower()
    return mode if mode in RETRIEVAL_MODES else default


def coerce_rerank_config(config: dict | None) -> dict:
    raw = (config or {}).get("retrieval") or {}
    block = raw.get("rerank") if isinstance(raw, dict) else None
    enabled = False
    model = None
    top_n = 20
    if isinstance(block, dict):
        enabled = bool(block.get("enabled"))
        m = block.get("model")
        if isinstance(m, str) and m.strip():
            model = m.strip()
        else:
            model = None
        try:
            n = int(block.get("top_n", 20))
            if n >= 1:
                top_n = n
        except (TypeError, ValueError):
            pass
    return {"enabled": enabled, "model": model, "top_n": top_n}


def candidate_k(top_k: int, rerank: dict) -> int:
    try:
        k = int(top_k)
    except (TypeError, ValueError):
        k = 8
    k = max(1, k)
    if not rerank or not rerank.get("enabled"):
        return k
    try:
        n = int(rerank.get("top_n") or k)
    except (TypeError, ValueError):
        n = k
    return max(k, max(1, n))


def rrf_fuse(ranked_lists: list[list[dict]], k: int = RRF_K) -> list[dict]:
    """Reciprocal Rank Fusion. First-seen chunk fields win; score := RRF sum."""
    k = k if isinstance(k, int) and k >= 1 else RRF_K
    scores: dict[str, float] = {}
    by_id: dict[str, dict] = {}
    for ranked in ranked_lists:
        if not ranked:
            continue
        for rank, item in enumerate(ranked, start=1):
            cid = str(item.get("chunk_id") or "")
            if not cid:
                continue
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank)
            if cid not in by_id:
                by_id[cid] = dict(item)
    fused = []
    for cid, sc in scores.items():
        row = dict(by_id[cid])
        row["score"] = sc
        fused.append(row)
    fused.sort(key=lambda r: float(r.get("score") or 0.0), reverse=True)
    return fused


def apply_rerank(chunks: list[dict], query: str, rerank: dict) -> list[dict]:
    """v1 passthrough. Reserved hook: a future LiteLLM rerank may use rerank['model'].

    Today no first-party rerank API exists in-repo — always return chunks unchanged
    (caller already expanded candidate_k when enabled).
    """
    return chunks
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_fusion.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tests/test_domain_retrieve_fusion.py
git commit -m "$(cat <<'EOF'
feat(domains): RRF fusion helpers and rerank knobs coerce

EOF
)"
```

---

### Task 3: Lexical FTS retrieve

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_retrieve.py`
- Test: `backend/tests/test_domain_retrieve_lexical.py`

**Interfaces:**
- Consumes: `DomainChunk.text_tsv`, `plainto_tsquery('english', query)`, `ts_rank`, ready-document join (same as dense)
- Produces: `retrieve_lexical_chunks(domain_id: uuid.UUID, query: str, top_k: int) -> list[dict]` with the same keys as dense (`chunk_id`, `document_id`, `filename`, `ordinal`, `text`, `score`) where `score` is `ts_rank`

- [ ] **Step 1: Write the failing lexical integration test**

Create `backend/tests/test_domain_retrieve_lexical.py`:

```python
"""Phase 5 — Postgres FTS lexical retrieve over ready chunks."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.control_plane.domain_retrieve import retrieve_lexical_chunks
from tvashtr.db import session_scope
from tvashtr.main import app
from tvashtr.models import Domain, DomainChunk, DomainDocument


def _register_domain() -> tuple[uuid.UUID, uuid.UUID]:
    c = TestClient(app)
    c.cookies.clear()
    email = f"fts-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post("/api/auth/register", json={"email": email, "password": "fts-password"}).status_code
        == 200
    )
    did = uuid.UUID(
        c.post("/api/domains", json={"template": "support", "name": "FTS"}).json()["domain_id"]
    )
    with session_scope() as session:
        domain = session.get(Domain, did)
        assert domain is not None
        return domain.owner_id, did


def test_lexical_ranks_keyword_chunk_first():
    _owner, did = _register_domain()
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="mix.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/mix.txt",
            byte_size=40,
            ingest_status="ready",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="Refunds take thirty business days to process.",
                embedding=[0.0] * 1536,
            )
        )
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=1,
                text="The SLA guarantees 99.9 percent uptime every month.",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()

    hits = retrieve_lexical_chunks(did, "SLA uptime", 5)
    assert hits, "expected FTS hits for SLA uptime"
    assert "SLA" in hits[0]["text"] or "uptime" in hits[0]["text"].lower()
    assert hits[0]["filename"] == "mix.txt"
    assert hits[0]["score"] is not None


def test_lexical_ignores_non_ready_documents():
    _owner, did = _register_domain()
    with session_scope() as session:
        doc = DomainDocument(
            domain_id=did,
            filename="pending.txt",
            content_type="text/plain",
            storage_path=f"x/{did}/d/pending.txt",
            byte_size=10,
            ingest_status="pending",
        )
        session.add(doc)
        session.flush()
        session.add(
            DomainChunk(
                domain_id=did,
                document_id=doc.id,
                ordinal=0,
                text="SLA secret pending document",
                embedding=[0.0] * 1536,
            )
        )
        session.flush()
    assert retrieve_lexical_chunks(did, "SLA secret", 5) == []


def test_lexical_top_k_coerce_bad_values(monkeypatch):
    class FakeSession:
        def execute(self, stmt):
            class R:
                def all(self):
                    return []

            return R()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(
        "tvashtr.control_plane.domain_retrieve.session_scope",
        lambda: FakeSession(),
    )
    assert retrieve_lexical_chunks(uuid.uuid4(), "q", "oops") == []  # type: ignore[arg-type]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_lexical.py -q`

Expected: FAIL (`retrieve_lexical_chunks` missing). Ensure `0036` is applied (`uv run alembic upgrade head`) before re-running after implement.

- [ ] **Step 3: Implement `retrieve_lexical_chunks`**

In `domain_retrieve.py` add `func` to the sqlalchemy import (`from sqlalchemy import func, select`). Then:

```python
def retrieve_lexical_chunks(
    domain_id: uuid.UUID, query: str, top_k: int
) -> list[dict]:
    """Return up to ``top_k`` ready chunks ranked by ``ts_rank`` descending.

    Uses ``plainto_tsquery('english', query)`` against generated ``text_tsv``.
    Does not require a non-null embedding.
    """
    try:
        k = int(top_k) if top_k is not None else 8
    except (TypeError, ValueError):
        k = 8
    k = max(1, k)
    q = (query or "").strip()
    if not q:
        return []
    tsq = func.plainto_tsquery("english", q)
    rank = func.ts_rank(DomainChunk.text_tsv, tsq)
    with session_scope() as session:
        stmt = (
            select(DomainChunk, DomainDocument.filename, rank.label("rank"))
            .join(DomainDocument, DomainDocument.id == DomainChunk.document_id)
            .where(
                DomainChunk.domain_id == domain_id,
                DomainDocument.ingest_status == "ready",
                DomainChunk.text_tsv.op("@@")(tsq),
            )
            .order_by(rank.desc())
            .limit(k)
        )
        rows = session.execute(stmt).all()
        out: list[dict] = []
        for chunk, filename, raw_rank in rows:
            score = None
            if raw_rank is not None:
                try:
                    score = float(raw_rank)
                    if not math.isfinite(score):
                        score = None
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_lexical.py tests/test_domain_retrieve.py -q`

Expected: PASS (existing dense tests still green).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tests/test_domain_retrieve_lexical.py
git commit -m "$(cat <<'EOF'
feat(domains): lexical FTS retrieve via plainto_tsquery + ts_rank

EOF
)"
```

---

### Task 4: Shared dispatcher `retrieve_for_query`

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_retrieve.py`
- Test: `backend/tests/test_domain_retrieve_fusion.py` (extend)

**Interfaces:**
- Consumes: `retrieve_domain_chunks`, `retrieve_lexical_chunks`, `rrf_fuse`, `apply_rerank`, `candidate_k`
- Produces: `retrieve_for_query(domain_id, query, *, query_embedding, top_k, mode="dense", rerank=None) -> list[dict]`
  - `mode=dense` → dense only (embedding required; empty list if embedding is None)
  - `mode=lexical` → lexical only (embedding ignored)
  - `mode=hybrid` → both lists, `rrf_fuse`
  - `rerank.enabled` → fetch `candidate_k`, then `apply_rerank`, then `[:top_k]`
  - unknown mode → treat as `dense`

This is the function `ask_domain` / `retrieve_domain` will call in Task 6.

- [ ] **Step 1: Write the failing dispatcher tests**

Append to `backend/tests/test_domain_retrieve_fusion.py`:

```python
import uuid
from unittest.mock import patch

from tvashtr.control_plane.domain_retrieve import retrieve_for_query


def _chunk(cid: str, text: str, score: float = 0.5) -> dict:
    return {
        "chunk_id": cid,
        "document_id": "d",
        "filename": "a.md",
        "ordinal": 0,
        "text": text,
        "score": score,
    }


def test_retrieve_for_query_dense_does_not_call_lexical():
    did = uuid.uuid4()
    dense_hits = [_chunk("a", "alpha", 0.9)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=dense_hits,
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=[],
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1, 0.2],
            top_k=3,
            mode="dense",
        )
    assert out == dense_hits
    dense.assert_called_once()
    lex.assert_not_called()
    assert dense.call_args.args[2] == 3


def test_retrieve_for_query_lexical_skips_dense():
    did = uuid.uuid4()
    lex_hits = [_chunk("b", "bravo", 0.4)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=[_chunk("a", "nope")],
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=lex_hits,
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=None,
            top_k=4,
            mode="lexical",
        )
    assert out == lex_hits
    lex.assert_called_once()
    dense.assert_not_called()


def test_retrieve_for_query_hybrid_rrf_and_rerank_expands_pool():
    did = uuid.uuid4()
    dense_hits = [_chunk("x", "x", 0.9), _chunk("y", "y", 0.8)]
    lex_hits = [_chunk("y", "y", 0.7), _chunk("z", "z", 0.6)]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=dense_hits,
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
        return_value=lex_hits,
    ) as lex:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.0],
            top_k=2,
            mode="hybrid",
            rerank={"enabled": True, "model": None, "top_n": 10},
        )
    assert dense.call_args.args[2] == 10
    assert lex.call_args.args[2] == 10
    assert [c["chunk_id"] for c in out][0] == "y"
    assert len(out) == 2


def test_retrieve_for_query_unknown_mode_is_dense():
    did = uuid.uuid4()
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=[_chunk("a", "a")],
    ) as dense, patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_lexical_chunks",
    ) as lex:
        retrieve_for_query(
            did, "q", query_embedding=[0.0], top_k=1, mode="colbert"
        )
    dense.assert_called_once()
    lex.assert_not_called()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_fusion.py -q`

Expected: FAIL (`retrieve_for_query` missing).

- [ ] **Step 3: Implement `retrieve_for_query`**

```python
def retrieve_for_query(
    domain_id: uuid.UUID,
    query: str,
    *,
    query_embedding: list[float] | None,
    top_k: int,
    mode: str = DEFAULT_RETRIEVAL_MODE,
    rerank: dict | None = None,
) -> list[dict]:
    """Shared retrieve path for Chat / Query node / HTTP retrieve / MCP.

    dense | lexical | hybrid (RRF). When rerank.enabled, fetch candidate_k then
    passthrough-rerank and slice to top_k.
    """
    try:
        k_final = int(top_k) if top_k is not None else 8
    except (TypeError, ValueError):
        k_final = 8
    k_final = max(1, k_final)
    mode_n = str(mode or DEFAULT_RETRIEVAL_MODE).strip().lower()
    if mode_n not in RETRIEVAL_MODES:
        mode_n = DEFAULT_RETRIEVAL_MODE
    rr = rerank if isinstance(rerank, dict) else {}
    rr = {
        "enabled": bool(rr.get("enabled")),
        "model": rr.get("model") if isinstance(rr.get("model"), str) else None,
        "top_n": rr.get("top_n", 20),
    }
    k_cand = candidate_k(k_final, rr)
    lists: list[list[dict]] = []
    if mode_n in ("dense", "hybrid"):
        if query_embedding is None:
            dense_hits: list[dict] = []
        else:
            dense_hits = retrieve_domain_chunks(domain_id, query_embedding, k_cand)
        if mode_n == "dense":
            lists = [dense_hits]
        else:
            lists.append(dense_hits)
    if mode_n in ("lexical", "hybrid"):
        lists.append(retrieve_lexical_chunks(domain_id, query, k_cand))
    if mode_n == "hybrid":
        fused = rrf_fuse(lists)
    elif lists:
        fused = lists[0]
    else:
        fused = []
    fused = apply_rerank(fused, query, rr)
    return fused[:k_final]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_fusion.py tests/test_domain_retrieve.py tests/test_domain_retrieve_lexical.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tests/test_domain_retrieve_fusion.py
git commit -m "$(cat <<'EOF'
feat(domains): retrieve_for_query dispatcher for dense/lexical/hybrid

EOF
)"
```

---

### Task 5: Config defaults + PATCH validation

**Files:**
- Modify: `backend/tvashtr/control_plane/domains.py`
- Test: `backend/tests/test_domains_helpers.py`, `backend/tests/test_domains_api.py`

**Interfaces:**
- Consumes: existing `validate_domain_config` (top-level keys still exactly `chunking` / `embedding` / `retrieval` / `generation`)
- Produces: `default_config_for_template` retrieval =

```python
{"top_k": 8, "mode": "dense", "rerank": {"enabled": False, "model": None, "top_n": 20}}
```

Validation additions inside `validate_domain_config` after the section-is-dict loop:

- `retrieval.mode` if present (not None / not "") must be `dense` | `lexical` | `hybrid` (case-sensitive lowercase as stored; reject unknown)
- `retrieval.rerank` if present must be a dict; allowed keys `enabled`, `model`, `top_n`; `enabled` bool if present; `model` str or None; `top_n` int >= 1 if present
- Top-level `rerank` remains an **unknown top-level key** → 422 (do not move rerank out of `retrieval`)

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_domains_helpers.py`:

```python
def test_default_config_includes_rerank_knobs():
    cfg = domains_cp.default_config_for_template("blank")
    assert cfg["retrieval"]["mode"] == "dense"
    assert cfg["retrieval"]["rerank"] == {
        "enabled": False,
        "model": None,
        "top_n": 20,
    }


def test_validate_rejects_unknown_retrieval_mode():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["retrieval"]["mode"] = "colbert"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "mode" in str(e).lower()


def test_validate_accepts_hybrid_and_rerank():
    cfg = domains_cp.default_config_for_template("legal")
    cfg["retrieval"]["mode"] = "hybrid"
    cfg["retrieval"]["rerank"] = {"enabled": True, "model": None, "top_n": 16}
    domains_cp.validate_domain_config(cfg)


def test_validate_rejects_bad_rerank():
    cfg = domains_cp.default_config_for_template("blank")
    cfg["retrieval"]["rerank"] = "yes"
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
    cfg["retrieval"]["rerank"] = {"enabled": True, "top_n": 0}
    try:
        domains_cp.validate_domain_config(cfg)
        raise AssertionError("expected ValueError")
    except ValueError:
        pass
```

Append to `backend/tests/test_domains_api.py`:

```python
def test_patch_accepts_hybrid_mode_and_rerank():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "Hyb"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {
        "top_k": 6,
        "mode": "hybrid",
        "rerank": {"enabled": True, "model": None, "top_n": 16},
    }
    patched = c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg})
    assert patched.status_code == 200, patched.text
    ret = patched.json()["config"]["retrieval"]
    assert ret["mode"] == "hybrid"
    assert ret["rerank"]["enabled"] is True
    assert ret["rerank"]["top_n"] == 16


def test_patch_rejects_unknown_retrieval_mode():
    c = _fresh()
    row = c.post("/api/domains", json={"template": "blank", "name": "BadMode"}).json()
    cfg = dict(row["config"])
    cfg["retrieval"] = {"top_k": 8, "mode": "colbert"}
    assert c.patch(f"/api/domains/{row['domain_id']}", json={"config": cfg}).status_code == 422
```

Keep `test_patch_rejects_invalid_v1_config_shape` as-is (top-level `"rerank"` still 422).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py -q`

Expected: FAIL on missing rerank defaults / mode still accepted.

- [ ] **Step 3: Implement defaults + validation**

In `default_config_for_template`, change the retrieval line to:

```python
        "retrieval": {
            "top_k": 8,
            "mode": "dense",
            "rerank": {"enabled": False, "model": None, "top_n": 20},
        },
```

At the bottom of `validate_domain_config`, after the section-is-dict loop and `_reject_secret_keys`:

```python
    retrieval = config["retrieval"]
    mode = retrieval.get("mode")
    if mode is not None and str(mode).strip() != "":
        if str(mode).strip().lower() not in {"dense", "lexical", "hybrid"}:
            raise ValueError(
                "domain config.retrieval.mode must be dense, lexical, or hybrid"
            )
    rerank = retrieval.get("rerank")
    if rerank is not None:
        if not isinstance(rerank, dict):
            raise ValueError("domain config.retrieval.rerank must be an object")
        extra = set(rerank) - {"enabled", "model", "top_n"}
        if extra:
            raise ValueError(
                f"domain config.retrieval.rerank has unknown keys: {sorted(extra)}"
            )
        if "enabled" in rerank and not isinstance(rerank["enabled"], bool):
            raise ValueError("domain config.retrieval.rerank.enabled must be a boolean")
        if "model" in rerank and rerank["model"] is not None and not isinstance(
            rerank["model"], str
        ):
            raise ValueError(
                "domain config.retrieval.rerank.model must be a string or null"
            )
        if "top_n" in rerank:
            try:
                n = int(rerank["top_n"])
            except (TypeError, ValueError) as e:
                raise ValueError(
                    "domain config.retrieval.rerank.top_n must be an integer >= 1"
                ) from e
            if n < 1:
                raise ValueError(
                    "domain config.retrieval.rerank.top_n must be an integer >= 1"
                )
```

Store mode as submitted; the form will send lowercase enum values. Reject mixed-case unknown strings via `.lower()` membership so `"HYBRID"` is accepted by validation if someone PATCHes it; retrieve-time `coerce_retrieval_mode` already lowercases.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domains.py \
  backend/tests/test_domains_helpers.py \
  backend/tests/test_domains_api.py
git commit -m "$(cat <<'EOF'
feat(domains): retrieval mode enum and rerank knobs in config

EOF
)"
```

---

### Task 6: Wire `ask_domain` + `retrieve_domain` through `retrieve_for_query`

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_ask.py`
- Modify: `backend/tests/test_domain_retrieve_helper.py`
- Test (new cases): `backend/tests/test_domain_retrieve_helper.py`, `backend/tests/test_domain_ask_helpers.py` (optional coerce import smoke)

**Interfaces:**
- Consumes: `retrieve_for_query`, `coerce_retrieval_mode`, `coerce_rerank_config` from `domain_retrieve`
- Produces: both helpers call `retrieve_for_query(...)` with `mode` + `rerank` from domain config. `lexical` skips `embed()` and `missing_retrieve_providers` / embed BYOK. `dense`/`hybrid` embed as today. `ask_domain` still always requires generation BYOK.

Chat + Query-domain + MCP pick this up with **zero** router/MCP/canvas edits.

- [ ] **Step 1: Write the failing retrieve_domain tests**

In `backend/tests/test_domain_retrieve_helper.py`, change the happy-path patch target from `retrieve_domain_chunks` to `retrieve_for_query` (kwargs `top_k=3`). Add:

```python
def test_retrieve_domain_lexical_skips_embed():
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"top_k": 2, "mode": "lexical"},
    }
    chunks = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "SLA is 99.9%",
            "score": 0.2,
        }
    ]
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=2):
                with patch("tvashtr.control_plane.domain_ask.embed") as emb:
                    with patch(
                        "tvashtr.control_plane.domain_ask.retrieve_for_query",
                        return_value=chunks,
                    ) as ret:
                        out = retrieve_domain(oid, did, "SLA?")
    emb.assert_not_called()
    assert out["citations"][0]["filename"] == "a.md"
    ret.assert_called_once()
    assert ret.call_args.kwargs["mode"] == "lexical"
    assert ret.call_args.kwargs["query_embedding"] is None


def test_retrieve_domain_lexical_no_embed_key_ok():
    oid, did = uuid.uuid4(), uuid.uuid4()
    domain = MagicMock()
    domain.config = {
        "embedding": {"model": "text-embedding-3-small"},
        "retrieval": {"mode": "lexical", "top_k": 2},
    }
    with patch("tvashtr.control_plane.domain_ask.session_scope") as scope:
        sess = MagicMock()
        scope.return_value.__enter__.return_value = sess
        with patch("tvashtr.control_plane.domain_ask._owned_domain", return_value=domain):
            with patch("tvashtr.control_plane.domain_ask.count_ready_chunks", return_value=1):
                with patch(
                    "tvashtr.control_plane.domain_ask.held_provider_slugs",
                    return_value=set(),
                ):
                    with patch(
                        "tvashtr.control_plane.domain_ask.retrieve_for_query",
                        return_value=[
                            {
                                "chunk_id": "c",
                                "document_id": "d",
                                "filename": "a.md",
                                "ordinal": 0,
                                "text": "hi",
                                "score": 0.1,
                            }
                        ],
                    ):
                        out = retrieve_domain(oid, did, "hi")
    assert out["citations"]
```

Update `test_retrieve_domain_returns_citations` to patch `tvashtr.control_plane.domain_ask.retrieve_for_query` instead of `retrieve_domain_chunks`. Assert `ret.call_args.kwargs["top_k"] == 3` and `kwargs["mode"] == "dense"` (config omits mode → coerce default). Keep `test_retrieve_domain_missing_providers_dict` as-is (no mode → dense still needs embed key).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_helper.py -q`

Expected: FAIL (`retrieve_for_query` not called / embed still required).

- [ ] **Step 3: Wire both helpers**

In `domain_ask.py` change the retrieve import to:

```python
from tvashtr.control_plane.domain_retrieve import (
    citations_from_chunks,
    coerce_rerank_config,
    coerce_retrieval_mode,
    retrieve_for_query,
)
```

Inside `ask_domain`, after reading `cfg` / `top_k` / `emb_model`:

```python
        mode = coerce_retrieval_mode(cfg)
        rerank_cfg = coerce_rerank_config(cfg)
```

Replace the embed+`retrieve_domain_chunks` block with:

```python
    query_embedding = None
    if mode in ("dense", "hybrid"):
        # existing missing_ask_providers / resolve_owner_api_key / embed() unchanged
        # (still also requires chat key). After successful embed:
        query_embedding = emb_result.vectors[0]
    else:
        # lexical: still require generation providers, skip embed
        missing = missing_ask_providers(owner_id, None, gen_model)  # see helper tweak below
        ...

    chunks = retrieve_for_query(
        domain_id,
        q,
        query_embedding=query_embedding,
        top_k=top_k,
        mode=mode,
        rerank=rerank_cfg,
    )
```

**Do not** invent a second missing-providers helper if a small tweak to `missing_ask_providers` is cleaner:

Today:

```python
def missing_ask_providers(owner_id, embed_model, gen_model) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(embed_model), provider_for_model(gen_model)}
    return sorted(p for p in needed if p not in held)
```

Change to skip a None embed model:

```python
def missing_ask_providers(
    owner_id: uuid.UUID, embed_model: str | None, gen_model: str
) -> list[str]:
    held = held_provider_slugs(owner_id)
    needed = {provider_for_model(gen_model)}
    if embed_model:
        needed.add(provider_for_model(embed_model))
    return sorted(p for p in needed if p not in held)
```

`ask_domain` then:

```python
    mode = coerce_retrieval_mode(cfg)
    rerank_cfg = coerce_rerank_config(cfg)
    needs_embed = mode in ("dense", "hybrid")
    missing = missing_ask_providers(
        owner_id, emb_model if needs_embed else None, gen_model
    )
```

Only call `embed(...)` when `needs_embed`. Always call `retrieve_for_query` after that.

`retrieve_domain` parallel structure:

```python
    mode = coerce_retrieval_mode(cfg)
    rerank_cfg = coerce_rerank_config(cfg)
    needs_embed = mode in ("dense", "hybrid")
    query_embedding = None
    if needs_embed:
        missing = missing_retrieve_providers(owner_id, emb_model)
        ...
        emb_result = embed(...)
        query_embedding = emb_result.vectors[0]
    chunks = retrieve_for_query(
        domain_id,
        q,
        query_embedding=query_embedding,
        top_k=effective_k,
        mode=mode,
        rerank=rerank_cfg,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && uv run pytest \
  tests/test_domain_retrieve_helper.py \
  tests/test_domain_ask_helpers.py \
  tests/test_domain_ask_flow.py \
  tests/test_domain_ask_api.py \
  tests/test_domain_query_run.py \
  tests/test_domain_mcp_tools.py \
  tests/test_domain_retrieve_api.py \
  -q`

Expected: PASS (Query node + MCP still mock `ask_domain` / `retrieve_domain`; flow tests use default dense).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_ask.py \
  backend/tests/test_domain_retrieve_helper.py
git commit -m "$(cat <<'EOF'
feat(domains): ask and retrieve use hybrid retrieve_for_query path

EOF
)"
```

---

### Task 7: DomainConfigForm mode select + rerank knobs

**Files:**
- Modify: `frontend/src/lib/domains.ts`
- Modify: `frontend/src/components/DomainConfigForm.tsx`
- Test: `frontend/src/components/DomainConfigForm.test.tsx`

**Interfaces:**
- Consumes: existing `DomainConfig` / `parseDomainConfig`
- Produces: form `<select aria-label="Retrieval mode">` with options `dense`, `lexical`, `hybrid`; rerank checkbox `aria-label="Rerank enabled"`; number `aria-label="Rerank top N"`; text `aria-label="Rerank model"`; hint that v1 expands the candidate pool and does not call a paid reranker. Shared React (web + Desktop). Replace the free-text mode input and the "Phase 1: dense only. Hybrid arrives later." hint.

- [ ] **Step 1: Write the failing UI tests**

Update `frontend/src/components/DomainConfigForm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DomainConfigForm } from "./DomainConfigForm";

const sample = {
  chunking: { strategy: "fixed", size: 800, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: { top_k: 8, mode: "dense" },
  generation: { model: null },
};

describe("DomainConfigForm", () => {
  it("edits top_k via form and saves", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const topK = screen.getByLabelText(/top k/i);
    await user.clear(topK);
    await user.type(topK, "5");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(onSave).toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.top_k).toBe(5);
  });

  it("selects hybrid mode and rerank knobs", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<DomainConfigForm initial={sample} onSave={onSave} />);
    const mode = screen.getByLabelText(/retrieval mode/i);
    expect(mode.tagName).toBe("SELECT");
    await user.selectOptions(mode, "hybrid");
    await user.click(screen.getByLabelText(/rerank enabled/i));
    const topN = screen.getByLabelText(/rerank top n/i);
    await user.clear(topN);
    await user.type(topN, "16");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    const arg = onSave.mock.calls[0][0];
    expect(arg.retrieval.mode).toBe("hybrid");
    expect(arg.retrieval.rerank.enabled).toBe(true);
    expect(arg.retrieval.rerank.top_n).toBe(16);
    expect(arg.retrieval.rerank.model).toBeNull();
  });

  it("rejects invalid JSON in raw mode", async () => {
    const user = userEvent.setup();
    render(<DomainConfigForm initial={sample} onSave={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Raw JSON/i }));
    const area = screen.getByLabelText(/config json/i);
    await user.clear(area);
    await user.type(area, "{{not-json");
    await user.click(screen.getByRole("button", { name: /Save config/i }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/components/DomainConfigForm.test.tsx`

Expected: FAIL (mode is still an `<input>`; no rerank controls).

- [ ] **Step 3: Types + form**

In `frontend/src/lib/domains.ts` replace the retrieval field:

```ts
export type RetrievalMode = "dense" | "lexical" | "hybrid";

export interface DomainRerankConfig {
  enabled: boolean;
  model: string | null;
  top_n: number;
}

export interface DomainConfig {
  chunking: { strategy: string; size: number; overlap: number };
  embedding: { model: string };
  retrieval: {
    top_k: number;
    mode: RetrievalMode | string;
    rerank?: DomainRerankConfig;
  };
  generation: { model: string | null };
}
```

`parseDomainConfig` stays structural (sections must exist); do not require `rerank`.

In `DomainConfigForm.tsx`, helper to fill rerank defaults:

```ts
function withRerank(cfg: DomainConfig): DomainConfig {
  const rr = cfg.retrieval.rerank;
  return {
    ...cfg,
    retrieval: {
      ...cfg.retrieval,
      mode: cfg.retrieval.mode || "dense",
      rerank: {
        enabled: Boolean(rr?.enabled),
        model: rr?.model ?? null,
        top_n: Number(rr?.top_n) > 0 ? Number(rr?.top_n) : 20,
      },
    },
  };
}
```

Call `withRerank` from `asConfig`. Replace the retrieval-mode **input** with:

```tsx
          <label className="tv-field">
            <span className="tv-field__label">Retrieval mode</span>
            <select
              className="tv-launch__input"
              aria-label="Retrieval mode"
              value={cfg.retrieval.mode}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: { ...cfg.retrieval, mode: e.target.value },
                })
              }
            >
              <option value="dense">dense</option>
              <option value="lexical">lexical</option>
              <option value="hybrid">hybrid</option>
            </select>
            <span className="tv-field__hint">
              dense = pgvector cosine; lexical = Postgres full-text; hybrid = RRF fusion of both.
            </span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank enabled</span>
            <input
              type="checkbox"
              aria-label="Rerank enabled"
              checked={Boolean(cfg.retrieval.rerank?.enabled)}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: e.target.checked,
                      model: cfg.retrieval.rerank?.model ?? null,
                      top_n: cfg.retrieval.rerank?.top_n ?? 20,
                    },
                  },
                })
              }
            />
            <span className="tv-field__hint">
              v1: expands the candidate pool to Top N before cutting to Top K. No paid rerank
              provider is called; model is reserved for a future LiteLLM hook (passthrough when
              empty).
            </span>
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank top N</span>
            <input
              className="tv-launch__input"
              type="number"
              aria-label="Rerank top N"
              value={cfg.retrieval.rerank?.top_n ?? 20}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: Boolean(cfg.retrieval.rerank?.enabled),
                      model: cfg.retrieval.rerank?.model ?? null,
                      top_n: Number(e.target.value),
                    },
                  },
                })
              }
            />
          </label>
          <label className="tv-field">
            <span className="tv-field__label">Rerank model</span>
            <input
              className="tv-launch__input"
              aria-label="Rerank model"
              placeholder="optional — passthrough when empty"
              value={cfg.retrieval.rerank?.model ?? ""}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  retrieval: {
                    ...cfg.retrieval,
                    rerank: {
                      enabled: Boolean(cfg.retrieval.rerank?.enabled),
                      model: e.target.value.trim() ? e.target.value : null,
                      top_n: cfg.retrieval.rerank?.top_n ?? 20,
                    },
                  },
                })
              }
            />
          </label>
```

No new CSS required (reuse `.tv-field` / `.tv-field__hint` / `.tv-domains__config-grid`). Widen the grid only if the checkbox looks cramped — optional `max-width` tweak under `.tv-domains__config-grid` is allowed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm test -- src/components/DomainConfigForm.test.tsx src/components/DomainsPage.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/domains.ts \
  frontend/src/components/DomainConfigForm.tsx \
  frontend/src/components/DomainConfigForm.test.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): hybrid retrieval mode select and rerank knobs

EOF
)"
```

---

### Task 8: Regression gate + YAGNI check

**Files:** none new (commands only)

- [ ] **Step 1: Backend Phase 5 + retrieve/ask/MCP/query regression**

```bash
cd backend && uv run pytest \
  tests/test_domain_documents_models.py \
  tests/test_domain_retrieve.py \
  tests/test_domain_retrieve_fusion.py \
  tests/test_domain_retrieve_lexical.py \
  tests/test_domain_retrieve_helper.py \
  tests/test_domain_retrieve_api.py \
  tests/test_domains_helpers.py \
  tests/test_domains_api.py \
  tests/test_domain_ask_helpers.py \
  tests/test_domain_ask_flow.py \
  tests/test_domain_ask_api.py \
  tests/test_domain_query_run.py \
  tests/test_domain_mcp_tools.py \
  tests/test_domain_mcp_http.py \
  tests/test_domain_mcp_inject.py \
  -q
```

Expected: PASS

- [ ] **Step 2: Frontend regression**

```bash
cd frontend && npm test -- src/components/DomainConfigForm.test.tsx src/components/DomainsPage.test.tsx
```

Expected: PASS

- [ ] **Step 3: Confirm shared path + locked names**

```bash
rg -n "retrieve_for_query|retrieve_lexical_chunks|rrf_fuse|apply_rerank" \
  backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/control_plane/domain_ask.py
```

Expected: `ask_domain` and `retrieve_domain` call `retrieve_for_query`; MCP / routers / `team_run.py` still call `ask_domain` / `retrieve_domain` only (no new retrieve implementation there).

```bash
rg -n "retrieve_domain_chunks|ask_domain|retrieve_domain" \
  backend/tvashtr/control_plane/domain_mcp.py \
  backend/tvashtr/control_plane/team_run.py \
  backend/tvashtr/routers.py
```

Expected: no direct `retrieve_for_query` in MCP/canvas/routers (they stay on the helpers).

- [ ] **Step 4: YAGNI grep (Phase 6–7 must stay absent)**

```bash
rg -n "GraphRAG|colbert|ColBERT|golden.set|cross-encoder|cohere.rerank" \
  backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/control_plane/domain_ask.py \
  backend/tvashtr/control_plane/domain_mcp.py \
  frontend/src/components/DomainConfigForm.tsx || true
```

Expected: no GraphRAG / ColBERT / eval sets / cross-encoder / live Cohere rerank client. Mentions of "passthrough" / "future LiteLLM hook" in comments or UI hint are OK.

Confirm no new MCP tool names:

```bash
rg -n "domain_ask|domain_retrieve" backend/tvashtr/mcp/domains.py backend/tvashtr/control_plane/domain_mcp.py
```

Expected: still exactly those two tools.

- [ ] **Step 5: Final fixup commit only if needed**

```bash
git commit -m "$(cat <<'EOF'
test(domains): Phase 5 regression gate green

EOF
)"
```

---

## How operators turn on hybrid

On a Domain → Config:

1. Set **Retrieval mode** to `hybrid` (or `lexical` for FTS-only; no embedding key needed for retrieve/ask-embed).
2. Optionally check **Rerank enabled** and raise **Rerank top N** (e.g. 20) so each retriever fetches a larger pool before cutting to Top K. Leave **Rerank model** empty — v1 will not call a provider.
3. Save. Chat, Query-domain nodes, HTTP `/retrieve`, and MCP `domain_ask` / `domain_retrieve` all use the new path on the next question.

Existing domains remain `mode: dense` until patched. New domains from templates still default to `dense`.

---

## Self-review checklist (Phase 5 spec → tasks)

| Spec / locked decision | Task(s) |
|------------------------|---------|
| Postgres FTS `tsvector` + `plainto_tsquery` / `ts_rank` | Tasks 1, 3 |
| RRF hybrid fusion | Tasks 2, 4 |
| `retrieval.mode` dense \| lexical \| hybrid, default dense | Tasks 2, 5, 7 |
| Rerank knobs + candidate_k expansion + passthrough hook | Tasks 2, 4, 5, 7 |
| PATCH validates mode enum | Task 5 |
| DomainConfigForm select + rerank UI (web+Desktop shared React) | Task 7 |
| Shared path: Chat + Query node + MCP get hybrid automatically | Task 6 + Task 8 grep |
| Skip embed on lexical | Task 6 |
| YAGNI: no GraphRAG / ColBERT / eval / new MCP tools | Global Constraints + Task 8 |
| Branch `feat/polyrag-domains-phase5` from phase4b `bdb4aed` | Global Constraints |

### Plan completeness notes

- **No TBDs** for FTS column name (`text_tsv`), RRF k (60), mode enum, rerank object shape, dispatcher name (`retrieve_for_query`), or default `dense`.
- **Ingest unchanged** — generated stored `text_tsv` backfills existing rows and new `text` inserts.
- **MCP / canvas / routers unchanged** — they already call `ask_domain` / `retrieve_domain`.
- **Rerank v1 documented:** knobs + pool expansion only; `apply_rerank` is identity; `model` reserved.
- **Phase 6+ deferred:** eval golden sets, GraphRAG, ColBERT, paid rerank providers — do not stub clients.

---

## Git notes for implementers

Author via env only — **never** `git config`:

```bash
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
message

EOF
)"
```
