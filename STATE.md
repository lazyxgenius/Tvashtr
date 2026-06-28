# Tvashtr — Autonomous Execution State

## Current Milestone
M-accounts → BYOK. **Slice B — ownership + per-owner key resolution + the dashboard** — account-based,
`.env`-free provider keys. Branch `feat/m-accounts-slice-b` cut from `main` @ `f78e3dd` (the Slice-A
docs-closeout commit, which contains all of `748abaf`; FF-safe). Slice A (auth + login enforcement)
shipped + merged. **COMPLETE — all gates green; READY_TO_MERGE below.**

## Last Completed Step
M-accounts Slice B — branch `feat/m-accounts-slice-b` — 14 atomic commits (`099db88` … the freeze-hook
bump). Awaiting operator audit + FF-merge.

## In Progress
Nothing — Slice B is COMMITTED and all gates are green. Awaiting operator audit + FF-merge.

## The change (Slice B)
Tvashtr becomes fully account-based + `.env`-free for provider keys. Logged-out → a LANDING page
(pitch + CTAs; no canvas/team data). Login → a DASHBOARD (the authed default): the account's teams,
previous runs, and providers (`provider · •••• last4`) with add/remove; a fresh account lands with a
seeded starter team but empty providers/runs. Open a team → the canvas (`App`) with a
back-to-dashboard control. Every run is OWNED by construction (`runs.owner_id` always set — UI = the
user, scripts/tests = the seeded operator); the executor hard-errors on a NULL owner (no `.env`
fallback). Per-owner key resolution from the encrypted DB replaces `.env` on BOTH the completion
(gateway) and agent (adapter) paths; an owner lacking a key for a node's provider is refused at launch
(422). The seed imports the `.env` provider keys ONCE into the operator's encrypted
`provider_credentials` + backfills the operator's owner-less runs/library-teams; afterward nothing
reads `.env` provider keys at run time.

## What landed (14 atomic commits, branch `feat/m-accounts-slice-b`)
1. `099db88` — migration `0017` (nullable `runs.owner_id`/`team_graphs.owner_id` FKs +
   `provider_credentials` table, unique `(owner_id, provider)`) + ORM models.
2. `47e69b1` — crypto: `cryptography`/Fernet `encrypt_secret`/`decrypt_secret` + stable
   `TVASHTR_SECRET_KEY` (44-char dev default) in `control_plane/credentials.py`.
3. `6673cf3` — per-owner resolver `resolve_owner_api_key` + `provider_for_model` + `NoCredentialError`
   (NO `.env` fallback) — **reproduce-first §5a**.
4. `ccd5969` — both-path swap: gateway `CompletionRequest.api_key` + `complete()` forward; agent
   `agent_llm_routing` proxy-OFF uses the threaded override + RAISES if None; `_direct_agent_api_key`
   DELETED. proxy-ON byte-unchanged.
5. `bb2292b` — executor threads the owner key per node (`pm_step`/`thinker_refine_step`/
   `agent_run_step` resolve inside the step from `run_id`, never returned → not checkpointed;
   `load_graph_step` hard-asserts `owner_id`) — **reproduce-first §5c**.
6. `60a8d2c` — harness: every offline `Run(` insert owned by the `client` user (`auth_user_id()`) +
   seeded dummy creds in conftest. No owner-less run remains (AST-verified).
7. `b4cede9` — provider endpoints (GET/POST/DELETE `/api/providers`, secret never returned) +
   `GET /api/runs`.
8. `989872a` — owner-scoping (create_run/ab-runs owner + pre-flight 422; get_run/graph/tasks, cancel,
   resolve/ack, ab-comparison owner-checked; teams.py per-owner; `_require_library_team` owner-check)
   — **reproduce-first §5b**.
9. `650e283` — seed imports `.env` keys once + backfills owners (idempotent).
10. `836c990` — live scripts own their runs as the operator (`scripts/operator_session.py`).
11. `9290fe8` — FE landing page + dashboard + provider/runs api fns + DS CSS (no wiring).
12. `308a992` — FE wiring: AuthGate router (landing → login → dashboard → canvas) + App
    `teamId`/back-control.
13. `2d3e9a5` — accounts e2e (`make accounts-e2e` + `frontend/e2e/accounts.spec.ts`) + auth.spec update.
14. (the branch HEAD) — freeze hook bumped `1[0-6]`→`1[0-7]` (0001–0017) + this STATE closeout +
    the `test_credentials_crypto.py` docstring reflow (a stray lint fix from commit 3's pass that had
    never been re-staged onto its commit-2 file — folded in here so the branch is lint-clean as
    committed).

