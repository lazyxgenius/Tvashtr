# PolyRAG Domains Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 7 stretch as a **thin, real vertical slice** — **graph-lite mention expansion** on the shared retrieve path when `config.retrieval.graph.enabled`, plus a Config UI toggle and tests. Not full Microsoft GraphRAG, not ColPali, not multimodal OCR, not agentic LLM correction loops.

**Architecture:** After dense / lexical / hybrid (+ optional rerank) produce a ranked seed list inside `retrieve_for_query`, optionally run an **on-the-fly** mention pass: extract simple capitalized / noun-ish tokens from seed chunk texts (pure regex helper, spaCy-free), find other **ready** chunks in the same domain that share those tokens, and append up to `GRAPH_EXPAND_MAX` neighbors (deduped by `chunk_id`). **No Neo4j. No `domain_chunk_mentions` table. No ingest-time entity graph.** Config knob `retrieval.graph: { enabled: bool }` defaults to `{ enabled: false }`. DomainConfigForm checkbox surfaces the knob. Chat / Query-domain / HTTP retrieve / MCP pick it up automatically via the shared path.

**Tech Stack:** FastAPI + SQLAlchemy 2 + pytest (backend; **no new Alembic revision**); React 19 + Vitest + Testing Library (frontend shared by web + Electron Desktop). Reuse `retrieve_for_query`, `coerce_rerank_config` patterns, `validate_domain_config`, `default_config_for_template`, `DomainConfigForm`, citation shape from Phase 3/5.

## Global Constraints

- Spec source of truth: `docs/superpowers/specs/2026-09-15-polyrag-domains-tvashtr-design.md` — **Phase 7 stretch only**, scoped down to the thin slice below (not the full Phase 7 vision string).
- **Branch base:** Implement on `feat/polyrag-domains-phase7` created from Phase 6 tip **`0e78979`**. Do not implement on main or an unrelated branch.
- Surfaces: **Web and Desktop parity via shared React** — Desktop continues same-origin `/api` proxy to Fly; no Desktop-only graph backend.
- **Shared retrieve path (locked):** Chat (`ask_domain`), Query-domain node, HTTP `POST /retrieve` (`retrieve_domain`), MCP `domain_ask` / `domain_retrieve` must all pick up graph-lite via **`retrieve_for_query` only**. Do **not** add a second RAG loop or new MCP tools.
- **Config (locked):** optional `retrieval.graph` object `{ enabled: bool }`. Default **`{ enabled: false }`** in `default_config_for_template`. Missing `graph` remains valid (coerce at retrieve time → disabled) so existing domains keep working. `validate_domain_config` on PATCH: if `retrieval.graph` present, must be an object with only key `enabled` (bool). Do **not** put `graph` at the config top level.
- **Mention extraction (locked — spaCy-free):** pure helper `extract_mentions(text: str) -> list[str]`:
  - Regex for runs of CapitalizedWord tokens and/or 2+ letter ALLCAPS acronyms (e.g. `OpenAI`, `GDPR`, `Refund Policy` → tokens).
  - Normalize: strip punctuation edges; drop length < 2; drop a small English stopword set (`The`, `A`, `An`, `And`, `Or`, `Of`, `In`, `On`, `For`, `To`, `Is`, `Are`, …).
  - Dedupe preserving order; return at most `GRAPH_MENTION_CAP = 12` mentions per seed set.
- **Expansion (locked — on-the-fly, Postgres-only):** `expand_chunks_by_shared_mentions(domain_id, seed_chunks, *, max_expand: int = GRAPH_EXPAND_MAX) -> list[dict]`:
  - Collect mentions from all seed `text` fields via `extract_mentions`.
  - If no mentions or empty seeds → return `[]`.
  - Query ready chunks (`DomainDocument.ingest_status == "ready"`) in the same domain whose `text` contains any mention as a **case-sensitive substring** (bound params; `OR` of limited mentions). Exclude seed `chunk_id`s.
  - Rank candidates by count of distinct shared mentions (desc), then by `ordinal` / `chunk_id` for stability.
  - Return up to `max_expand` neighbor dicts in the same shape as other retrieve hits (`chunk_id`, `document_id`, `filename`, `ordinal`, `text`, `score`).
  - Neighbor `score`: `0.5 * (shared_count / max(1, len(mentions)))` (finite float) — deliberately below typical dense/RRF scores so seeds stay first when callers sort, but still present for citations.
