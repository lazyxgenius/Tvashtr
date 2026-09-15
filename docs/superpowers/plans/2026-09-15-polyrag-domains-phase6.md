# PolyRAG Domains Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 6 only — per-domain **eval golden sets** (curated Q&A fixtures in DB) plus a **sync eval run** that scores retrieval with deterministic metrics (**hit@k**, **keyword_hit**) and surfaces cases + last scores in a Domains detail **Eval** tab (shared React, web+Desktop).

**Architecture:** Add small tables `domain_eval_cases` and `domain_eval_runs` (Alembic `0037`). Owner-scoped CRUD for cases; `POST /api/domains/{id}/eval` runs **synchronously** (cap 50 cases) by calling existing **`retrieve_domain`** only (no duplicate RAG; no `ask_domain` so Chat history stays clean and chat BYOK is not required). Pure scorers in `domain_eval.py` compute hit@k (expected document ids intersect citation `document_id`s) and keyword_hit (case-insensitive substring of each expected keyword in joined citation excerpts). UI adds an **Eval** tab on `DomainsPage`.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic + pytest (backend); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop). Reuse `retrieve_domain`, `DomainAskError`, `_owned_domain` / `get_domain` ownership patterns, `session_scope`, citation shape from Phase 3/5.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 6 only** (Eval golden sets + basic quality scores).
- **Branch base:** Implement on `feat/polyrag-domains-phase6` created from `feat/polyrag-domains-phase5` tip `79bfdc6`. Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — Desktop continues same-origin `/api` proxy to Fly; no Desktop-only eval backend.
- **Tables (locked):** `domain_eval_cases` and `domain_eval_runs` (not JSONB-only on Domain). Both `domain_id` → `domains.id` **ON DELETE CASCADE**. Alembic revision **`0037_domain_eval`** revises **`0036_domain_chunks_fts`**.
- **Case columns (locked):** `id`, `domain_id`, `question` (non-empty text), `expected_answer` (nullable text — **stored for humans / future; not scored in v1**), `expected_citation_doc_ids` (JSONB list of document UUID strings, default `[]`), `expected_keywords` (JSONB list of strings, default `[]`), `ordinal` (int, default 0), `created_at`.
- **Run columns (locked):** `id`, `domain_id`, `status` (`pending` | `running` | `completed` | `failed`), `scores` (JSONB nullable), `error_message` (nullable text), `created_at`, `completed_at` (nullable timestamptz).
- **Scoring (locked — deterministic only):** After `retrieve_domain` per case:
  - **hit@k:** for cases with non-empty `expected_citation_doc_ids`, `hit = True` iff **any** expected doc id appears in returned citations' `document_id`. Aggregate `hit_at_k` = mean of those case hits (float 0..1). Cases with empty expected doc ids are **excluded** from the mean (`cases_scored_hit`).
  - **keyword_hit:** for cases with non-empty `expected_keywords`, `keyword_hit = True` iff **every** keyword is a case-insensitive substring of the joined citation `excerpt`s (space-joined). Aggregate `keyword_hit` = mean over those cases (`cases_scored_keyword`).
  - **No LLM-as-judge**, no paid judge models, no embedding similarity judge.
- **Eval path (locked):** call **`retrieve_domain(owner_id, domain_id, question)`** only. Do **not** call `ask_domain` (avoids Chat pollution + generation BYOK). Do **not** reimplement retrieve/embed. `retrieve_for_query` stays behind `retrieve_domain`.
- **Sync + cap (locked):** `POST /api/domains/{id}/eval` is **synchronous**. Max **`MAX_EVAL_CASES = 50`** cases per domain (enforce on create + refuse run if somehow over). Empty case list → 422.
- **API (locked — owner-scoped):**
  - `GET /api/domains/{id}/eval/cases` → `{ cases: [...] }`
  - `POST /api/domains/{id}/eval/cases` body `{ question, expected_answer?, expected_citation_doc_ids?, expected_keywords?, ordinal? }` → case dict
  - `DELETE /api/domains/{id}/eval/cases/{case_id}` → 204
  - `GET /api/domains/{id}/eval/runs/latest` → run dict or 404 if none
  - `POST /api/domains/{id}/eval` → creates run, executes sync, returns completed/failed run with `scores`
  - Foreign / missing domain → **404** (same as other domain routes).
- **scores JSON shape (locked):** see Task 2 aggregate return; when a metric has zero scored cases, set that aggregate to `null` (not `0`).
- **UI (locked):** Domains detail tab **Eval**. Order: **Overview | Documents | Chat | Eval | Config**. List cases, add/delete, **Run eval**, show latest scores. Shared React (`DomainsPage` + `DomainEvalPanel`).
- YAGNI: **no** GraphRAG, **no** product A/B UI, **no** paid judge models, **no** auto-tuning loop, **no** async DBOS eval job, **no** PATCH case (delete+recreate), **no** new MCP tools, **no** canvas changes, **no** ingest rewrite.
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`); **never** `git config`.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `backend/alembic/versions/0037_domain_eval.py` | Tables `domain_eval_cases` + `domain_eval_runs`; `down_revision = 0036_domain_chunks_fts`. |
| **Modify** `backend/tvashtr/models.py` | ORM `DomainEvalCase`, `DomainEvalRun`. |
| **Create** `backend/tvashtr/control_plane/domain_eval.py` | Case CRUD helpers, pure scorers, `run_domain_eval` (calls `retrieve_domain`). |
| **Create** `backend/tests/test_domain_eval_models.py` | ORM smoke. |
| **Create** `backend/tests/test_domain_eval_scoring.py` | Unit tests for hit@k / keyword scorers + aggregates. |
| **Create** `backend/tests/test_domain_eval_helpers.py` | CRUD + `run_domain_eval` with mocked `retrieve_domain`. |
| **Modify** `backend/tvashtr/routers.py` | Pydantic bodies + eval case/run routes. |
| **Create** `backend/tests/test_domain_eval_api.py` | HTTP owner-scope, CRUD, sync eval, cap, empty 422. |
| **Modify** `frontend/src/lib/api.ts` | Types + list/create/delete cases, getLatest run, runDomainEval. |
| **Create** `frontend/src/lib/domainEval.test.ts` | Client URL/method tests. |
| **Create** `frontend/src/components/DomainEvalPanel.tsx` | Cases list/add/delete + Run eval + scores. |
| **Create** `frontend/src/components/DomainEvalPanel.test.tsx` | Panel interaction tests. |
| **Modify** `frontend/src/components/DomainsPage.tsx` | Add **Eval** tab; render `DomainEvalPanel`. |
| **Modify** `frontend/src/components/DomainsPage.test.tsx` | Mock new API fns; assert Eval tab present. |

**Out of scope (do not create for Phase 6):** GraphRAG, A/B compare UI, LLM judge, auto-tune, DBOS async eval, `ask_domain` in eval loop, new MCP tools, canvas node fields, PATCH eval case.

---

### Task 1: Alembic 0037 + ORM models

**Files:**
- Create: `backend/alembic/versions/0037_domain_eval.py`
- Modify: `backend/tvashtr/models.py` (after `DomainMessage`)
- Test: `backend/tests/test_domain_eval_models.py`

**Interfaces:**
- Consumes: Alembic head `0036_domain_chunks_fts`; existing `Domain` FK cascade pattern
- Produces: tables + ORM classes `DomainEvalCase`, `DomainEvalRun`

- [ ] **Step 1: Write the failing ORM smoke**

Create `backend/tests/test_domain_eval_models.py`:

```python
"""Phase 6 — DomainEvalCase / DomainEvalRun ORM smoke."""