## Key design decisions (this slice)
- **owner_id resolved INSIDE each spend-bearing step** (not a new step param) so the many
  `monkeypatch.setattr(team_run, "pm_step"/"agent_run_step", fake)` tests keep their signatures; the
  plaintext key is used transiently and never returned (never in a DBOS checkpoint).
- **Test owner = the conftest `client` user** (`auth_user_id()`), seeded dummy creds; every direct
  `Run(` insert + the teams.py library-fn callers thread it, so owner-checked endpoints + the
  LLM-mocked resolver pass offline.
- Pre-flight 422 runs after the team graph is determined (a clone-path 422 leaves only a harmless
  non-library orphan clone — never a started run).

## Invariants held (checkable on disk)
- Migrations `0001`–`0016` byte-intact; only `0017` added (chains off `0016`); freeze hook now
  `0001`–`0017` (0017/0016 BLOCKED exit 2, 0018 ALLOWED exit 0).
- `team_run.py` openhands-free at import (verified). `EngineAdapter` seam + signature unchanged — the
  owner key threads the EXISTING `AgentTask.llm_api_key`. `build_two_node_team`/`build_review_loop_team`/
  `clone_team_graph` untouched (the builders; `create_team_from_template`/`create_blank_team` wrap them
  + stamp owner_id). proxy-ON `agent_llm_routing` branch byte-identical.
- Greenfield + brownfield run mechanics byte-intact except the key-resolution swap.
- New runtime dep = only `cryptography` (pinned via `uv.lock`).

## Gate results — decisive lines echoed into the /goal transcript
- `make migrate` head — **`0017_ownership_and_credentials (head)`**.
- `make seed` ×2 — **`operator@tvashtr.local (created); imported 5 provider key(s); backfilled 0 run(s)
  + 0 library team(s)`** then **`(exists); imported 5 … backfilled 0 + 0`** (idempotent).
- `make test` — **`309 passed, 1 warning in 14.54s`** (285 floor + 24 new: crypto, resolver, both-path,
  owned-run executor §5c, providers/runs, owner-checks, pre-flight 422 §5b, seed import+backfill,
  resolver §5a).
- `make lint` — ruff **`All checks passed!`** + eslint `--max-warnings 0` (exit 0) + prettier
  **`All matched files use Prettier code style!`**.
- `make test-frontend` — **`Tests 159 passed (159)`** (151 floor + 8: landing 2, dashboard 5, AuthGate +1)
  ; `make build-frontend` — **`✓ built in 1.18s`** (tsc-strict + vite).
- `make accounts-e2e` — **`ACCOUNTS E2E PASSED`** (`1 passed`): landing (no canvas/create-team) →
  register → empty dashboard → add a provider key (•••• last4) → open a team → canvas → back.
  Screenshots in `/tmp/tvashtr_accounts_shots/` (step1-landing, step2-empty-dashboard,
  step3-provider-added, step4-canvas). `make auth-e2e` also PASS (updated to landing/dashboard).
- **NOT a gate (NIM-blocked, skipped):** `loop-feature-docker`, `brownfield-check` — the live real-key
  path is the operator's manual post-merge check (§9): migrate → seed → delete `.env` provider keys →
  log in → dashboard shows the seeded providers → open a team → run resolves the DB keys with NO `.env`.

## Test Count
**309 backend pytest** (285 floor + 24 new) + **159 vitest** (151 floor + 8 new) — 2026-06-28.

## Deviations / notes
- A stale-PENDING NIM `run_team` workflow from a prior session resurrected on DBOS launch and polluted
  the suite — reset with `docker compose down -v && make db-up && make migrate` (CLI-RULES §4.5).
- `/api/costs` left un-owner-scoped (only a non-Run `generate_doc` workflow hits it in tests; it is a
  debug surface, not a run-scoped read the brief enumerated).

## Open Questions
None blocking. NEXT slice (the architect's): the per-node MODEL PICKER inside the canvas + the BYOK +
LiteLLM-proxy reconciliation + the DB-level `NOT NULL` hardening on `runs.owner_id` — all deferred.

READY_TO_MERGE: branch=feat/m-accounts-slice-b, sha=<branch HEAD — the freeze/closeout commit>, tests=309 backend / 159 vitest