- **Dispatcher hook (locked):** In `retrieve_for_query`, after fusion + `apply_rerank` and after slicing seeds to `k_final`:
  - If `coerce_graph_config(...).enabled` is false → return seeds unchanged (today's behavior).
  - If enabled → `neighbors = expand_chunks_by_shared_mentions(domain_id, seeds, max_expand=GRAPH_EXPAND_MAX)`; return `seeds + neighbors` (already deduped inside expand). **Final length may be `top_k + GRAPH_EXPAND_MAX`** (document in Config hint). Do not re-cut neighbors away.
- **Constants (locked):** `GRAPH_EXPAND_MAX = 4`, `GRAPH_MENTION_CAP = 12`, `DEFAULT_GRAPH = {"enabled": False}`.
- **Citations (locked):** unchanged Phase 3 shape. Extra neighbor chunks become normal citations via existing `citations_from_chunks`.
- **YAGNI / Non-goals (explicit deferrals — do not stub):**
  - Full Microsoft GraphRAG / Leiden communities / entity summary nodes
  - Neo4j / any external graph DB
  - `domain_chunk_mentions` table or ingest-time entity pipeline
  - ColPali / vision embeddings / real OCR
  - Image upload as first-class doc type (png/jpg with empty text) — deferred; keep `ALLOWED_EXTENSIONS` as today
  - Agentic correction loops / LLM judge / rule-based query rewrite on eval miss
  - New MCP tools, canvas node fields, eval metric changes, paid rerank
- Test runners: `cd backend && uv run pytest <path> -q`; `cd frontend && npm test -- <path>`.
- Git: author via env only (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`); **never** `git config`.

---

## Thin slice locked (overnight)

| Ships | Does not ship |
|-------|----------------|
| `retrieval.graph.enabled` knob (default false) | Neo4j / full GraphRAG |
| Regex mention extract + on-the-fly neighbor expand in `retrieve_for_query` | Mentions table / ingest graph build |
| Config UI checkbox + hint | ColPali / OCR / image docs |
| Unit + retrieve fusion tests + ConfigForm test | Agentic rewrite / LLM judge |
| Automatic pickup by Chat / retrieve / MCP via shared path | New MCP tools |

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Modify** `backend/tvashtr/control_plane/domain_retrieve.py` | `DEFAULT_GRAPH`, `GRAPH_EXPAND_MAX`, `GRAPH_MENTION_CAP`, `coerce_graph_config`, `extract_mentions`, `rank_mention_neighbors`, `expand_chunks_by_shared_mentions`, `graph=` hook in `retrieve_for_query`. |
| **Create** `backend/tests/test_domain_retrieve_graph.py` | Unit tests for extract / expand / coerce / dispatcher graph hook (mocked SQL for expand where needed). |
| **Modify** `backend/tests/test_domain_retrieve_fusion.py` | Assert graph-disabled path unchanged; optional coerce smoke if not duplicated. |
| **Modify** `backend/tvashtr/control_plane/domains.py` | Default retrieval includes `graph: { enabled: false }`; validate `retrieval.graph` object. |
| **Modify** `backend/tests/test_domains_helpers.py` / `test_domains_api.py` | Defaults include graph; PATCH `graph.enabled` OK; invalid graph 422; top-level `graph` still 422 if such a test pattern exists for rerank. |
| **Modify** `backend/tvashtr/control_plane/domain_ask.py` | Pass graph config into `retrieve_for_query` (same place as mode/rerank). |
| **Modify** `frontend/src/lib/domains.ts` | Optional `graph?: { enabled: boolean }` on retrieval. |
| **Modify** `frontend/src/components/DomainConfigForm.tsx` | Graph-lite checkbox + short YAGNI hint. |
| **Modify** `frontend/src/components/DomainConfigForm.test.tsx` | Toggle saves `retrieval.graph.enabled`. |

**Out of scope (do not create for Phase 7):** Alembic migrations, Neo4j, ColPali, image ALLOWED_EXTENSIONS, eval rewrite loops, new MCP tools, canvas changes, `domain_chunk_mentions`.

---

### Task 1: Pure mention helpers + coerce_graph_config

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_retrieve.py`
- Test: `backend/tests/test_domain_retrieve_graph.py`

**Interfaces:**
- Produces:
  - `GRAPH_EXPAND_MAX = 4`
  - `GRAPH_MENTION_CAP = 12`
  - `DEFAULT_GRAPH = {"enabled": False}`
  - `coerce_graph_config(config: dict | None) -> dict` → `{enabled: bool}`
  - `extract_mentions(text: str) -> list[str]`
  - (expand implemented in Task 2)

- [ ] **Step 1: Write the failing unit tests**

Create `backend/tests/test_domain_retrieve_graph.py`:

```python
"""Phase 7 — graph-lite mention extract + coerce."""

from tvashtr.control_plane.domain_retrieve import (
    DEFAULT_GRAPH,
    GRAPH_EXPAND_MAX,
    GRAPH_MENTION_CAP,
    coerce_graph_config,
    extract_mentions,
)


def test_constants():
    assert GRAPH_EXPAND_MAX == 4
    assert GRAPH_MENTION_CAP == 12
    assert DEFAULT_GRAPH == {"enabled": False}


def test_coerce_graph_config_defaults_and_bool():
    assert coerce_graph_config(None) == {"enabled": False}
    assert coerce_graph_config({}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": {}}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": {"graph": {"enabled": True}}}) == {
        "enabled": True
    }
    assert coerce_graph_config({"retrieval": {"graph": "nope"}}) == {"enabled": False}
    assert coerce_graph_config({"retrieval": "nope"}) == {"enabled": False}


def test_extract_mentions_capitalized_and_acronyms():
    text = "The GDPR policy at Acme Corp covers OpenAI usage."
    mentions = extract_mentions(text)
    assert "GDPR" in mentions
    assert "Acme" in mentions or "Acme Corp" in mentions or "Corp" in mentions
    assert "OpenAI" in mentions
    assert "The" not in mentions
    assert all(len(m) >= 2 for m in mentions)


def test_extract_mentions_empty_and_cap():
    assert extract_mentions("") == []
    assert extract_mentions("lowercase only words here") == []
    huge = " ".join(f"Token{i}" for i in range(40))
    assert len(extract_mentions(huge)) <= GRAPH_MENTION_CAP
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_graph.py -q`

Expected: FAIL (symbols missing).

- [ ] **Step 3: Implement coerce + extract_mentions**

Append to `domain_retrieve.py` (near other coerce helpers):

```python
import re

GRAPH_EXPAND_MAX = 4
GRAPH_MENTION_CAP = 12
DEFAULT_GRAPH: dict = {"enabled": False}

_MENTION_STOP = frozenset(
    {
        "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "is", "are",
        "was", "were", "be", "by", "as", "at", "from", "with", "this", "that",
        "it", "its", "we", "you", "they", "he", "she", "not", "but", "if",
    }
)

# Capitalized word runs + ALLCAPS acronyms (len>=2)
_MENTION_RE = re.compile(
    r"\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b|\b(?:[A-Z]{2,})\b"
)


def coerce_graph_config(config: dict | None) -> dict:
    raw = (config or {}).get("retrieval") or {}
    block = raw.get("graph") if isinstance(raw, dict) else None
    enabled = False
    if isinstance(block, dict):
        enabled = bool(block.get("enabled"))
    return {"enabled": enabled}


def extract_mentions(text: str) -> list[str]:
    if not text or not str(text).strip():
        return []
    out: list[str] = []
    seen: set[str] = set()
    for m in _MENTION_RE.findall(text):
        tok = m.strip()
        if len(tok) < 2:
            continue
        # Drop if entire match is stopwords (e.g. "The")
        parts = tok.split()
        if all(p.lower() in _MENTION_STOP for p in parts):
            continue
        # Prefer splitting multi-word runs into tokens for matching breadth
        for part in parts:
            if len(part) < 2 or part.lower() in _MENTION_STOP:
                continue
            if part not in seen:
                seen.add(part)
                out.append(part)
            if len(out) >= GRAPH_MENTION_CAP:
                return out
    return out
```

Implementers may tweak the regex slightly if tests need multi-word retention — prefer **single tokens** for substring matching breadth (locked preference above).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_graph.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tests/test_domain_retrieve_graph.py
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 7 graph-lite mention extract + coerce_graph_config

EOF
)"
```

---

### Task 2: `expand_chunks_by_shared_mentions` + `retrieve_for_query` hook

**Files:**
- Modify: `backend/tvashtr/control_plane/domain_retrieve.py`
- Modify: `backend/tvashtr/control_plane/domain_ask.py`
- Modify: `backend/tests/test_domain_retrieve_graph.py`
- Modify: `backend/tests/test_domain_retrieve_fusion.py` (smoke: disabled unchanged)

**Interfaces:**
- Produces:
  - `rank_mention_neighbors(candidates, mentions, *, max_expand) -> list[dict]` (pure; used by expand)
  - `expand_chunks_by_shared_mentions(domain_id, seed_chunks, *, max_expand: int = GRAPH_EXPAND_MAX) -> list[dict]`
  - `retrieve_for_query(..., graph: dict | None = None)` — when `graph.enabled`, append neighbors after seed slice
- `ask_domain` / `retrieve_domain`: `graph_cfg = coerce_graph_config(cfg)` and pass `graph=graph_cfg` into `retrieve_for_query`

- [ ] **Step 1: Write failing expand + dispatcher tests**

Append to `backend/tests/test_domain_retrieve_graph.py`:

```python
import uuid
from unittest.mock import patch

from tvashtr.control_plane.domain_retrieve import (
    expand_chunks_by_shared_mentions,
    retrieve_for_query,
)


def test_expand_returns_empty_without_mentions_or_seeds():
    did = uuid.uuid4()
    assert expand_chunks_by_shared_mentions(did, []) == []
    assert expand_chunks_by_shared_mentions(
        did, [{"chunk_id": "c1", "text": "lowercase only"}]
    ) == []


def test_rank_mention_neighbors_orders_and_caps():
    """Pure ranking helper (extract from expand if needed for TDD without DB)."""
    from tvashtr.control_plane.domain_retrieve import rank_mention_neighbors

    mentions = ["Acme"]
    candidates = [
        {
            "chunk_id": "n1",
            "document_id": "d2",
            "filename": "b.md",
            "ordinal": 1,
            "text": "Acme shipping and Acme billing",
        },
        {
            "chunk_id": "n2",
            "document_id": "d3",
            "filename": "c.md",
            "ordinal": 0,
            "text": "Other Acme note",
        },
        {
            "chunk_id": "n3",
            "document_id": "d4",
            "filename": "d.md",
            "ordinal": 3,
            "text": "Unrelated",
        },
    ]
    out = rank_mention_neighbors(candidates, mentions, max_expand=1)
    assert len(out) == 1
    assert out[0]["chunk_id"] == "n1"
    assert out[0]["score"] is not None


def test_retrieve_for_query_graph_disabled_unchanged():
    did = uuid.uuid4()
    seed = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "Acme",
            "score": 0.9,
        }
    ]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=seed,
    ), patch(
        "tvashtr.control_plane.domain_retrieve.expand_chunks_by_shared_mentions"
    ) as exp:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1] * 8,
            top_k=1,
            mode="dense",
            graph={"enabled": False},
        )
        assert out == seed[:1]
        exp.assert_not_called()


