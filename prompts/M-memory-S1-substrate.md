# M-memory · Slice 1 — memory substrate + storage + CRUD (backend only)

## Outcome
Stand up the persistent, owner-scoped **agentic memory store** — the table, the pgvector plumbing, the embedding call-path, and the owner-scoped CRUD API — that the later slices build on. **NO distillation, NO injection into agent runs, NO frontend in this slice** — foundation only. At the end of S1: a memory row can be created via the API, is embedded (a real `vector(1536)` stored in pgvector), and can be read / edited / pinned / deleted, all scoped to its owner and its tier.

## Context — READ THESE FIRST
- `backend/tvashtr/gateway/gateway.py` + `gateway/types.py` — the single litellm chokepoint. You ADD an `embed()` sibling to `complete()`, same BYOK-`api_key` + provider-agnostic-types shape. **`complete()` MUST stay byte-identical.**
- `backend/tvashtr/models.py` — SQLAlchemy models + the owner-scoped pattern (`ProviderCredential` / `ToolLibraryItem` / `SkillLibraryItem` are the templates: `owner_id` FK, per-owner rows). Add the new `NodeMemory` model here, following those.
- `backend/tvashtr/routers.py` — the FastAPI routers + the owner-scoped endpoint pattern (how the Tools/Skills/Providers shelves expose per-owner CRUD, incl. the session→owner auth dependency). Add the memory CRUD endpoints in the SAME style, reusing the same owner dependency.
- `backend/tvashtr/config.py` — the `Settings` pattern (`get_settings()`, `AliasChoices("TVASHTR_X", ...)`). Add the embedding-model setting here.
- `backend/tvashtr/metering.py` — `record_cost` / `record_agent_cost`. Add an embedding-cost metering path (off-ledger for manual CRUD: `workflow_id=None`, idempotent — mirror the Tvashtr-57 Ask off-ledger metering).
- `docker-compose.yml` — the `postgres` service (`image: postgres:16`). Swap it (see below).
- `.claude/hooks/protect-migrations.sh` — the freeze regex (`2[0-4]` = migrations 0001-0024). You bump it to `2[0-5]` as the ABSOLUTE LAST step.
- Alembic head = `0024`. The new migration is `0025` (its `down_revision` = the 0024 head revision).

## What to build

### 1. Infra — pgvector-enabled Postgres
In `docker-compose.yml`, change ONLY the `postgres` service image from `postgres:16` to `pgvector/pgvector:pg16` (a drop-in Postgres 16 with the `vector` extension available — same env vars, same volume; the existing `tvashtr_pgdata` data is format-compatible, no re-init). Leave `litellm-db-init` (it only runs `createdb`) and `litellm` unchanged.

