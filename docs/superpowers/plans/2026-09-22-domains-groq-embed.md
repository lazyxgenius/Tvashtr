# Domains Groq Embeddings — Implementation Plan (PM GO-B / Approach B)

> **For agentic workers:** TDD; frequent commits; no push. Author via `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env only (never `git config`).

**Goal:** Add Groq `nomic-embed-text-v1_5` (768-dim) as a Domains embedding preset alongside existing OpenAI/OpenRouter 1536 presets, without breaking the OpenRouter 1536 path. pgvector column becomes **unbound** `vector` for `domain_chunks` only.

**Approach:** **B** (locked) — multi-provider LiteLLM/BYOK catalogue keyed by slug → `{provider, dim}`. Fail-closed dim asserts at ingest. Cross-dim config PATCH forces re-ingest (clear embeddings + mark ready docs pending).

**Base:** `feat/domains-multi-embed` @ `c27da81`. Branch: `feat/domains-groq-embed`.

---

## Locked product slice

| Ships | Does not ship |
|-------|----------------|
| Catalogue slug → `{provider, dim}` with Groq 768 + OpenAI/OpenRouter 1536 | Pad/truncate vectors |
| Alembic: `domain_chunks.embedding` → unbound `vector`; ORM `Vector()` | Change `node_memories` (stays `Vector(1536)`) |
| Ingest: `len(vec) == expected_dim(model)` fail closed | Ollama / custom api_base |
| Cross-dim PATCH → clear embeddings + force re-ingest | Same-dim provider switch re-ingest (optional) |
| FE: Groq preset shows dim 768; Engines help for `groq` key | GraphRAG / Grok Build rewrite |

---

## Model table

| Preset | LiteLLM slug | Engines key | Dim |
|--------|--------------|-------------|-----|
| OpenAI 3-small (default) | `openai/text-embedding-3-small` | `openai` | 1536 |
| OpenAI ada-002 | `openai/text-embedding-ada-002` | `openai` | 1536 |
| OpenRouter → 3-small | `openrouter/openai/text-embedding-3-small` | `openrouter` | 1536 |
| OpenRouter → ada-002 | `openrouter/openai/text-embedding-ada-002` | `openrouter` | 1536 |
| **Groq Nomic v1.5** | `groq/nomic-embed-text-v1_5` | `groq` | **768** |

**Aditya morning path:** Dashboard → Engines → add `groq` API key → Domains → Domain Config → pick “Groq nomic-embed-text-v1.5 (768)” → Save (cross-dim from default OpenAI triggers re-ingest clear) → Ingest.

---

## Architecture

1. **Catalogue** — `EMBEDDING_CATALOGUE: dict[str, {provider, dim}]`; `ALLOWED_EMBEDDING_MODELS = frozenset(keys)`; `expected_dim(model)`; presets include Groq.
2. **Alembic 0038** — `ALTER domain_chunks.embedding TYPE vector` (unbound). ORM `DomainChunk.embedding = Vector()`. Leave `NodeMemory` / mig 0025 alone.
3. **Ingest** — replace hardcoded `1536` with `expected_dim(emb_model)`.
4. **PATCH** — in `update_domain`, if new config embedding dim ≠ old dim: NULL all chunk embeddings for domain; set ready/indexing docs → `pending`; refresh aggregates.
5. **FE** — add Groq preset; show dim in option + hint; Engines BYOK hint mentions `groq` for Domains embeds.
6. **Tests** — catalogue/dim; ingest assert 768 vs 1536; cross-dim PATCH clears; FE picker; OpenRouter still green.

---

## File map

| Path | Change |
|------|--------|
| `docs/superpowers/plans/2026-09-22-domains-groq-embed.md` | This plan |
| `backend/tvashtr/control_plane/domain_embedding.py` | Catalogue + `expected_dim` + Groq preset |
| `backend/tvashtr/control_plane/domain_ingest.py` | Dim assert via `expected_dim` |
| `backend/tvashtr/control_plane/domains.py` | Cross-dim PATCH re-ingest; validate message |
| `backend/tvashtr/models.py` | `DomainChunk.embedding` → `Vector()` |
| `backend/alembic/versions/0038_domain_chunks_unbound_embedding.py` | Alter column |
| `frontend/src/lib/domains.ts` | Groq preset |
| `frontend/src/components/DomainConfigForm.tsx` | Dim in UI + groq Engines help |
| `frontend/src/components/EnginesShelf.tsx` | Help for `groq` key (Domains embeds) |
| tests (BE + FE) | TDD coverage |

---

## Tasks

### Task 1 — Plan commit
- [x] Write this plan; commit.

### Task 2 — Catalogue + expected_dim (TDD)
- [x] Red/green: Groq in allowlist; `expected_dim` 768/1536; validate accepts Groq; reject unknown.

### Task 3 — Alembic + ORM unbound vector
- [x] Mig 0038; `DomainChunk` → `Vector()`; `node_memories` untouched.

### Task 4 — Ingest dim assert (TDD)
- [x] Fail closed on wrong dim; accept matching dim for Groq 768 and OpenAI 1536.

### Task 5 — Cross-dim PATCH (TDD)
- [x] OpenAI→Groq clears embeddings + marks ready → pending; same-dim switch does not.

### Task 6 — FE (TDD)
- [x] Groq preset dim 768; Engines help mentions groq; OpenRouter path still works.

### Task 7 — Regression + report
- [x] Domain embedding/ingest/helpers + DomainConfigForm/Engines tests; SHAs; residual risks.

---

## Success criteria

- Branch `feat/domains-groq-embed` from `c27da81` with plan + impl commits (no push).
- `groq/nomic-embed-text-v1_5` → 768; never pad/truncate.
- `domain_chunks.embedding` unbound; `node_memories` still 1536.
- OpenRouter 1536 path unbroken.