def test_retrieve_for_query_graph_enabled_appends_neighbors():
    did = uuid.uuid4()
    seed = [
        {
            "chunk_id": "c1",
            "document_id": "d1",
            "filename": "a.md",
            "ordinal": 0,
            "text": "Acme",
            "score": 0.9,
        }
    ]
    neighbor = [
        {
            "chunk_id": "c2",
            "document_id": "d2",
            "filename": "b.md",
            "ordinal": 1,
            "text": "Acme billing",
            "score": 0.25,
        }
    ]
    with patch(
        "tvashtr.control_plane.domain_retrieve.retrieve_domain_chunks",
        return_value=seed,
    ), patch(
        "tvashtr.control_plane.domain_retrieve.expand_chunks_by_shared_mentions",
        return_value=neighbor,
    ) as exp:
        out = retrieve_for_query(
            did,
            "q",
            query_embedding=[0.1] * 8,
            top_k=1,
            mode="dense",
            graph={"enabled": True},
        )
        assert [c["chunk_id"] for c in out] == ["c1", "c2"]
        exp.assert_called_once()
```

Use `rank_mention_neighbors` for pure ranking assertions; keep DB-backed expand covered via a thin mocked `session_scope` test only if time allows (optional overnight).

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domain_retrieve_graph.py -q`

