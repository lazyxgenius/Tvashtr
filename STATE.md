# Tvashtr — Autonomous Execution State

## Current Milestone
M-accounts → BYOK (the production model layer). **Slice A — "the app requires login"** (identity
vertical): minimal email/password auth + login enforcement + the login UI + the operator seed.
NIM-independent (no live-LLM gate). Slice B (ownership columns + per-owner key resolution +
`provider_credentials`) and Slice C (the BYOK shelf + picker) are SEPARATE later slices — NOT built here.

## Last Completed Step
M-accounts Slice A — branch `feat/m-accounts-auth` — committed @ `748abaf` (cut from `main` @ `0b0b230`).
READY_TO_MERGE recorded below; nothing in progress — awaiting operator FF-merge.

## In Progress
Nothing — Slice A is COMMITTED (`748abaf`) and all gates are green. Awaiting operator audit + FF-merge.

## The change (Slice A)
The whole app sits behind a minimal email/password login. Opening the FE shows a login/register screen;
after logging in you land on the exact canvas that exists today, unchanged. A seeded operator account
(`operator@tvashtr.local` / `tvashtr-dev`, dev defaults) logs in immediately. A logged-in run resolves
its model key EXACTLY as today (the global `.env` path via `_direct_agent_api_key`, untouched).

What landed (the 22 committed paths):
- **Backend identity:** `User` ORM model (`models.py`) + NEW migration `0016_users` (chains off
  `0015_run_brownfield_target`; additive `users` table, unique email). `session_secret` added to
  `config.Settings` (env `TVASHTR_SESSION_SECRET`, dev default) — `_direct_agent_api_key` /
  `agent_llm_routing` BYTE-IDENTICAL.
- **`backend/tvashtr/auth.py` (new, openhands-free):** bcrypt `hash_password`/`verify_password`; an
  itsdangerous-signed `tv_session` cookie (HttpOnly, SameSite=lax, Secure=False for local dev — prod
  must flip Secure + a real secret; 14-day max age); `get_current_user` dependency (401 on
  absent/tampered/expired/unknown); `auth_router` (`/api/auth` register/login/logout/me).
- **Enforcement (`main.py`):** `auth_router` included with NO dep; the product `api_router` gated by
  `dependencies=[Depends(get_current_user)]` (covers every `routers.py` endpoint in one line); the two
  inline spike endpoints gated too; `/health` stays open.
- **Seed (`seed.py` + `make seed`):** idempotent operator-account creator from
  `TVASHTR_SEED_EMAIL`/`TVASHTR_SEED_PASSWORD` (dev defaults). Slice-B key-import extension point marked.
- **Frontend login gate:** `api.ts` gains `getMe/login/register/logout` + `ApiError` + a
  `setUnauthorizedHandler` 401 seam (inside `getJSON` + `getMe`); `AuthGate` (getMe on mount →
  loading/authed/unauthed, registers the 401 seam, onLogout); `LoginScreen` (email/password + a Log
  in/Register toggle + inline 401/409/422 errors, DS-styled); `main.tsx` renders `<AuthGate/>`;
  `App.tsx` minimal diff = optional `{user,onLogout}` props + a top-bar logout control (rest byte-identical).
- **Live gate:** `scripts/auth_e2e.sh` (mirrors `launch_panel_e2e.sh` + seeds before Playwright; no
  NVIDIA key) + `frontend/e2e/auth.spec.ts` (4 checks, a screenshot each) + `make auth-e2e`.
- **Freeze hook:** `.claude/hooks/protect-migrations.sh` regex bumped `1[0-5]`→`1[0-6]` (0001-0016) — LAST step.

## Invariants held (checkable on disk)
- `_direct_agent_api_key` + `agent_llm_routing` in `config.py` BYTE-IDENTICAL (only `session_secret`
  added to `Settings`). Model-key resolution unchanged.
- `control_plane/team_run.py`, `engines/*.py`, `control_plane/teams.py`, `build_two_node_team` — ZERO
  diff (not in the commit).