### 2. Migration `0025` — the memory table + pgvector (the ONLY migration this whole milestone)
- `CREATE EXTENSION IF NOT EXISTS vector;` (must run before the vector column is created).
- Create table `node_memories` (match the codebase's PK/uuid/timestamp conventions):
  - `id` — uuid PK.
  - `owner_id` — FK to the owner/user table, NOT NULL, indexed (match `ProviderCredential.owner_id`). **Every query is owner-scoped.**
  - `repo_key` — text, NULLABLE. The repo identity (today = `runs.repo_path`). NULL ⇒ account/user tier.
  - `node_id` — uuid, NULLABLE, **PLAIN uuid (NOT a FK)** — the authored origin node's identity (via `agent_nodes.cloned_from_node_id`), because authored nodes are deletable/re-addable (mirror why `cloned_from_node_id` is a plain uuid). NULL ⇒ not node-scoped.
  - `content` — text, NOT NULL. The fact (a short natural-language statement).
  - `embedding` — `vector(1536)`, NULLABLE (nullable so a row can exist pre-embed / on embed failure; the create path populates it). 1536 = `text-embedding-3-small`'s dimension.
  - `valid_from` — timestamptz, NOT NULL, default now().
  - `invalid_at` — timestamptz, NULLABLE. NULL ⇒ currently valid; set ⇒ superseded/retired (S2/S4 write it; S1 leaves NULL).
  - `superseded_by` — uuid, NULLABLE (the row that replaced this one; S2 writes it).
  - `confirmation_count` — int, NOT NULL, default 1 (a trust/ranking signal; S2 bumps it).
  - `source_run_id` — text, NULLABLE (provenance — NULL for a manual add).
  - `source_invocation_id` — int, NULLABLE (provenance — NULL for a manual add).
  - `pinned` — bool, NOT NULL, default false (a pinned fact is "hot" — always injected later).
  - `status` — text, NOT NULL, default `'active'` (`active` / `superseded` / `pending_review`; S1 writes only `active`; S4 uses `pending_review`).
  - `created_at` / `updated_at` — the codebase's standard timestamp mixin/pattern.
- Indexes: a btree on `(owner_id, repo_key, node_id)` (tier queries), a btree on `status`, and a pgvector **ANN index** on `embedding` — `hnsw` with `vector_cosine_ops` (cosine is standard for text-embedding-3; HNSW is the modern default). If HNSW isn't available in the image, fall back to `ivfflat` + `vector_cosine_ops` + `lists=100` and note it.
- `downgrade` drops the index + table, then `DROP EXTENSION IF EXISTS vector` (safe here — nothing else uses it yet). The migration must round-trip (`downgrade -1` → `upgrade head`).

### 3. The tier model (one place — pure + unit-tested)
A row's TIER derives from which of `repo_key` / `node_id` are set:
- `repo_key` SET, `node_id` NULL → **shared per-repo** (every node on the repo reads it) — the proven default.
- `repo_key` SET, `node_id` SET → **per-node** (only that node) — the Tvashtr differentiator.
- `repo_key` NULL, `node_id` NULL → **account/user** (every run for that owner) — cross-repo prefs.
- `repo_key` NULL + `node_id` SET → **invalid; reject at the API.**
Put a small pure helper (e.g. `memory_tier(row) -> Literal["account","repo","node"]`) + the validity check in a new `control_plane/memory.py` (or next to the model — your call; keep it pure + tested). Repo identity today = the run's `repo_path` string (single-operator; `repo_key` = `repo_path`). A NULL `repo_path` (greenfield) has no repo tier — its learnings are account- or node-tier only. Document this.

### 4. The embedding call-path — `embed()` in the gateway
- Add `EmbeddingRequest` (`model: str`, `input: list[str]`, `api_key: str | None = None`) + `EmbeddingResult` (`vectors: list[list[float]]`, `model`, `prompt_tokens`, `total_tokens`, `cost_usd`, `raw_provider`, `latency_ms`) to `gateway/types.py` — same no-litellm-types discipline as `CompletionResult`.
- Add `embed(request) -> EmbeddingResult` to `gateway.py`: call `litellm.embedding(model=…, input=…, api_key=… if set)`, mirroring `complete()` — `api_key=None` ⇒ litellm's own env lookup (the non-run/manual path — reads `OPENAI_API_KEY` from `.env`, exactly like the `generate_doc` spike); a set `api_key` ⇒ BYOK. Pure function, NO db writes. Compute `cost_usd` best-effort (0.0 legitimate). **`complete()` stays byte-identical.**
- Add `embedding_model: str` to `Settings`, default `"openai/text-embedding-3-small"`, env `TVASHTR_EMBEDDING_MODEL` (via `AliasChoices`). Comment: the `vector(1536)` dimension is pinned in the migration; changing this to a different-dimension model later needs a new migration + re-embed.
- Metering: persist an embedding call's cost as a `CostRecord` with `workflow_id=None` (off-ledger, idempotent on a key) — mirror the Ask off-ledger metering. Manual CRUD embeds meter off-ledger.

### 5. Owner-scoped CRUD API (FastAPI, in routers.py's style; reuse the session→owner dependency)
- `POST /api/memories` — create. Body: `content` (required), optional `repo_key`, optional `node_id`, optional `pinned`. Validate the tier (reject `repo_key`-null + `node_id`-set). Embed `content` → store the vector. `owner_id` = the session owner; `status='active'`, `valid_from=now`, `confirmation_count=1`. Returns the row.
- `GET /api/memories` — list the owner's memories, filterable by tier: `?repo_key=…` (that repo's shared + optionally node rows), `?node_id=…`, or none (all the owner's). Default excludes `status != 'active'` unless `?include_superseded=true`. **Owner-scoped always.**
- `PATCH /api/memories/{id}` — edit `content` (RE-embed on content change) and/or `pinned`. Owner-scoped (404 if not the owner's).
- `DELETE /api/memories/{id}` — hard-delete (a user delete is a real delete; supersession via `invalid_at` is S2's, distinct). Owner-scoped.
- Pin/unpin — a `POST /api/memories/{id}/pin` + `/unpin`, or fold into PATCH (your call; keep it clean). Owner-scoped.
Assert with a test: owner A cannot GET / PATCH / DELETE owner B's memory.

## Invariants / do-not-touch (express AS evidence checks — verify on disk)
- `git diff main -- backend/tvashtr/control_plane/context_compiler.py` is **EMPTY** (injection is S3).
- `git diff main` for `backend/tvashtr/control_plane/team_run.py` and the executor is **EMPTY** (distillation is S2 — S1 does not touch run execution).
- `gateway.complete()` byte-unchanged: the diff of `gateway/gateway.py` shows ONLY additions (`embed()` + imports), no change to `complete()`'s body — read the diff to confirm.
- Migrations `0001`–`0024` byte-unchanged (the freeze hook enforces it — never edit them). The ONLY new migration is `0025`.
- The freeze regex in `.claude/hooks/protect-migrations.sh` is bumped `2[0-4]` → `2[0-5]` — **as the ABSOLUTE LAST step**, only after `0025` exists and everything is green.
- Never store a secret in a memory row or log an embedding/key.

## Acceptance / evidence — YOU run every check and debug to green; ECHO each into the chat
1. `docker compose up -d postgres` on the NEW image + setup/migrate ⇒ migration `0025` applies cleanly; a SQL check (`\d node_memories` or equivalent) shows the `embedding vector(1536)` column + the ANN index + the `vector` extension.
2. **Live embedding round-trip:** `POST /api/memories` with real `content` ⇒ a real 1536-float vector stored (verify length 1536, non-null) via a real `OPENAI_API_KEY` call. (Needs `OPENAI_API_KEY` in `.env` — if absent, STOP → `NEEDS_HUMAN`; do NOT fake a vector.) Echo the row.
3. CRUD across all three tiers: create an account-tier (no `repo_key`), a repo-tier (`repo_key` set), a node-tier (`repo_key`+`node_id`); list filtered by tier; PATCH one's content and verify the vector CHANGES (re-embed); pin/unpin; delete. Echo results.
4. Owner-isolation test: owner A cannot GET/PATCH/DELETE owner B's memory. Tests are mutation-real (assert the exact tier, the 1536 length, the owner-isolation — not smoke asserts).
5. `make test` green (new memory tests + the full existing suite — the 510 floor RISES, no regressions). `make lint` clean. The FE build + vitest green (S1 is backend-only — this proves no FE break; the 296 vitest floor holds).
6. Migration reverses cleanly: `alembic downgrade -1` then `upgrade head`.
7. The freeze regex bumped to `2[0-5]` LAST.
Echo `READY_TO_MERGE <branch>` when every item is green.

## Tests (non-vacuity)
Not a bug-fix — no failing-regression gate — but every new test MUST assert real behavior and fail if the behavior is wrong (the exact tier derivation, the 1536 vector length, owner-isolation, re-embed-on-edit). Write at least one deliberately-wrong-then-fixed check if useful to prove non-vacuity.

## Stop conditions
- On an EXTERNAL blocker you can't resolve in-code — `OPENAI_API_KEY` absent from `.env` (the live embedding can't run), or the pgvector image won't pull — write `NEEDS_HUMAN` + the specific blocker to `STATE.md` and STOP. Do NOT stub/fake the embedding to get past a missing key (that makes the live acceptance vacuous).
- A code-proven, contained problem with a clear in-code fix → proceed and fix it.
- On the standard turn cap → write `STATE.md` and stop.

## Branch
`m-memory-s1-substrate` (branch-per-step per CLI-RULES). Commit ONLY your own changed paths. Do NOT push; do NOT checkout or merge `main`.