from tvashtr.models import DomainEvalCase, DomainEvalRun


def test_domain_eval_case_tablename_and_columns():
    assert DomainEvalCase.__tablename__ == "domain_eval_cases"
    cols = {c.name for c in DomainEvalCase.__table__.columns}
    assert {
        "id",
        "domain_id",
        "question",
        "expected_answer",
        "expected_citation_doc_ids",
        "expected_keywords",
        "ordinal",
        "created_at",
    } <= cols


def test_domain_eval_run_tablename_and_columns():
    assert DomainEvalRun.__tablename__ == "domain_eval_runs"
    cols = {c.name for c in DomainEvalRun.__table__.columns}
    assert {
        "id",
        "domain_id",
        "status",
        "scores",
        "error_message",
        "created_at",
        "completed_at",
    } <= cols
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_eval_models.py -q`

Expected: FAIL (`DomainEvalCase` / `DomainEvalRun` not defined).

- [ ] **Step 3: Add ORM models + migration**

In `backend/tvashtr/models.py`, after `DomainMessage`, add:

```python
class DomainEvalCase(Base):
    """One golden Q&A fixture for a Domain (Phase 6 eval).

    ``expected_citation_doc_ids`` / ``expected_keywords`` drive deterministic
    hit@k and keyword_hit scores. ``expected_answer`` is human reference only in v1.
    NEVER store provider secrets here.
    """

    __tablename__ = "domain_eval_cases"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    question: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_citation_doc_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]", default=list
    )
    expected_keywords: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]", default=list
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DomainEvalRun(Base):
    """One sync eval execution for a Domain (Phase 6).

    ``scores`` holds aggregate + per_case metrics JSON. NEVER store secrets.
    """

    __tablename__ = "domain_eval_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    domain_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("domains.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # pending | running | completed | failed
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending", default="pending"
    )
    scores: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
```

Create `backend/alembic/versions/0037_domain_eval.py`:

```python
"""domain_eval_cases + domain_eval_runs — PolyRAG Phase 6 eval

Revision ID: 0037_domain_eval
Revises: 0036_domain_chunks_fts
Create Date: 2026-09-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision: str = "0037_domain_eval"
down_revision: str | None = "0036_domain_chunks_fts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "domain_eval_cases",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("expected_answer", sa.Text(), nullable=True),
        sa.Column(
            "expected_citation_doc_ids",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "expected_keywords",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_domain_eval_cases_domain_id", "domain_eval_cases", ["domain_id"])

    op.create_table(
        "domain_eval_runs",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column(
            "domain_id",
            sa.Uuid(),
            sa.ForeignKey("domains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("scores", JSONB(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_domain_eval_runs_domain_id", "domain_eval_runs", ["domain_id"])


def downgrade() -> None:
    op.drop_index("ix_domain_eval_runs_domain_id", table_name="domain_eval_runs")
    op.drop_table("domain_eval_runs")
    op.drop_index("ix_domain_eval_cases_domain_id", table_name="domain_eval_cases")
    op.drop_table("domain_eval_cases")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_eval_models.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0037_domain_eval.py backend/tvashtr/models.py backend/tests/test_domain_eval_models.py
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 eval tables + ORM (cases + runs)

EOF
)"
```

---

### Task 2: Pure scoring helpers

**Files:**
- Create: `backend/tvashtr/control_plane/domain_eval.py` (scoring section first)
- Test: `backend/tests/test_domain_eval_scoring.py`

**Interfaces:**
- Consumes: citation dicts with `document_id`, `excerpt`
- Produces:
  - `MAX_EVAL_CASES = 50`
  - `score_hit_at_k(expected_doc_ids: list[str], citations: list[dict]) -> bool | None`
  - `score_keyword_hit(expected_keywords: list[str], citations: list[dict]) -> bool | None`
  - `aggregate_eval_scores(per_case: list[dict], *, top_k: int, retrieval_mode: str) -> dict`

- [ ] **Step 1: Write the failing scoring tests**

Create `backend/tests/test_domain_eval_scoring.py`:

```python
"""Phase 6 — deterministic eval scorers."""

from tvashtr.control_plane.domain_eval import (
    aggregate_eval_scores,
    score_hit_at_k,
    score_keyword_hit,
)


def test_hit_at_k_true_when_any_expected_doc_in_citations():
    cites = [{"document_id": "d2", "excerpt": "x"}, {"document_id": "d9", "excerpt": "y"}]
    assert score_hit_at_k(["d1", "d2"], cites) is True


def test_hit_at_k_false_when_none_match():
    cites = [{"document_id": "d9", "excerpt": "x"}]
    assert score_hit_at_k(["d1"], cites) is False


def test_hit_at_k_none_when_no_expected_docs():
    assert score_hit_at_k([], [{"document_id": "d1", "excerpt": "x"}]) is None
    assert score_hit_at_k(None, [{"document_id": "d1", "excerpt": "x"}]) is None


def test_keyword_hit_requires_all_keywords_case_insensitive():
    cites = [{"document_id": "d1", "excerpt": "Refunds take Five days"}]
    assert score_keyword_hit(["refunds", "five"], cites) is True
    assert score_keyword_hit(["refunds", "weeks"], cites) is False


def test_keyword_hit_none_when_no_keywords():
    assert score_keyword_hit([], [{"excerpt": "hi"}]) is None


def test_aggregate_means_and_null_when_unscored():
    per = [
        {
            "case_id": "c1",
            "question": "q1",
            "hit": True,
            "keyword_hit": None,
            "citation_doc_ids": ["d1"],
            "latency_ms": 1,
            "error": None,
        },
        {
            "case_id": "c2",
            "question": "q2",
            "hit": False,
            "keyword_hit": True,
            "citation_doc_ids": [],
            "latency_ms": 2,
            "error": None,
        },
        {
            "case_id": "c3",
            "question": "q3",
            "hit": None,
            "keyword_hit": False,
            "citation_doc_ids": [],
            "latency_ms": 3,
            "error": None,
        },
    ]
    scores = aggregate_eval_scores(per, top_k=8, retrieval_mode="dense")
    assert scores["cases_total"] == 3
    assert scores["cases_scored_hit"] == 2
    assert scores["cases_scored_keyword"] == 2
    assert scores["hit_at_k"] == 0.5
    assert scores["keyword_hit"] == 0.5
    assert scores["top_k"] == 8
    assert scores["retrieval_mode"] == "dense"
    assert len(scores["per_case"]) == 3


def test_aggregate_null_metrics_when_zero_scored():
    per = [
        {
            "case_id": "c1",
            "question": "q",
            "hit": None,
            "keyword_hit": None,
            "citation_doc_ids": [],
            "latency_ms": 1,
            "error": None,
        }
    ]
    scores = aggregate_eval_scores(per, top_k=4, retrieval_mode="hybrid")
    assert scores["hit_at_k"] is None
    assert scores["keyword_hit"] is None
    assert scores["cases_scored_hit"] == 0
    assert scores["cases_scored_keyword"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_eval_scoring.py -q`

Expected: FAIL (module / symbols missing).

- [ ] **Step 3: Implement scorers**

Create `backend/tvashtr/control_plane/domain_eval.py` with scoring functions (CRUD/runner added in Tasks 3–4):

```python
"""Phase 6 — Domain eval golden sets + deterministic quality scores."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select