Expected: FAIL (`expand_chunks_by_shared_mentions` / graph kwarg missing).

- [ ] **Step 3: Implement expand + wire dispatcher + ask path**

Also export a pure `rank_mention_neighbors(candidates: list[dict], mentions: list[str], *, max_expand: int) -> list[dict]` that counts shared mentions per candidate, drops `shared==0`, sorts by shared desc then ordinal/chunk_id, assigns neighbor scores, and slices to `max_expand`. `expand_chunks_by_shared_mentions` fetches candidates then calls it.

Suggested expand implementation sketch:

```python
def expand_chunks_by_shared_mentions(
    domain_id: uuid.UUID,
    seed_chunks: list[dict],
    *,
    max_expand: int = GRAPH_EXPAND_MAX,
) -> list[dict]:
    try:
        cap = int(max_expand)
    except (TypeError, ValueError):
        cap = GRAPH_EXPAND_MAX
    cap = max(0, min(cap, GRAPH_EXPAND_MAX))
    if cap == 0 or not seed_chunks:
        return []
    mentions: list[str] = []
    seen_m: set[str] = set()
    for s in seed_chunks:
        for m in extract_mentions(s.get("text") or ""):
            if m not in seen_m:
                seen_m.add(m)
                mentions.append(m)
            if len(mentions) >= GRAPH_MENTION_CAP:
                break
        if len(mentions) >= GRAPH_MENTION_CAP:
            break
    if not mentions:
        return []
    seed_ids = {str(s.get("chunk_id") or "") for s in seed_chunks}
    # SQL: ready chunks in domain; filter in Python for shared count to keep SQL simple
    # OR use OR of DomainChunk.text.contains(m) for each mention (bound), limit 50
    with session_scope() as session:
        # Build OR of contains; limit fetch to e.g. 50 rows
        ...
        # For each candidate not in seed_ids, shared = count of mentions in text
        # Sort by shared desc; take cap; assign score
```

