# M-accounts Slice B — ownership + per-owner key resolution + the dashboard (account-based, `.env`-free)

> Brief for one CLI `/goal`. This brief is AUTHORITATIVE for this run and supersedes CLI-RULES §7.
> Read `PROJECTPLAN.md` §1 (vision) + the **2026-06-28 (Tvashtr-36) §17 entry** (the Slice-A as-built + the A→B→C slice plan) before starting. Then self-decompose and run every gate to green.

---

## 0. Where this sits

Tvashtr — the web canvas for composing/running custom AI agent teams. The **M-accounts** milestone. **Slice A (auth + login enforcement) is SHIPPED + merged** — `main` @ `748abaf`, alembic head `0016`, floors **285 backend pytest / 151 vitest**. Branch this slice off `main`.

The active milestone is **M-accounts** (NOT M-brownfield — that is PARKED on NIM). The CLI-RULES §7 "next = M-brownfield" line is stale; **this brief governs.**

---

## 1. The end-state this slice delivers (the outcome)

Tvashtr becomes **fully account-based and `.env`-free for provider keys**:

1. **A logged-out visitor sees a LANDING PAGE** — the product name + a short pitch + CTAs ("Try the canvas" / "Create your own team"). **No canvas. No "create team" button. No team data.** The CTAs route into login/register.
2. **Login → a DASHBOARD** (the new authed default — NOT the canvas): the user's **teams**, the user's **previous runs**, and the user's **providers** (each shown as `provider · •••• last4`) with **add / remove**. A **fresh** account lands on an **empty** dashboard ("create your first team" + "add your provider API keys").
3. **Open a team from the dashboard → the canvas** (the existing `App`), with a **back-to-dashboard** control.
4. **Every run is owned, by construction** — `create_run` only exists behind a logged-in user, so `runs.owner_id` is always set. There is no owner-less run anywhere (the live scripts + offline fixtures create runs as the **seeded operator**). The executor **hard-errors** if it ever loads a run with `owner_id` NULL — never a silent `.env` fallback (this can't occur; the assert is defense-in-depth).
5. **Per-owner key resolution from the encrypted DB replaces `.env` on BOTH the completion (gateway) and agent (adapter) paths.** A run resolves **its owner's** provider keys; an owner with **no** key for a node's provider is **refused at launch (422)**.
6. **`.env` provider keys become DELETABLE.** The seed reads `.env` provider keys **exactly once** to import them as the operator's encrypted credentials (and backfills the operator's existing teams/runs). After that, **nothing reads `.env` provider keys at runtime** — the operator deletes `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `GROQ_CLOUD_API_KEY` / `NVIDIA_BUILD_API_KEY` from `.env` and every run (theirs in the UI, the scripts as the operator) still resolves from the DB. `.env` keeps `DATABASE_URL`, `TVASHTR_SECRET_KEY` (the Fernet key — must be STABLE), `TVASHTR_SESSION_SECRET`, and non-provider config.

---

## 2. Hard invariants / do-not-touch

1. **Migrations `0001`–`0016` are FROZEN** (the `protect-migrations.sh` hook blocks edits even under bypass). Add **exactly one** new migration `0017`. **As the LAST migration action**, extend the hook's freeze regex to include `0017` (so `0001`–`0017` are frozen) — do this only after `0017` is final + tests pass.
2. **`team_run.py` stays openhands-free at import.** No module-level OpenHands import.
3. **The `EngineAdapter` seam is inviolable** — its interface signature is unchanged; the executor never learns which adapter is active. The per-owner key threads through the EXISTING `AgentTask.llm_api_key` field (already present), not a new adapter contract.
4. **`build_two_node_team` is untouched.**
5. **The offline suite never regresses.** Backend ≥ **285**, vitest ≥ **151** — counts only RISE. Every new module/behaviour gets tests. No existing test deleted or weakened to pass.
6. **The proxy-ON path is UNCHANGED.** `litellm_proxy_enabled` defaults OFF and BYOK is the proxy-OFF direct path. When the proxy is ON, the existing per-run virtual-key behaviour stays exactly as is (the proxy holds upstream keys in its own config, independent of the app's `.env`). Reconciling BYOK with the proxy (per-owner upstream keys) is explicitly OUT of scope (§7).
7. **Greenfield + brownfield run MECHANICS stay byte-intact** except the key-resolution swap (the worktree mount, branch ship, git-aware sync, repo-grounding, the launch panel — all unchanged). The ONLY runtime behavioural change is *where the LLM key comes from*.
8. **Branch-per-step; never push to `main`; never `git merge`.** The operator fast-forward-merges after the architect's disk audit. `STATE.md` carries the `READY_TO_MERGE` signal.

---

## 3. Backend build (outcomes + the load-bearing specifics; you self-decompose the HOW)

### 3.1 Migration `0017`
- `runs.owner_id` — `Uuid` FK → `users.id`, **nullable at the DB level** (so the migration applies to a DB with existing rows *and* a pre-seed window where the operator user may not exist yet). The **application** guarantees non-null: `create_run` always sets it; no code path creates an owner-less run. (DB-level NOT NULL is a later hardening once all rows are backfilled — not this slice.)
- `team_graphs.owner_id` — `Uuid` FK → `users.id`, nullable. Library teams get it set; ephemeral run-snapshot clones / A-B / smoke graphs stay NULL (never listed).
- **`provider_credentials`** table: `id` Uuid PK · `owner_id` Uuid FK → `users.id` **NOT NULL** · `provider` Text (the canonical slug prefix, e.g. `openrouter`) · `secret_encrypted` Text (Fernet ciphertext, ASCII) · `key_last4` Text (display only) · `created_at` / `updated_at` timestamptz. **Unique `(owner_id, provider)`** — one key per provider per account (add = upsert/replace).
- Migration carries **NO data** (the operator user only exists after the seed). The seed does all backfill/import (§3.6).

### 3.2 Encryption
- New dep `cryptography` (add to `backend/pyproject.toml`). Fernet (`cryptography.fernet`).
- New `TVASHTR_SECRET_KEY` settings field (mirror the `session_secret` pattern in `config.py`): env `TVASHTR_SECRET_KEY`, a **stable dev-default Fernet key** (a real 44-char urlsafe-base64 `Fernet.generate_key()` value, hardcoded as the default so the offline suite + local dev work with no extra env) + a comment: PROD must override; the key must be **stable** (the stored secrets are only decryptable with the same key).
- A small crypto helper (new module, e.g. `backend/tvashtr/crypto.py` or `control_plane/credentials.py`): `encrypt_secret(plaintext) -> str` / `decrypt_secret(ciphertext) -> str` using `Fernet(settings.secret_key)`. Unit-tested (round-trip; wrong-key → raises).

### 3.3 The per-owner resolver
- A function `resolve_owner_api_key(owner_id, model) -> str` (in the credentials module): `provider = model.split("/", 1)[0].strip().lower()`; query `provider_credentials` for `(owner_id, provider)`; decrypt; return plaintext. **Raise a typed error** (e.g. `NoCredentialError`) when absent. **No `.env` fallback.** `owner_id` is always a real user id (no NULL case).
- This `provider = leading-slug-segment` mapping is the unifying key for BOTH paths and is *more correct* than today's agent-path catch-all (which lumped `openai/…` into `OPENROUTER_API_KEY`); it aligns the agent path with the completion path's litellm provider detection.

### 3.4 Swap BOTH resolution paths; remove `.env` from the run path
- **Completion (gateway):** add an optional `api_key: str | None = None` to `CompletionRequest` (`gateway/types.py`); in `complete()` (`gateway/gateway.py`) pass `api_key=request.api_key` to `litellm.completion(...)` when set. (On the run path the executor always sets it; the None branch is only for non-run callers.)
- **Agent (adapter routing):** in `agent_llm_routing` (`config.py`), the **proxy-OFF** branch must use the **`api_key_override`** (the per-owner key the executor passes) instead of `_direct_agent_api_key(model)`. **Remove the `.env` provider-key lookup from the run path**: delete `_direct_agent_api_key` (after confirming via grep it has no other live caller) and make proxy-OFF require the override — if `api_key_override is None` on proxy-OFF, **raise** (no `.env` fallback). The proxy-ON branch is untouched.

### 3.5 The executor threads the owner key per node
- In `team_run.py`, every node step already loads the `Run` row (lines ~84 / 260 / 355 / 411 / 743) — read `run.owner_id` there. For each node, resolve the owner's key for **that node's model** via `resolve_owner_api_key(run.owner_id, node_model)` and pass it:
  - completion nodes (`pm_step`, the thinker step, any reviewer-as-completion) → `CompletionRequest(api_key=...)`.
  - agent nodes (`agent_run_step`) → `AgentTask(llm_api_key=...)` (proxy-OFF). On proxy-ON, `llm_api_key` stays the minted `vkey` (unchanged).
- `owner_id` is constant per run; the model varies per node, so resolution is per-node-model. Assert `run.owner_id is not None` (hard-error if somehow NULL — never proceed to `.env`).

### 3.6 The seed (extended) — import `.env` keys ONCE + backfill (idempotent)
Extend `seed.py` / `make seed` so a single `make seed` (after `make migrate`) does, idempotently:
1. **Ensure the operator account** (Slice A — exists).
2. **Import `.env` provider keys → the operator's encrypted `provider_credentials`**, mapping env var → provider slug, importing each that is SET, skipping unset ones, upserting on `(owner, provider)`:
   - `OPENROUTER_API_KEY` → `openrouter`
   - `OPENAI_API_KEY` → `openai`
   - `GEMINI_API_KEY` → `gemini`
   - `GROQ_CLOUD_API_KEY` (fallback `GROQ_API_KEY`) → `groq`
   - `NVIDIA_BUILD_API_KEY` (fallback `NVIDIA_NIM_API_KEY`) → `nvidia_nim`
   (Store `key_last4` = the key's last 4 chars; `secret_encrypted` = Fernet ciphertext.)
3. **Backfill** existing `owner_id`-NULL `runs` → the operator, and existing `owner_id`-NULL **`is_library`** `team_graphs` → the operator. (Ephemeral non-library graphs may stay NULL.)
Running `make seed` twice is a no-op the second time.

### 3.7 Provider endpoints + list-my-runs (all owner-scoped via `current_user`)
- `GET /api/providers` → `[{provider, key_last4, created_at}]` for the current user. **The secret is NEVER returned.**
- `POST /api/providers` `{provider, api_key}` → lowercase/trim the provider slug, encrypt + upsert on `(owner, provider)`, return `{provider, key_last4}` (never the secret).
- `DELETE /api/providers/{provider}` → 204.
- `GET /api/runs` → the current user's runs as summaries `[{run_id, idea, status, created_at, repo_path?}]`, newest first (the dashboard's "previous runs"; no such list endpoint exists today).

### 3.8 Owner-scope the reads/writes
- `create_run` → set `owner_id = current_user.id`; **pre-flight key check**: collect the DISTINCT providers across the (cloned) team's node models; if the owner lacks a `provider_credentials` row for any → **422** `{message, missing_providers}` (refuse before starting the workflow, mirroring the brownfield validate-before-clone discipline). The seeded operator (with imported keys) passes; a keyless account is refused.
- `get_run` / `get_run_graph` / run-tasks / run-costs / the A-B run reads → **owner-check** (`run.owner_id == current_user.id` else **404**). Cross-account uuid-guessing is blocked.
- `get_teams` → `seed_library_if_empty(current_user.id)` + `list_library_teams(current_user.id)`; team create / blank / template instantiation → set `owner_id`; team-edit endpoints (nodes/edges/positions/validate/delete) → owner-check (404 on another user's team). `seed_library_if_empty` becomes **per-account** (a fresh account still lands ≥1 starter team — the §13 S2 anti-dead-zone posture, now per-owner). The A-B create path → owner-scoped (it creates runs).
- Thread an `owner_id` parameter through the `teams.py` library functions (`list_library_teams`, `seed_library_if_empty`, `create_team_from_template`, `create_blank_team`); the run-snapshot `clone_team_graph` does NOT need an owner (the run owns it via `runs.owner_id`).

### 3.9 Convert EVERY run-creating path to OWNED (the harness)
This is required for "`.env` deletable" and "no owner-less runs":
- **Offline test fixtures** that create runs (the authenticated `client` fixture already provides `current_user`; the executor harness tests — skeleton / loop / forced-revisions): the fixture user must **own** its runs AND have **seeded dummy `provider_credentials`** for the providers the default test teams use (read the builders; at minimum `openrouter`, `openai`, `nvidia_nim`) — a dummy key string is fine because the offline suite mocks the LLM, so the pre-flight + resolver pass and the key is never used against a real provider.
- **Live scripts** (`brownfield-check`, `loop-*`, `skeleton-*`, `agent-smoke`, the loop drivers in `scripts/`): create their runs as the **seeded operator** (so they resolve the operator's imported credentials). They must run `make seed` (or ensure the operator + creds) and set the run's owner to the operator. After import + `.env` deletion these resolve the operator's DB keys.
- **No code path creates an owner-less run.** The executor asserts `owner_id` present.

---

## 4. Frontend build (outcomes + invariants; mind the FE-testing gotchas in HANDOVER §4)

### 4.1 Landing page (pre-auth)
- A new `LandingPage` component: product name + a short pitch + CTAs "Try the canvas" / "Create your own team". **No canvas, no team data, no "create team".** CTA → the login/register screen.
- `AuthGate` (currently: unauthed → `LoginScreen`) becomes: unauthed default → `LandingPage`; a CTA switches to `LoginScreen`; `onAuthed` → the authed shell (the dashboard).

### 4.2 Dashboard (the post-auth default — NOT the canvas)
- A new `Dashboard` component, shown on login: the user's **teams** (from `GET /api/teams`), the user's **runs** (from `GET /api/runs`), and the user's **providers** (from `GET /api/providers`) with **add** (paste a key once → `POST /api/providers` → shows `•••• last4`, secret never re-displayed) and **remove** (`DELETE /api/providers/{provider}`). A fresh account shows the empty state ("create your first team" + "add your provider API keys").

### 4.3 Dashboard ↔ canvas navigation
- Selecting a team on the dashboard opens the canvas (`App`) for that team, with a **back-to-dashboard** control. The canvas is reached ONLY via the dashboard (never the logged-out default). Keep `App`'s internals largely intact — add an entry point (open a specific team) + the back control; the logout control stays.

### 4.4 `api.ts`
- Add `listProviders` / `addProvider` / `removeProvider`, `listRuns`, and any dashboard data fns. Keep the existing auth fns + the 401 seam.

---

## 5. Reproduce-first (the resolution PROOF — write these FIRST, watch them FAIL on the current code)
- **(a)** `resolve_owner_api_key(ownerA, model)` returns **ownerA's** key — NOT ownerB's, NOT an `.env` value. On the current code there is no such function and the `.env` key is returned regardless of owner → the test can't even resolve per-owner. Make it pass.
- **(b)** An **owned run whose owner lacks a credential** for a node's provider is **refused (422 at `create_run`)**. On the current code the run proceeds and uses `.env`. Make it pass.
- **(c)** An **owned run whose owner HAS the credential** resolves THAT key end-to-end through the executor (assert the key threaded into `AgentTask.llm_api_key` / `CompletionRequest.api_key`, with the LLM mocked) — proving the threading, offline, no NIM.
These three (failing → passing) are the evidence the swap actually changed behaviour, not just added code.

## 6. Acceptance / evidence (run to green; **echo each decisive line into the transcript** per CLI-RULES §4.3a)
- `make migrate` → **head is `0017`** (echo the head line).
- `make seed` → ensures the operator + imports N provider creds + backfills M runs/teams (echo a one-line summary); run it **twice** → second run is a no-op (idempotent).
- `make test` → **≥ 285** + the new backend tests (resolver, crypto round-trip, ownership/owner-checks, the seed import+backfill, the pre-flight 422, the §5 reproduce-first, the owned-run executor path) — echo `=== N passed in Xs ===`.
- `make lint` → clean (echo the result).
- `make test-frontend` (vitest) → **≥ 151** + new (landing, dashboard, providers add/remove, the routing) — echo the summary; `make build-frontend` → green.
- **A new Playwright e2e + `make` target** (e.g. `make accounts-e2e` + `frontend/e2e/accounts.spec.ts`) covering the journey: logged-out shows the **landing page** (no canvas / no "create team") → register → **empty dashboard** → add a provider key → create/open a team → reach the canvas. Use targeted selectors + screenshots (the full canvas a11y snapshot HANGS — HANDOVER §4). Echo its final status; record screenshots in `STATE.md`.
- The **offline executor tests** (skeleton / loop with the LLM mocked, owned runs, seeded dummy creds) pass — proving the owned-run + resolution path end-to-end offline. Echo them.
- `READY_TO_MERGE: branch=<slug>, sha=<sha>, tests=<N> passing` in `STATE.md` (echo the line).
- **NOT a gate:** the live NIM targets (`loop-feature-docker`, `brownfield-check`) are NIM-blocked (degraded free-tier window) — do NOT block on them. The real-key path is the operator's **manual post-merge check** (§9).

## 7. Out of scope / deferred (do NOT build these)
- **The per-node MODEL PICKER inside the canvas** (choosing a model per node from the account's providers) + recommendation hints — the operator wants it but it is the NEXT slice. Provider add/remove on the **dashboard** lands now; wiring each canvas node's model dropdown is the follow-on.
- **BYOK + the LiteLLM proxy reconciliation** (per-owner upstream keys when the proxy is ON) — later; the proxy path is untouched here.
- **DB-level `NOT NULL` on `runs.owner_id`** — a later hardening once all rows are backfilled.
- OAuth/SSO/email-verify/password-reset (never in M-accounts).

## 8. Stop / checkpoint
- This is a LARGE slice. Self-decompose into atomic commits (migration → crypto → resolver → both-path swap → executor threading → seed → endpoints → owner-scoping → harness conversion → landing → dashboard → nav → e2e). Keep `STATE.md` current after each.
- If you genuinely cannot finish in one transcript, write a precise `STATE.md` "In Progress" + the remaining steps and stop cleanly (the architect closes it in a tight follow-up). Use `NEEDS_HUMAN` only per CLI-RULES §5.

## 9. The manual post-merge check (the operator runs this — for context; you don't run it)
After merge, the operator will: `make migrate` → `make seed` (imports `.env` keys) → **delete the provider keys from `.env`** → restart → log in → confirm the dashboard shows the seeded providers → open a team → run → confirm it resolves the DB keys and works with NO provider keys in `.env`. Your job is to make that pass by construction; the architect will hand the operator the exact numbered script.
