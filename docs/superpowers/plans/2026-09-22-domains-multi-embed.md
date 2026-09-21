# Domains Multi-Provider Embeddings — Implementation Plan

> **For agentic workers:** TDD; frequent commits; no push. Author via `GIT_AUTHOR_*` / `GIT_COMMITTER_*` env only (never `git config`).

**Goal:** Let Domains ingest + Ask embed without requiring an OpenAI Engines key — multi-provider LiteLLM/BYOK selection, pgvector dim fixed at **1536**, default stays OpenAI `text-embedding-3-small` for back-compat.

**Approach:** **B** (locked). Prefer existing `normalize_embedding_model` + `provider_for_model` + `resolve_owner_api_key` + `gateway.embed`. No dim migration. No Ollama. No GraphRAG. No Grok Build rewrite. No `api_base` on EmbeddingRequest unless a second provider truly needs it (v1 does not).

**Tech stack:** FastAPI + pytest; React 19 + Vitest + Testing Library.

---

## Global Constraints

- **Branch:** `feat/domains-multi-embed` from `feat/free-tools-skills-catalog` @ **`974bc51`** (worktree `/workspace/Tvashtr-domains-multi-embed`).
- **Dim:** keep `vector(1536)` + runtime `len(vec) != 1536` guard. Do not migrate.
- **Default:** bare `text-embedding-3-small` → normalize to `openai/text-embedding-3-small`; template default remains bare slug for back-compat storage OR normalized — keep stored default as today (`text-embedding-3-small`) so existing domains unchanged.
- **No zero-key free 1536 remote** exists on OpenRouter (free embeds are 384/768/1024). Do **not** claim SuperGrok/subscription covers embeddings.
- **Out of scope:** Ollama, dim change, Approach C custom base_url, GraphRAG, rewriting Grok Build.

---

## Locked product slice

| Ships | Does not ship |
|-------|----------------|
| Allowlist of 1536-safe embedding slugs (OpenAI + OpenRouter path) | Free/zero-key remote 1536 |
| `validate_domain_config` rejects unknown / non-1536 embedding models | Dim migration / Ollama |
| DomainConfigForm provider+model preset picker + Engines key help | EmbeddingRequest.api_base |
| Key resolution via existing `provider_for_model` / Engines BYOK | Subscription-as-embed |
| Default stays `text-embedding-3-small` → `openai/...` | Claiming OpenRouter free embeds are 1536 |

---

## Chosen free/cheap 1536 path

| Preset label | LiteLLM slug | Engines provider key | Notes |
|--------------|--------------|----------------------|-------|
| OpenAI text-embedding-3-small (default) | `openai/text-embedding-3-small` | `openai` | Native 1536; back-compat |
| OpenAI text-embedding-ada-002 | `openai/text-embedding-ada-002` | `openai` | Native 1536 legacy |
| OpenRouter → OpenAI 3-small | `openrouter/openai/text-embedding-3-small` | `openrouter` | **Verified 1536** via OpenRouter embeddings API; billed on OpenRouter credits (still OpenAI upstream). Cheapest path without an OpenAI Engines key. |

**Morning step for Aditya:** Engines → add OpenRouter API key → Domain Config → pick “OpenRouter → text-embedding-3-small” → re-ingest if switching from a different model family (same model via different provider still produces compatible 1536 vectors from the same upstream weights when using openai/text-embedding-3-small).

**Honesty:** OpenRouter free embedding models on the catalogue (Liquid LFM 1024, Nemotron free, MiniLM 384, etc.) are **not** 1536 — excluded from allowlist.

---

## Architecture

1. **Catalogue** — `ALLOWED_EMBEDDING_MODELS` frozenset + `EMBEDDING_PRESETS` (label, slug, provider, dim=1536) in `domain_ingest.py` (or small `domain_embedding.py` if cleaner). `normalize_embedding_model` still prefixes bare names with `openai/`. Optional: `is_allowed_embedding_model(normalized) -> bool`.
2. **Validate** — `validate_domain_config` checks `embedding.model` (string) against allowlist after normalize; optional `embedding.provider` if present must match `provider_for_model(model)` (or be omitted — slug is canonical). Reject unknown keys under `embedding` beyond `{model}` (and optional `provider` if we store it — prefer **model-only** to minimize schema drift; UI derives provider from slug).
3. **Ingest/Ask** — unchanged resolution path; allowlist only gates config PATCH + normalize helpers used by retrieve/ask.
4. **FE** — replace free-text with `<select>` of presets; store full slug in `embedding.model`; help copy: “Add this provider’s key under Engines (Dashboard → Engines).”
5. **Tests** — normalize multi-provider; validate accept/reject; key resolution `openrouter/...` → provider `openrouter`; FE picker saves OpenRouter slug; existing retrieve/ask/ingest stay green.

---

## File structure map

| Path | Responsibility |
|------|----------------|
| **Create** `docs/superpowers/plans/2026-09-22-domains-multi-embed.md` | This plan |
| **Modify** `backend/tvashtr/control_plane/domain_ingest.py` | Allowlist + presets + harden `normalize_embedding_model` |
| **Modify** `backend/tvashtr/control_plane/domains.py` | Validate embedding.model against allowlist |
| **Modify** `frontend/src/lib/domains.ts` | Export embedding presets (mirror BE) |
| **Modify** `frontend/src/components/DomainConfigForm.tsx` | Provider/model picker + Engines help |
| **Modify** tests: `test_domain_ingest_workflow.py`, `test_domains_helpers.py`, `DomainConfigForm.test.tsx`, optionally `test_domain_ask_helpers.py` | TDD coverage |

**Do not create:** Alembic, EmbeddingRequest.api_base, Ollama path.

---

## Tasks

### Task 1 — Plan commit
- [x] Write this plan; commit.

### Task 2 — Backend allowlist + normalize (TDD)
- [x] Red: tests for normalize bare/openai/openrouter; reject unknown models in validate.
- [x] Green: `ALLOWED_EMBEDDING_MODELS`, presets, validate_domain_config embedding section.
- [x] Commit.

### Task 3 — FE picker (TDD)
- [x] Red/green: DomainConfigForm select presets; help text; save OpenRouter slug.
- [x] Commit.

### Task 4 — Regression
- [x] Run domain ingest/ask/retrieve/helpers + DomainConfigForm tests.
- [x] Commit any fixes; report SHAs.

---

## Success criteria

- Branch `feat/domains-multi-embed` with plan + impl commits (no push).
- Default remains `text-embedding-3-small` → `openai/text-embedding-3-small`.
- Documented cheap slug: `openrouter/openai/text-embedding-3-small` + Engines `openrouter` key.
- Domains retrieve/ask/ingest tests green.