In `retrieve_for_query`, add `graph: dict | None = None` parameter. After `fused = apply_rerank(...); seeds = fused[:k_final]`:

```python
    g = graph if isinstance(graph, dict) else {}
    if bool(g.get("enabled")):
        neighbors = expand_chunks_by_shared_mentions(
            domain_id, seeds, max_expand=GRAPH_EXPAND_MAX
        )
        return seeds + neighbors
    return seeds
```

In `domain_ask.py` (`ask_domain` and `retrieve_domain`), next to rerank:

```python
from tvashtr.control_plane.domain_retrieve import coerce_graph_config  # add import

graph_cfg = coerce_graph_config(cfg)
chunks = retrieve_for_query(
    ...,
    rerank=rerank_cfg,
    graph=graph_cfg,
)
```

- [ ] **Step 4: Run graph + fusion tests**

```bash
cd backend && uv run pytest \
  tests/test_domain_retrieve_graph.py \
  tests/test_domain_retrieve_fusion.py \
  tests/test_domain_retrieve_helper.py \
  -q
```

Expected: PASS (update any `retrieve_for_query` patches that break on new kwarg — kwargs are optional).

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/control_plane/domain_ask.py \
  backend/tests/test_domain_retrieve_graph.py \
  backend/tests/test_domain_retrieve_fusion.py \
  backend/tests/test_domain_retrieve_helper.py
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 7 on-the-fly mention expansion in retrieve_for_query

EOF
)"
```

---

### Task 3: Config defaults + PATCH validation

**Files:**
- Modify: `backend/tvashtr/control_plane/domains.py`
- Modify: `backend/tests/test_domains_helpers.py` and/or `backend/tests/test_domains_api.py`

**Interfaces:**
- `default_config_for_template` retrieval block gains `"graph": {"enabled": False}`
- `validate_domain_config`: if `retrieval.graph` is not None:
  - must be `dict`
  - allowed keys only `{"enabled"}`
  - `enabled` if present must be `bool`
- Unknown top-level `graph` key continues to fail via existing unknown-key rules if present; do not invent top-level `graph`

- [ ] **Step 1: Write / extend failing validation tests**

Mirror Phase 5 rerank tests:

```python
def test_default_config_includes_graph_disabled():
    cfg = default_config_for_template("blank")
    assert cfg["retrieval"]["graph"] == {"enabled": False}