- Migrations `0001`–`0015` byte-intact; only `0016_users` added. Head `0016_users`.
- `App.tsx` diff limited to the optional `{user,onLogout}` props + the logout control; everything else
  byte-identical. `App.test.tsx` unchanged (props optional → `<App />` still valid).
- New runtime deps = only `bcrypt` + `itsdangerous` (declared in `pyproject.toml`, pinned via `uv.lock`:
  bcrypt 5.0.0, itsdangerous 2.2.0). `team_run.py` stays openhands-free at import; no-push hook intact.

## Tests — mutation-real
- The shared `client` fixture (conftest) is now AUTHENTICATED (registers a uuid account → carries the
  `tv_session` cookie) — the single point that keeps all ~108 existing endpoint tests green under
  enforcement, zero per-file churn. New `unauth_client` (bare `TestClient`, empty jar — no second DBOS
  launch) for the unauthenticated surface. New `test_auth.py` (17 tests): register 200/409/422 (+ email
  normalize + cookie HttpOnly/SameSite), login 200/401, logout clears the session (→ me 401), me 401/200,
  tampered + valid-signature-unknown-user rejected, GET /api/teams 401-without/200-with (the
  reproduce-first analog), /health open, spike endpoints gated, hash/verify + cookie sign/read/expire units.

## Gate results (this branch) — decisive lines echoed into the /goal transcript
- `make migrate` head — **`0016_users (head)`**.
- `make seed` ×2 — **`created: operator account operator@tvashtr.local`** then
  **`exists — no-op: operator@tvashtr.local already has an account`** (idempotent).
- `make test` — **`285 passed, 1 warning in 12.92s`** (268 floor + 17 new auth tests; never below 268).
- `make lint` — ruff **`All checks passed!`** + eslint `--max-warnings 0` (exit 0) + prettier
  **`All matched files use Prettier code style!`**.
- `make test-frontend` — **`Tests  151 passed (151)`** (144 floor + 7 new) ; `make build-frontend` —
  **`✓ built in 1.19s`** (tsc-strict + vite).
- `make auth-e2e` — **`AUTH E2E PASSED`** (`1 passed (2.1s)`) — CHECK 1 login-required, CHECK 2
  register→canvas, CHECK 3 logout→login, CHECK 4 seeded-login→canvas; 4 screenshots in
  `/tmp/tvashtr_auth_shots/`.
- Freeze hook verified post-bump: `0016`/`0015` BLOCKED (exit 2), `0017` ALLOWED (exit 0).

## Test Count
**285 backend pytest** (268 floor + 17 new) + **151 vitest** (144 floor + 7 new) — 2026-06-28.

## Deviations / notes
- **Authenticated `client` fixture in place of a parallel `auth_client` (deviation=auth-fixture-in-place).**
  The brief described adding a shared authenticated-TestClient fixture and threading it through every
  endpoint test. Implemented by UPGRADING the existing session-scoped `client` fixture to register +
  carry the cookie — the same single-point outcome with a far smaller diff (no edit to ~40 test files;
  `client` is the ONLY TestClient fixture and every endpoint test already takes it). Added `unauth_client`
  for the unauthenticated-surface tests. No behavioral compromise; documented here per CLI-RULES §6.
- `read_session_cookie(value, max_age=...)` carries an optional `max_age` seam (defaulted to the real
  14-day window) so cookie EXPIRY is unit-testable without time travel — the documented public signature
  `read_session_cookie(value)` is preserved.
- No live-LLM gate in this slice (NIM-independent) — ran clean, no flake to absorb.

## Open Questions
None blocking. Slice B (ownership columns + per-owner key resolution + `provider_credentials`, NO `.env`
fallback) and Slice C (the BYOK shelf + per-node picker) are the architect's next slices.

## Suggested next step
Slice B — ownership (`runs.owner_id` / `teams.owner_id` / `provider_credentials.owner_id`) + per-owner
key resolution (swap `_direct_agent_api_key` to DB-first, NO `.env` fallback) + extend the seed to import
the operator's `.env` keys as their credentials.

READY_TO_MERGE: branch=feat/m-accounts-auth, sha=748abaf, tests=285 backend / 151 vitest