from tvashtr.control_plane.domain_ask import DomainAskError, retrieve_domain
from tvashtr.control_plane.domain_retrieve import coerce_retrieval_mode, coerce_retrieval_top_k
from tvashtr.control_plane.domains import _owned_domain
from tvashtr.db import session_scope
from tvashtr.models import DomainEvalCase, DomainEvalRun

MAX_EVAL_CASES = 50


def score_hit_at_k(
    expected_doc_ids: list[str] | None, citations: list[dict]
) -> bool | None:
    ids = [str(x).strip() for x in (expected_doc_ids or []) if str(x).strip()]
    if not ids:
        return None
    cited = {str(c.get("document_id") or "") for c in citations}
    return any(eid in cited for eid in ids)


def score_keyword_hit(
    expected_keywords: list[str] | None, citations: list[dict]
) -> bool | None:
    kws = [str(k).strip() for k in (expected_keywords or []) if str(k).strip()]
    if not kws:
        return None
    hay = " ".join(str(c.get("excerpt") or "") for c in citations).lower()
    return all(k.lower() in hay for k in kws)


def aggregate_eval_scores(
    per_case: list[dict], *, top_k: int, retrieval_mode: str
) -> dict:
    hit_vals = [p["hit"] for p in per_case if p.get("hit") is not None]
    kw_vals = [p["keyword_hit"] for p in per_case if p.get("keyword_hit") is not None]
    return {
        "cases_total": len(per_case),
        "cases_scored_hit": len(hit_vals),
        "cases_scored_keyword": len(kw_vals),
        "hit_at_k": (sum(1 for v in hit_vals if v) / len(hit_vals)) if hit_vals else None,
        "keyword_hit": (sum(1 for v in kw_vals if v) / len(kw_vals)) if kw_vals else None,
        "top_k": top_k,
        "retrieval_mode": retrieval_mode,
        "per_case": per_case,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_eval_scoring.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_eval.py backend/tests/test_domain_eval_scoring.py
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 deterministic hit@k + keyword scorers

EOF
)"
```

---

### Task 3: Eval case CRUD helpers

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_eval.py`
- Test: `backend/tests/test_domain_eval_helpers.py`

**Interfaces:**
- Produces:
  - `eval_case_to_dict(row) -> dict`
  - `eval_run_to_dict(row) -> dict`
  - `list_eval_cases(owner_id, domain_id) -> list[dict] | None` (`None` = domain missing)
  - `create_eval_case(owner_id, domain_id, *, question, expected_answer=None, expected_citation_doc_ids=None, expected_keywords=None, ordinal=0) -> dict` raises `LookupError` / `ValueError`
  - `delete_eval_case(owner_id, domain_id, case_id) -> bool`
  - `_normalize_doc_ids(raw) -> list[str]`
  - `_normalize_keywords(raw) -> list[str]`

Case dict keys: `case_id`, `domain_id`, `question`, `expected_answer`, `expected_citation_doc_ids`, `expected_keywords`, `ordinal`, `created_at`.

- [ ] **Step 1: Write failing CRUD tests**

Create `backend/tests/test_domain_eval_helpers.py`. **Match existing owner/domain fixture patterns** from `tests/test_domains_helpers.py` / `test_domain_documents_api.py` (do not invent a divergent `User` constructor if the suite already has a helper).

```python
"""Phase 6 — eval case CRUD + run_domain_eval (mocked retrieve)."""

import uuid
from unittest.mock import patch

import pytest

from tvashtr.control_plane import domain_eval as ev
from tvashtr.control_plane.domain_ask import DomainAskError
from tvashtr.control_plane.domains import create_domain


# Use the same owner factory the domain test suite already uses.
# Pseudocode — replace `_owner()` with the real helper (e.g. create_test_user).


def test_create_list_delete_eval_case_roundtrip(owner_id):
    dom = create_domain(owner_id, "blank", "Eval Dom")
    did = uuid.UUID(dom["domain_id"])
    created = ev.create_eval_case(
        owner_id,
        did,
        question="What is the refund window?",
        expected_answer="5 days",
        expected_citation_doc_ids=[str(uuid.uuid4())],
        expected_keywords=["refund"],
        ordinal=1,
    )
    assert created["question"].startswith("What is")
    assert created["ordinal"] == 1
    rows = ev.list_eval_cases(owner_id, did)
    assert rows is not None and len(rows) == 1
    assert ev.delete_eval_case(owner_id, did, uuid.UUID(created["case_id"])) is True
    assert ev.list_eval_cases(owner_id, did) == []


def test_create_eval_case_rejects_empty_question(owner_id):
    did = uuid.UUID(create_domain(owner_id, "blank", "E")["domain_id"])
    with pytest.raises(ValueError, match="question"):
        ev.create_eval_case(owner_id, did, question="   ")


def test_create_eval_case_enforces_max_cap(owner_id, monkeypatch):
    did = uuid.UUID(create_domain(owner_id, "blank", "E")["domain_id"])
    monkeypatch.setattr(ev, "MAX_EVAL_CASES", 1)
    ev.create_eval_case(owner_id, did, question="q1")
    with pytest.raises(ValueError, match="50|max|limit|cap"):
        ev.create_eval_case(owner_id, did, question="q2")


def test_list_eval_cases_none_for_foreign_domain(owner_id, other_owner_id):
    did = uuid.UUID(create_domain(other_owner_id, "blank", "X")["domain_id"])
    assert ev.list_eval_cases(owner_id, did) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_domain_eval_helpers.py -q`