def test_validate_accepts_graph_enabled():
    cfg = default_config_for_template("blank")
    cfg["retrieval"]["graph"] = {"enabled": True}
    validate_domain_config(cfg)  # no raise


def test_validate_rejects_graph_non_object():
    cfg = default_config_for_template("blank")
    cfg["retrieval"]["graph"] = True
    with pytest.raises(ValueError, match="graph"):
        validate_domain_config(cfg)


def test_validate_rejects_graph_unknown_keys():
    cfg = default_config_for_template("blank")
    cfg["retrieval"]["graph"] = {"enabled": True, "neo4j": "x"}
    with pytest.raises(ValueError, match="graph"):
        validate_domain_config(cfg)
```

API: PATCH domain with `retrieval.graph.enabled: true` → 200; invalid → 422.

- [ ] **Step 2: Run to verify fail**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py -q -k "graph or default_config or validate"`

Expected: FAIL on missing graph default / validation.

- [ ] **Step 3: Implement defaults + validation**

In `default_config_for_template` retrieval dict, add alongside rerank:

```python
"graph": {"enabled": False},
```

In `validate_domain_config`, after the rerank block:

```python
    graph = retrieval.get("graph")
    if graph is not None:
        if not isinstance(graph, dict):
            raise ValueError("domain config.retrieval.graph must be an object")
        extra = set(graph) - {"enabled"}
        if extra:
            raise ValueError(
                f"domain config.retrieval.graph has unknown keys: {sorted(extra)}"
            )
        if "enabled" in graph and not isinstance(graph["enabled"], bool):
            raise ValueError("domain config.retrieval.graph.enabled must be a boolean")
```

- [ ] **Step 4: Run domain config tests**

Run: `cd backend && uv run pytest tests/test_domains_helpers.py tests/test_domains_api.py -q`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/tvashtr/control_plane/domains.py \
  backend/tests/test_domains_helpers.py \
  backend/tests/test_domains_api.py
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 7 retrieval.graph config default + PATCH validation

EOF
)"
```

---

### Task 4: Config UI toggle (shared React)

**Files:**
- Modify: `frontend/src/lib/domains.ts`
- Modify: `frontend/src/components/DomainConfigForm.tsx`
- Modify: `frontend/src/components/DomainConfigForm.test.tsx`

**Interfaces:**
- `DomainGraphConfig { enabled: boolean }`
- `DomainConfig.retrieval.graph?: DomainGraphConfig`
- Form: checkbox **Graph-lite mention expansion** (`aria-label="Graph-lite mention expansion"`), hint: *When enabled, retrieve may append up to 4 neighbor chunks that share capitalized mentions with the top hits. No Neo4j / no entity ingest. Default off.*
- `normalizeConfig` / form state: ensure `graph: { enabled: Boolean(cfg.retrieval.graph?.enabled) }` when saving from form mode

- [ ] **Step 1: Write failing UI test**

In `DomainConfigForm.test.tsx`, add:

```tsx
it("toggles graph-lite mention expansion into saved config", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <DomainConfigForm
      domainId="d1"
      initialConfig={/* blank-like config with graph.enabled false */}
      onSave={onSave}
    />,
  );
  const box = screen.getByRole("checkbox", { name: /Graph-lite mention expansion/i });
  expect(box).not.toBeChecked();
  await user.click(box);
  await user.click(screen.getByRole("button", { name: /Save/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const saved = onSave.mock.calls[0][0];
  expect(saved.retrieval.graph.enabled).toBe(true);
});
```

Adapt props to match the real `DomainConfigForm` signature used in Phase 5 tests.

- [ ] **Step 2: Run to verify fail**

Run: `cd frontend && npm test -- src/components/DomainConfigForm.test.tsx`

Expected: FAIL (checkbox missing).

- [ ] **Step 3: Add type + checkbox**

`domains.ts`:

```typescript
export interface DomainGraphConfig {
  enabled: boolean;
}

// on DomainConfig.retrieval:
graph?: DomainGraphConfig;
```

In `DomainConfigForm.tsx`, after rerank block, add checkbox bound to `cfg.retrieval.graph?.enabled`, writing:

```typescript
retrieval: {
  ...cfg.retrieval,
  graph: { enabled: e.target.checked },
}
```

Ensure JSON mode round-trips `graph` without stripping (spread existing retrieval).

- [ ] **Step 4: Run frontend tests**

```bash
cd frontend && npm test -- src/components/DomainConfigForm.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/domains.ts \
  frontend/src/components/DomainConfigForm.tsx \
  frontend/src/components/DomainConfigForm.test.tsx
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
feat(domains): Phase 7 Config UI toggle for graph-lite expansion

EOF
)"
```

---

### Task 5: Regression gate + YAGNI grep

**Files:** none new (verification only)

- [ ] **Step 1: Backend suite**

```bash
cd backend && uv run pytest \
  tests/test_domain_retrieve_graph.py \
  tests/test_domain_retrieve_fusion.py \
  tests/test_domain_retrieve_helper.py \
  tests/test_domain_ask_helpers.py \
  tests/test_domains_helpers.py \
  tests/test_domains_api.py \
  tests/test_domain_eval_helpers.py \
  -q