Expected: FAIL (CRUD helpers missing).

- [ ] **Step 3: Implement CRUD in `domain_eval.py`**

Append (match ISO timestamp style used by other `*_to_dict` helpers in `domains.py`):

```python
def eval_case_to_dict(row: DomainEvalCase) -> dict:
    return {
        "case_id": str(row.id),
        "domain_id": str(row.domain_id),
        "question": row.question,
        "expected_answer": row.expected_answer,
        "expected_citation_doc_ids": list(row.expected_citation_doc_ids or []),
        "expected_keywords": list(row.expected_keywords or []),
        "ordinal": int(row.ordinal or 0),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def eval_run_to_dict(row: DomainEvalRun) -> dict:
    return {
        "run_id": str(row.id),
        "domain_id": str(row.domain_id),
        "status": row.status,
        "scores": row.scores,
        "error_message": row.error_message,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


def _normalize_doc_ids(raw: list | None) -> list[str]:
    out: list[str] = []
    for x in raw or []:
        s = str(x).strip()
        if not s:
            continue
        try:
            out.append(str(uuid.UUID(s)))
        except ValueError as e:
            raise ValueError(f"invalid document id: {s}") from e
    return out


def _normalize_keywords(raw: list | None) -> list[str]:
    return [str(k).strip() for k in (raw or []) if str(k).strip()]


def list_eval_cases(owner_id: uuid.UUID, domain_id: uuid.UUID) -> list[dict] | None:
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return None
        rows = (
            session.execute(
                select(DomainEvalCase)
                .where(DomainEvalCase.domain_id == domain_id)
                .order_by(DomainEvalCase.ordinal, DomainEvalCase.created_at, DomainEvalCase.id)
            )
            .scalars()
            .all()
        )
        return [eval_case_to_dict(r) for r in rows]


def create_eval_case(
    owner_id: uuid.UUID,
    domain_id: uuid.UUID,
    *,
    question: str,
    expected_answer: str | None = None,
    expected_citation_doc_ids: list | None = None,
    expected_keywords: list | None = None,
    ordinal: int = 0,
) -> dict:
    q = (question or "").strip()
    if not q:
        raise ValueError("question must be non-empty")
    doc_ids = _normalize_doc_ids(expected_citation_doc_ids)
    kws = _normalize_keywords(expected_keywords)
    ans = (expected_answer or "").strip() or None
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        n = session.execute(
            select(func.count())
            .select_from(DomainEvalCase)
            .where(DomainEvalCase.domain_id == domain_id)
        ).scalar_one()
        if int(n) >= MAX_EVAL_CASES:
            raise ValueError(f"eval case limit is {MAX_EVAL_CASES}")
        row = DomainEvalCase(
            domain_id=domain_id,
            question=q,
            expected_answer=ans,
            expected_citation_doc_ids=doc_ids,
            expected_keywords=kws,
            ordinal=int(ordinal or 0),
        )
        session.add(row)
        session.flush()
        return eval_case_to_dict(row)


def delete_eval_case(
    owner_id: uuid.UUID, domain_id: uuid.UUID, case_id: uuid.UUID
) -> bool:
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return False
        row = session.execute(
            select(DomainEvalCase).where(
                DomainEvalCase.id == case_id,
                DomainEvalCase.domain_id == domain_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return False
        session.delete(row)
        session.flush()
        return True
```

- [ ] **Step 4: Run CRUD tests**

Run: `cd backend && uv run pytest tests/test_domain_eval_helpers.py -q -k "eval_case or list_eval or create_eval or enforces_max"`

Expected: PASS for CRUD cases.

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_eval.py backend/tests/test_domain_eval_helpers.py
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 eval case CRUD helpers (cap 50)

EOF
)"
```

---

### Task 4: `run_domain_eval` (sync, uses `retrieve_domain`)

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_eval.py`
- Modify: `backend/tests/test_domain_eval_helpers.py`

**Interfaces:**
- Produces:
  - `latest_eval_run_for_owner(owner_id, domain_id) -> tuple[bool, dict | None]` — `(domain_owned, run_or_none)`
  - `run_domain_eval(owner_id, domain_id) -> dict` (run dict)
    - Raises `LookupError` if domain missing
    - Raises `ValueError` if zero cases
    - Creates `DomainEvalRun` status `running` → `completed`
    - Per case: `retrieve_domain(...)`; on `DomainAskError`, record `error` string, leave `hit`/`keyword_hit` as `None`
    - Reads domain config once for `top_k` + `retrieval_mode` into scores metadata

- [ ] **Step 1: Write failing runner tests**

Append to `backend/tests/test_domain_eval_helpers.py`:

```python
def test_run_domain_eval_scores_with_mocked_retrieve(owner_id):
    did = uuid.UUID(create_domain(owner_id, "blank", "Eval Run")["domain_id"])
    doc_a = str(uuid.uuid4())
    ev.create_eval_case(
        owner_id,
        did,
        question="refund window?",
        expected_citation_doc_ids=[doc_a],
        expected_keywords=["refund"],
    )
    fake = {
        "citations": [
            {
                "document_id": doc_a,
                "filename": "faq.txt",
                "chunk_id": str(uuid.uuid4()),
                "ordinal": 0,
                "excerpt": "Refund policy: 5 days",
                "score": 0.9,
            }
        ],
        "latency_ms": 11,
    }
    with patch.object(ev, "retrieve_domain", return_value=fake) as m:
        run = ev.run_domain_eval(owner_id, did)
    assert m.called
    assert run["status"] == "completed"
    scores = run["scores"]
    assert scores["hit_at_k"] == 1.0
    assert scores["keyword_hit"] == 1.0
    assert scores["cases_total"] == 1
    assert scores["per_case"][0]["hit"] is True


def test_run_domain_eval_rejects_empty_cases(owner_id):
    did = uuid.UUID(create_domain(owner_id, "blank", "Empty")["domain_id"])
    with pytest.raises(ValueError, match="no eval cases|empty"):
        ev.run_domain_eval(owner_id, did)


def test_run_domain_eval_records_retrieve_error_per_case(owner_id):
    did = uuid.UUID(create_domain(owner_id, "blank", "Err")["domain_id"])
    ev.create_eval_case(
        owner_id, did, question="q?", expected_citation_doc_ids=[str(uuid.uuid4())]
    )
    with patch.object(
        ev,
        "retrieve_domain",
        side_effect=DomainAskError("empty_corpus", "ingest documents before asking"),
    ):
        run = ev.run_domain_eval(owner_id, did)
    assert run["status"] == "completed"
    assert run["scores"]["per_case"][0]["error"]
    assert run["scores"]["hit_at_k"] is None
```

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domain_eval_helpers.py::test_run_domain_eval_scores_with_mocked_retrieve -q`

Expected: FAIL (`run_domain_eval` missing).

- [ ] **Step 3: Implement runner + latest helper**

```python
def latest_eval_run_for_owner(
    owner_id: uuid.UUID, domain_id: uuid.UUID
) -> tuple[bool, dict | None]:
    """Return (domain_owned, run_or_none)."""
    with session_scope() as session:
        if _owned_domain(session, owner_id, domain_id) is None:
            return False, None
        row = session.execute(
            select(DomainEvalRun)
            .where(DomainEvalRun.domain_id == domain_id)
            .order_by(DomainEvalRun.created_at.desc(), DomainEvalRun.id.desc())
            .limit(1)
        ).scalar_one_or_none()
        return True, (eval_run_to_dict(row) if row else None)


def run_domain_eval(owner_id: uuid.UUID, domain_id: uuid.UUID) -> dict:
    with session_scope() as session:
        domain = _owned_domain(session, owner_id, domain_id)
        if domain is None:
            raise LookupError("domain not found")
        cfg = dict(domain.config or {})
        top_k = coerce_retrieval_top_k(cfg)
        mode = coerce_retrieval_mode(cfg)
        cases = (
            session.execute(
                select(DomainEvalCase)
                .where(DomainEvalCase.domain_id == domain_id)
                .order_by(DomainEvalCase.ordinal, DomainEvalCase.created_at, DomainEvalCase.id)
            )
            .scalars()
            .all()
        )
        if not cases:
            raise ValueError("no eval cases — add golden questions before running eval")
        if len(cases) > MAX_EVAL_CASES:
            raise ValueError(f"eval case limit is {MAX_EVAL_CASES}")
        case_snapshots = [
            {
                "id": c.id,
                "question": c.question,
                "expected_citation_doc_ids": list(c.expected_citation_doc_ids or []),
                "expected_keywords": list(c.expected_keywords or []),
            }
            for c in cases
        ]
        run = DomainEvalRun(domain_id=domain_id, status="running")
        session.add(run)
        session.flush()
        run_id = run.id

    per_case: list[dict] = []
    for snap in case_snapshots:
        entry: dict[str, Any] = {
            "case_id": str(snap["id"]),
            "question": snap["question"],
            "hit": None,
            "keyword_hit": None,
            "citation_doc_ids": [],
            "latency_ms": None,
            "error": None,
        }
        try:
            result = retrieve_domain(owner_id, domain_id, snap["question"])
            cites = list(result.get("citations") or [])
            entry["citation_doc_ids"] = [str(c.get("document_id") or "") for c in cites]
            entry["latency_ms"] = result.get("latency_ms")
            entry["hit"] = score_hit_at_k(snap["expected_citation_doc_ids"], cites)
            entry["keyword_hit"] = score_keyword_hit(snap["expected_keywords"], cites)
        except DomainAskError as e:
            detail = e.detail
            entry["error"] = (
                detail.get("message") if isinstance(detail, dict) else str(detail)
            )
        per_case.append(entry)

    scores = aggregate_eval_scores(per_case, top_k=top_k, retrieval_mode=mode)
    with session_scope() as session:
        run = session.get(DomainEvalRun, run_id)
        assert run is not None
        run.status = "completed"
        run.scores = scores
        run.completed_at = datetime.now(timezone.utc)
        session.flush()
        return eval_run_to_dict(run)
```

- [ ] **Step 4: Run helper tests**

Run: `cd backend && uv run pytest tests/test_domain_eval_helpers.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_eval.py backend/tests/test_domain_eval_helpers.py
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 sync run_domain_eval via retrieve_domain

EOF
)"
```

---

### Task 5: HTTP API routes

**Files:**
- Modify: `backend/tvashtr/routers.py` (near existing domain routes; import helpers)
- Test: `backend/tests/test_domain_eval_api.py`

**Interfaces:**
- Pydantic: `DomainEvalCaseCreate` with `question: str`, optional `expected_answer`, `expected_citation_doc_ids: list[str] = []`, `expected_keywords: list[str] = []`, `ordinal: int = 0`
- Routes as locked in Global Constraints
- Map `LookupError` → 404; `ValueError` → 422
- `GET .../eval/runs/latest`: 404 `"domain not found"` if not owned; 404 `"no eval runs yet"` if owned but empty

- [ ] **Step 1: Write failing API tests**

Create `backend/tests/test_domain_eval_api.py` following auth/client patterns in `test_domain_retrieve_api.py` / `test_domains_api.py`. Core cases:

```python
def test_eval_case_crud_owner_scoped(client, auth_headers, other_headers, domain_id):
    # POST case → 200/201 with body
    # GET list includes case
    # other user GET → 404
    # DELETE → 204; list empty
    ...


def test_post_eval_sync_returns_scores(client, auth_headers, domain_id, monkeypatch):
    # create case with expected doc id
    # monkeypatch retrieve_domain on tvashtr.control_plane.domain_eval
    # POST /api/domains/{id}/eval → status completed, hit_at_k 1.0
    ...


def test_post_eval_empty_cases_422(client, auth_headers, domain_id):
    ...


def test_get_latest_run_404_when_none(client, auth_headers, domain_id):
    ...
```

Fill fixture names to match the repo.

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domain_eval_api.py -q`

Expected: FAIL (routes 404).

- [ ] **Step 3: Wire routes**

In `routers.py`, add request model + routes after the messages/retrieve block:

```python
class DomainEvalCaseCreate(BaseModel):
    question: str
    expected_answer: str | None = None
    expected_citation_doc_ids: list[str] = []
    expected_keywords: list[str] = []
    ordinal: int = 0
```

```python
@router.get("/api/domains/{domain_id}/eval/cases")
def get_domain_eval_cases(...):
    rows = list_eval_cases(owner_id, did)
    if rows is None:
        raise HTTPException(status_code=404, detail="domain not found")
    return {"cases": rows}


@router.post("/api/domains/{domain_id}/eval/cases")
def post_domain_eval_case(..., body: DomainEvalCaseCreate):
    try:
        return create_eval_case(
            owner_id,
            did,
            question=body.question,
            expected_answer=body.expected_answer,
            expected_citation_doc_ids=body.expected_citation_doc_ids,
            expected_keywords=body.expected_keywords,
            ordinal=body.ordinal,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail="domain not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.delete("/api/domains/{domain_id}/eval/cases/{case_id}", status_code=204)
def delete_domain_eval_case_route(...):
    # parse case_id UUID; if get_domain is None → 404 domain
    # if delete_eval_case False → 404 case not found
    return Response(status_code=204)


@router.get("/api/domains/{domain_id}/eval/runs/latest")
def get_domain_eval_latest(...):
    owned, run = latest_eval_run_for_owner(owner_id, did)
    if not owned:
        raise HTTPException(status_code=404, detail="domain not found")
    if run is None:
        raise HTTPException(status_code=404, detail="no eval runs yet")
    return run


@router.post("/api/domains/{domain_id}/eval")
def post_domain_eval(...):
    try:
        return run_domain_eval(owner_id, did)
    except LookupError as e:
        raise HTTPException(status_code=404, detail="domain not found") from e
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
```

Import helpers from `tvashtr.control_plane.domain_eval`. Reuse `_parse_domain_id` and `get_current_user` like other domain routes.

- [ ] **Step 4: Run API tests**

Run: `cd backend && uv run pytest tests/test_domain_eval_api.py tests/test_domain_eval_helpers.py tests/test_domain_eval_scoring.py tests/test_domain_eval_models.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/routers.py backend/tests/test_domain_eval_api.py
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 eval HTTP API (cases CRUD + sync run)

EOF
)"
```

---

### Task 6: Frontend API client

**Files:**
- Modify: `frontend/src/lib/api.ts` (after `askDomain`)
- Create: `frontend/src/lib/domainEval.test.ts`

**Interfaces:**
- Types: `DomainEvalCase`, `DomainEvalCaseCreate`, `DomainEvalPerCaseScore`, `DomainEvalScores`, `DomainEvalRun`
- Fns: `listDomainEvalCases`, `createDomainEvalCase`, `deleteDomainEvalCase`, `getLatestDomainEvalRun`, `runDomainEval`

- [ ] **Step 1: Write failing client tests**

Create `frontend/src/lib/domainEval.test.ts` mirroring `domainMessages.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "./api";

describe("domain eval client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("listDomainEvalCases hits GET eval/cases", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ cases: [] }), { status: 200 }),
    );
    const rows = await api.listDomainEvalCases("d1");
    expect(rows).toEqual([]);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases",
    );
  });

  it("createDomainEvalCase posts question", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          case_id: "c1",
          domain_id: "d1",
          question: "Q?",
          expected_answer: null,
          expected_citation_doc_ids: [],
          expected_keywords: ["refund"],
          ordinal: 0,
          created_at: "2026-09-15T00:00:00Z",
        }),
        { status: 200 },
      ),
    );
    const row = await api.createDomainEvalCase("d1", {
      question: "Q?",
      expected_keywords: ["refund"],
    });
    expect(row.case_id).toBe("c1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
  });

  it("runDomainEval posts /eval", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          run_id: "r1",
          domain_id: "d1",
          status: "completed",
          scores: { hit_at_k: 1, keyword_hit: 1, cases_total: 1, per_case: [] },
          error_message: null,
          created_at: "2026-09-15T00:00:00Z",
          completed_at: "2026-09-15T00:00:01Z",
        }),
        { status: 200 },
      ),
    );
    const run = await api.runDomainEval("d1");
    expect(run.status).toBe("completed");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain("/api/domains/d1/eval");
  });

  it("getLatestDomainEvalRun hits runs/latest", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ run_id: "r1", status: "completed", scores: null }), {
        status: 200,
      }),
    );
    await api.getLatestDomainEvalRun("d1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/runs/latest",
    );
  });

  it("deleteDomainEvalCase sends DELETE", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    await api.deleteDomainEvalCase("d1", "c1");
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toContain(
      "/api/domains/d1/eval/cases/c1",
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npm test -- src/lib/domainEval.test.ts`

Expected: FAIL (exports missing).

- [ ] **Step 3: Add client exports to `api.ts`**

```typescript
export interface DomainEvalCase {
  case_id: string;
  domain_id: string;
  question: string;
  expected_answer: string | null;
  expected_citation_doc_ids: string[];
  expected_keywords: string[];
  ordinal: number;
  created_at: string | null;
}

export interface DomainEvalCaseCreate {
  question: string;
  expected_answer?: string | null;
  expected_citation_doc_ids?: string[];
  expected_keywords?: string[];
  ordinal?: number;
}

export interface DomainEvalPerCaseScore {
  case_id: string;
  question: string;
  hit: boolean | null;
  keyword_hit: boolean | null;
  citation_doc_ids: string[];
  latency_ms: number | null;
  error: string | null;
}

export interface DomainEvalScores {
  cases_total: number;
  cases_scored_hit: number;
  cases_scored_keyword: number;
  hit_at_k: number | null;
  keyword_hit: number | null;
  top_k: number;
  retrieval_mode: string;
  per_case: DomainEvalPerCaseScore[];
}

export interface DomainEvalRun {
  run_id: string;
  domain_id: string;
  status: string;
  scores: DomainEvalScores | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export async function listDomainEvalCases(domainId: string): Promise<DomainEvalCase[]> {
  const data = await getJSON<{ cases: DomainEvalCase[] }>(
    `/api/domains/${domainId}/eval/cases`,
  );
  return data.cases;
}

export async function createDomainEvalCase(
  domainId: string,
  body: DomainEvalCaseCreate,
): Promise<DomainEvalCase> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/eval/cases`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST eval case -> ${res.status}`);
  return (await res.json()) as DomainEvalCase;
}

export async function deleteDomainEvalCase(domainId: string, caseId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/eval/cases/${caseId}`), {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE eval case -> ${res.status}`);
}

export async function getLatestDomainEvalRun(domainId: string): Promise<DomainEvalRun> {
  return getJSON<DomainEvalRun>(`/api/domains/${domainId}/eval/runs/latest`);
}

export async function runDomainEval(domainId: string): Promise<DomainEvalRun> {
  const res = await fetch(apiUrl(`/api/domains/${domainId}/eval`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let detail = `POST eval -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as DomainEvalRun;
}
```

- [ ] **Step 4: Run client tests**

Run: `cd frontend && npm test -- src/lib/domainEval.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/domainEval.test.ts
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 frontend eval API client