```

Expected: PASS

- [ ] **Step 2: Frontend suite**

```bash
cd frontend && npm test -- \
  src/components/DomainConfigForm.test.tsx \
  src/components/DomainsPage.test.tsx
```

Expected: PASS

- [ ] **Step 3: Confirm shared-path reuse**

```bash
rg -n "expand_chunks_by_shared_mentions|coerce_graph_config|graph=" \
  backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/control_plane/domain_ask.py
```

Expected: expansion only inside `domain_retrieve.py`; `domain_ask` only coerces + passes `graph=`; no duplicate expand in routers/MCP.

- [ ] **Step 4: YAGNI grep (deferred must stay absent)**

```bash
rg -n "Neo4j|GraphRAG|ColPali|domain_chunk_mentions|leiden|ocr|query_rewrite|llm_as_judge" \
  backend/tvashtr/control_plane/domain_retrieve.py \
  backend/tvashtr/control_plane/domain_ask.py \
  frontend/src/components/DomainConfigForm.tsx || true
```

Expected: no Neo4j / ColPali / mentions table / OCR / agentic rewrite / judge (hint text may say "No Neo4j" — that string is OK).

- [ ] **Step 5: Final fixup commit only if needed**

```bash
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
test(domains): Phase 7 regression gate green

EOF
)"
```

---

## How operators use graph-lite

1. Open a Domain → **Config**.
2. Enable **Graph-lite mention expansion** → Save.
3. Ask / retrieve as usual. Top-k hits may be followed by up to **4** neighbor chunks that share capitalized mentions (e.g. product/org names) with those hits.
4. Leave disabled (default) for unchanged Phase 5/6 behavior.
5. Tune quality with Eval (Phase 6): compare hit@k with graph on vs off.

---

## Self-review checklist (Phase 7 stretch → tasks)

| Locked decision | Task(s) |
|-----------------|---------|
| Branch from `0e78979` as `feat/polyrag-domains-phase7` | Global Constraints |
| `retrieval.graph.enabled` default false | Tasks 1, 3, 4 |
| On-the-fly mention expand in `retrieve_for_query` (no Neo4j / no mentions table) | Tasks 1–2 |
| Cap expansion (`GRAPH_EXPAND_MAX=4`) | Task 2 |
| Shared path reuse; no new MCP tools | Task 2 + Task 5 grep |
| Config UI toggle (web+Desktop shared) | Task 4 |
| Explicit Non-goals: ColPali, full GraphRAG, multimodal OCR, agentic loops | Global Constraints + Task 5 |
| TDD + env git author (never `git config`) | All tasks |

### Plan completeness notes

- **No TBDs** for config shape, constants, hook point, citation behavior, or deferred items.
- **No Alembic** — intentional YAGNI (on-the-fly only).
- **Eval / hybrid / rerank unchanged** — graph is an optional post-pass on the shared dispatcher.
- **Phase 7 vision remainder** (ColPali, full GraphRAG, agentic correction) stays deferred — do not stub.

---

## Git notes for implementers

Author via env only — **never** `git config`:

```bash
GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME}" GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL}" \
GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME}" GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL}" \
git commit -m "$(cat <<'EOF'
message

EOF
)"
```

If env is unset in the worker, export the same identity the repo has been using on prior phase commits before committing — still without running `git config`.