EOF
)"
```

---

### Task 7: Eval tab UI (`DomainEvalPanel` + `DomainsPage`)

**Files:**
- Create: `frontend/src/components/DomainEvalPanel.tsx`
- Create: `frontend/src/components/DomainEvalPanel.test.tsx`
- Modify: `frontend/src/components/DomainsPage.tsx`
- Modify: `frontend/src/components/DomainsPage.test.tsx`

**Interfaces:**
- `DomainEvalPanel({ domainId: string })`
- Extend `DetailTab` with `"eval"`
- Tab order: **Overview | Documents | Chat | Eval | Config**
- Panel: load cases + latest run on mount; form (question required; optional keywords comma-separated; optional expected doc ids comma-separated); Add; Delete per row; Run eval; show `hit_at_k` / `keyword_hit` as percents or `—`

- [ ] **Step 1: Write failing panel test**

Create `frontend/src/components/DomainEvalPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import * as api from "../lib/api";
import { DomainEvalPanel } from "./DomainEvalPanel";

vi.mock("../lib/api", () => ({
  listDomainEvalCases: vi.fn(),
  createDomainEvalCase: vi.fn(),
  deleteDomainEvalCase: vi.fn(),
  getLatestDomainEvalRun: vi.fn(),
  runDomainEval: vi.fn(),
}));

const m = api as unknown as {
  listDomainEvalCases: Mock;
  createDomainEvalCase: Mock;
  deleteDomainEvalCase: Mock;
  getLatestDomainEvalRun: Mock;
  runDomainEval: Mock;
};

describe("DomainEvalPanel", () => {
  beforeEach(() => {
    m.listDomainEvalCases.mockResolvedValue([]);
    m.getLatestDomainEvalRun.mockRejectedValue(new Error("no eval runs yet"));
    m.createDomainEvalCase.mockResolvedValue({
      case_id: "c1",
      domain_id: "d1",
      question: "Refund window?",
      expected_answer: null,
      expected_citation_doc_ids: [],
      expected_keywords: ["refund"],
      ordinal: 0,
      created_at: "2026-09-15T00:00:00Z",
    });
    m.runDomainEval.mockResolvedValue({
      run_id: "r1",
      domain_id: "d1",
      status: "completed",
      scores: {
        cases_total: 1,
        cases_scored_hit: 0,
        cases_scored_keyword: 1,
        hit_at_k: null,
        keyword_hit: 1,
        top_k: 8,
        retrieval_mode: "dense",
        per_case: [],
      },
      error_message: null,
      created_at: "2026-09-15T00:00:00Z",
      completed_at: "2026-09-15T00:00:01Z",
    });
  });

  it("adds a case and runs eval", async () => {
    const user = userEvent.setup();
    render(<DomainEvalPanel domainId="d1" />);
    await waitFor(() => expect(m.listDomainEvalCases).toHaveBeenCalledWith("d1"));
    await user.type(screen.getByLabelText(/Question/i), "Refund window?");
    await user.type(screen.getByLabelText(/Keywords/i), "refund");
    await user.click(screen.getByRole("button", { name: /Add case/i }));
    await waitFor(() => expect(m.createDomainEvalCase).toHaveBeenCalled());
    m.listDomainEvalCases.mockResolvedValue([
      {
        case_id: "c1",
        domain_id: "d1",
        question: "Refund window?",
        expected_answer: null,
        expected_citation_doc_ids: [],
        expected_keywords: ["refund"],
        ordinal: 0,
        created_at: "2026-09-15T00:00:00Z",
      },
    ]);
    await user.click(screen.getByRole("button", { name: /Run eval/i }));
    await waitFor(() => expect(m.runDomainEval).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText(/keyword/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run panel test (fail)**

Run: `cd frontend && npm test -- src/components/DomainEvalPanel.test.tsx`

Expected: FAIL (component missing).

- [ ] **Step 3: Implement `DomainEvalPanel` + wire tab**

`DomainEvalPanel.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";

import {
  createDomainEvalCase,
  deleteDomainEvalCase,
  getLatestDomainEvalRun,
  listDomainEvalCases,
  runDomainEval,
  type DomainEvalCase,
  type DomainEvalRun,
} from "../lib/api";

function fmtScore(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

export function DomainEvalPanel({ domainId }: { domainId: string }) {
  const [cases, setCases] = useState<DomainEvalCase[]>([]);
  const [latest, setLatest] = useState<DomainEvalRun | null>(null);
  const [question, setQuestion] = useState("");
  const [keywords, setKeywords] = useState("");
  const [docIds, setDocIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const rows = await listDomainEvalCases(domainId);
    setCases(rows);
    try {
      setLatest(await getLatestDomainEvalRun(domainId));
    } catch {
      setLatest(null);
    }
  }, [domainId]);

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
  }, [refresh]);

  return (
    <section className="tv-domains__panel" aria-label="Eval">
      <p className="tv-muted">
        Golden questions scored with deterministic hit@k and keyword_hit via retrieve (no LLM
        judge). Cap 50 cases.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="tv-domains__eval-scores" aria-label="Latest scores">
        <div>hit@k: {fmtScore(latest?.scores?.hit_at_k)}</div>
        <div>keyword_hit: {fmtScore(latest?.scores?.keyword_hit)}</div>
        <div>status: {latest?.status ?? "—"}</div>
      </div>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await createDomainEvalCase(domainId, {
              question,
              expected_keywords: keywords
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
              expected_citation_doc_ids: docIds
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
            setQuestion("");
            setKeywords("");
            setDocIds("");
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Question
          <input
            aria-label="Question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
          />
        </label>
        <label>
          Keywords
          <input
            aria-label="Keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="comma-separated"
          />
        </label>
        <label>
          Expected document IDs
          <input
            aria-label="Expected document IDs"
            value={docIds}
            onChange={(e) => setDocIds(e.target.value)}
            placeholder="comma-separated UUIDs"
          />
        </label>
        <button type="submit" disabled={busy}>
          Add case
        </button>
      </form>
      <ul aria-label="Eval cases">
        {cases.map((c) => (
          <li key={c.case_id}>
            <span>{c.question}</span>
            <button
              type="button"
              aria-label={`Delete case ${c.question}`}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await deleteDomainEvalCase(domainId, c.case_id);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy || cases.length === 0}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const run = await runDomainEval(domainId);
            setLatest(run);
            await refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Run eval
      </button>
      {latest?.scores?.per_case && latest.scores.per_case.length > 0 && (
        <table aria-label="Per-case scores">
          <thead>
            <tr>
              <th>Question</th>
              <th>hit</th>
              <th>keyword</th>
              <th>error</th>
            </tr>
          </thead>
          <tbody>
            {latest.scores.per_case.map((row) => (
              <tr key={row.case_id}>
                <td>{row.question}</td>
                <td>{row.hit == null ? "—" : row.hit ? "yes" : "no"}</td>
                <td>{row.keyword_hit == null ? "—" : row.keyword_hit ? "yes" : "no"}</td>
                <td>{row.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

In `DomainsPage.tsx`:

- Change `type DetailTab = "overview" | "documents" | "chat" | "config" | "eval";`
- Import `DomainEvalPanel`
- Add Eval tab button after Chat, before Config
- When `tab === "eval" && detail`, render `<DomainEvalPanel domainId={detail.domain_id} />`

Update `DomainsPage.test.tsx` mock to include the five new API fns (default resolved/rejected as needed), and assert:

```tsx
expect(screen.getByRole("tab", { name: /Eval/i })).toBeTruthy();
```

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend && npm test -- \
  src/components/DomainEvalPanel.test.tsx \
  src/components/DomainsPage.test.tsx \
  src/lib/domainEval.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DomainEvalPanel.tsx \
  frontend/src/components/DomainEvalPanel.test.tsx \
  frontend/src/components/DomainsPage.tsx \
  frontend/src/components/DomainsPage.test.tsx
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 6 Eval tab + DomainEvalPanel (web+Desktop)

EOF
)"
```

---

### Task 8: Regression gate + YAGNI grep

**Files:** none new (verification only)

- [ ] **Step 1: Backend suite for domains + eval**

```bash
cd backend && uv run pytest \
  tests/test_domain_eval_models.py \
  tests/test_domain_eval_scoring.py \
  tests/test_domain_eval_helpers.py \
  tests/test_domain_eval_api.py \
  tests/test_domain_retrieve_helper.py \
  tests/test_domain_retrieve_fusion.py \
  tests/test_domain_ask_helpers.py \
  tests/test_domains_api.py \
  -q
```

Expected: PASS

- [ ] **Step 2: Frontend suite**

```bash
cd frontend && npm test -- \
  src/lib/domainEval.test.ts \
  src/components/DomainEvalPanel.test.tsx \
  src/components/DomainsPage.test.tsx \
  src/components/DomainConfigForm.test.tsx
```

Expected: PASS

- [ ] **Step 3: Confirm reuse (no duplicate RAG)**

```bash
rg -n "retrieve_domain|ask_domain|retrieve_for_query" \
  backend/tvashtr/control_plane/domain_eval.py
```

Expected: `run_domain_eval` calls **`retrieve_domain` only**; no local embed/SQL retrieve; no `ask_domain`.

- [ ] **Step 4: YAGNI grep (Phase 7 / deferred must stay absent)**

```bash
rg -n "GraphRAG|LLM-as-judge|llm_as_judge|auto-tun|A/B compare|cohere|judge_model" \
  backend/tvashtr/control_plane/domain_eval.py \
  frontend/src/components/DomainEvalPanel.tsx || true
```

Expected: no GraphRAG / judge / auto-tune / A/B product UI.

- [ ] **Step 5: Final fixup commit only if needed**

```bash
GIT_AUTHOR_NAME="Tvashtr Ted" GIT_AUTHOR_EMAIL="tvashtr-ted@local" \
GIT_COMMITTER_NAME="Tvashtr Ted" GIT_COMMITTER_EMAIL="tvashtr-ted@local" \
git commit -m "$(cat <<'EOF'
test(domains): Phase 6 regression gate green

EOF
)"
```

---

## How operators use Eval

1. Open a Domain → **Eval** tab.
2. Add golden cases: question + optional expected document UUIDs (from Documents) + optional keywords.
3. Click **Run eval** (sync; needs embedding BYOK if retrieval mode is dense/hybrid — same as retrieve).
4. Read **hit@k** and **keyword_hit**; inspect per-case table. Tune chunking/retrieval under **Config**, re-run.

`expected_answer` may be stored for humans but is **not** scored in Phase 6.

---

## Self-review checklist (Phase 6 spec → tasks)

| Spec / locked decision | Task(s) |
|------------------------|---------|
| Golden sets in DB (`domain_eval_cases` + `domain_eval_runs`) | Task 1 |
| Deterministic hit@k + keyword_hit (no LLM judge) | Task 2, 4 |
| Owner-scoped CRUD + sync `POST .../eval` (cap 50) | Tasks 3–5 |
| Reuse `retrieve_domain` (not duplicate RAG; no ask pollution) | Task 4 + Task 8 grep |
| Eval tab UI shared React (web+Desktop) | Task 7 |
| YAGNI: no GraphRAG / A/B UI / paid judge / auto-tune | Global Constraints + Task 8 |
| Branch `feat/polyrag-domains-phase6` from phase5 `79bfdc6` | Global Constraints |
| Alembic `0037` revises `0036` | Task 1 |

### Plan completeness notes

- **No TBDs** for table names, metric defs, API paths, cap (50), sync-only, retrieve-only eval path, scores JSON shape.
- **`expected_answer` stored, unscored in v1** — documented to avoid accidental `ask_domain` side effects.
- **MCP / canvas / hybrid retrieve unchanged** — eval is a separate owner API + UI.
- **Phase 7 deferred:** GraphRAG, multimodal, agentic correction, LLM judges — do not stub.

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
