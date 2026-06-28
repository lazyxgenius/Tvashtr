# Brief — M-accounts Slice A: "the app requires login" (identity vertical)

> This brief is the detailed decomposition for the Slice-A `/goal`. The `/goal` references it.
> You (Claude Code) self-decompose the implementation steps and RUN every gate to green yourself.
> This is **Slice A of the M-accounts → BYOK milestone** (see `PROJECTPLAN.md` §16 "M-accounts → BYOK"
> + the 2026-06-28 Tvashtr-35 §17 entry). Slice B (ownership columns + per-owner key resolution +
> `provider_credentials`) and Slice C (the BYOK shelf + picker) are SEPARATE later slices — **do NOT
> build them here.**

---

## Outcome (the one thing this slice delivers)

The whole app sits behind a **minimal email/password login**. Opening the frontend shows a
login/register screen; after logging in you land on the exact canvas that exists today, completely
unchanged. A seeded operator account exists so you can log in immediately. **No ownership, no
per-user keys, no key-resolution change** — a logged-in run resolves its model key exactly as it
does now (the global `.env` path via `_direct_agent_api_key`, untouched). This slice is *only*
identity + enforcement + the login UI + the seed.

This is deliberately a **vertical** (backend auth + FE login + seed + Playwright) so `main` stays
shippable and the visible surface is sign-off-able in one pass. It is NIM-independent — there is **no
live-LLM gate in this slice**, so nothing here should flake on the agent path.

---

## Scope — build exactly this

### 1. Backend — `users` table (migration `0016`)
- New ORM model `User` in `backend/tvashtr/models.py`:
  - `id` — `Uuid` PK, `default=uuid.uuid4` (match the other Uuid-PK tables).
  - `email` — `Text`, **unique**, `nullable=False`. Stored **lower-cased + trimmed** (normalize on
    write). The unique constraint is on the stored value.
  - `password_hash` — `Text`, `nullable=False`.
  - `created_at` — `DateTime(timezone=True)`, `server_default=func.now()`, `nullable=False`.
- New Alembic migration `backend/alembic/versions/0016_users.py`:
  - `revision = "0016_users"`, `down_revision = "0015_run_brownfield_target"`.
  - `upgrade()` creates the `users` table (with the unique constraint on `email`); `downgrade()`
    drops it. Additive (new table) — touches NO existing table, NO frozen migration.
  - After `make migrate`, the head must be `0016_users`.

### 2. Backend — auth module `backend/tvashtr/auth.py` (new)
Holds, in one openhands-free module:
- **Password hashing** via the `bcrypt` library (add `bcrypt>=4` to `backend/pyproject.toml`
  `dependencies`; pin a concrete version). `hash_password(pw) -> str` and
  `verify_password(pw, hash) -> bool`. (bcrypt's 72-byte truncation is acceptable for v1 — do not
  pre-hash.)
- **Signed session cookie** via `itsdangerous.URLSafeTimedSerializer` (add `itsdangerous>=2` to
  `dependencies` and pin it — declare it directly rather than relying on Starlette's transitive).
  - Cookie name: `tv_session`. Payload: the user id (uuid string). `HttpOnly=True`,
    `SameSite="lax"`, `Secure=False` (local dev over http — add a code comment that prod must set
    Secure + a real secret). Max age ≈ 14 days.
  - Helpers: `make_session_cookie_value(user_id) -> str` and `read_session_cookie(value) ->
    user_id | None` (returns None on `BadSignature`/`SignatureExpired`).
  - The signing secret is a NEW setting `session_secret: str` on `Settings`, env
    `TVASHTR_SESSION_SECRET`, with a dev default (e.g. `"dev-insecure-session-secret-change-me"`) so
    the offline suite + local dev work with no extra env. Add it to `config.py` `Settings` **without
    touching `_direct_agent_api_key` or `agent_llm_routing`** (those two functions stay byte-identical).
- **`get_current_user` FastAPI dependency**: reads `tv_session` from the request cookies, verifies it,
  loads the `User` by id from the DB (use `db.session_scope()` / the session factory), and **raises
  `HTTPException(401)` if the cookie is absent/invalid/expired or the user doesn't exist**. Returns a
  small object/dict (`id`, `email`) — enough for the endpoints + future ownership.
- **`auth_router = APIRouter(prefix="/api/auth")`** with:
  - `POST /api/auth/register` — body `{email, password}`. Validate: email trimmed+lower-cased,
    non-empty, contains `@` (light validation — do **not** add the `email-validator` dependency / do
    not use pydantic `EmailStr`); password non-empty, **min length 8**. `409` if the email already
    exists; on success create the user, set the `tv_session` cookie on the response, return
    `{id, email}`. (Registration is open in v1 — a fresh visitor can create an account.)
  - `POST /api/auth/login` — body `{email, password}`. `401` on unknown email or bad password
    (do not distinguish the two in the message); on success set the cookie, return `{id, email}`.
  - `POST /api/auth/logout` — clear the `tv_session` cookie; return `204` (or `{ok: true}`).
  - `GET /api/auth/me` — `401` if no valid session; else `{id, email}`. (This is what the FE gate
    calls on load.)

### 3. Backend — enforce login on the product surface (`main.py`)
**Rule: every `/api/*` route requires `current_user`, EXCEPT `/api/auth/*`. `/health` stays open.**
- In `main.py`, include the auth router with **no** global dependency:
  `app.include_router(auth_router)`.
- Gate the existing product router by adding a router-level dependency to its include:
  `app.include_router(api_router, dependencies=[Depends(get_current_user)])` — this covers **every**
  endpoint in `routers.py` (teams, runs, ab-runs, repo/inspect, templates, costs, documents,
  run-events, tasks, cancel, …) in one line.
- The two inline spike endpoints defined directly on `app` in `main.py`
  (`/api/spike/hello-durable` POST + `/api/spike/hello-durable/{workflow_id}` GET) must ALSO require
  login — add `Depends(get_current_user)` to each (per the "all `/api/*` except `/api/auth/*`" rule).
- `/health` must remain reachable without a session (it's the liveness probe the e2e harness curls).

### 4. Backend — the seed (`backend/tvashtr/seed.py`, new; `make seed`)
- A module `backend/tvashtr/seed.py` with a `main()` that **idempotently** creates the operator's
  account: read `TVASHTR_SEED_EMAIL` (default `operator@tvashtr.local`) and `TVASHTR_SEED_PASSWORD`
  (default `tvashtr-dev`) from the env; if a user with that (normalized) email already exists, print a
  clear "exists — no-op" line and exit 0; otherwise create the user (hashed password) and print a
  "created" line. Add a code comment that the defaults are dev-only and must be overridden for any
  real/shared deployment.
- Add a `make seed` target that runs it via the backend env: `cd backend && uv run python -m tvashtr.seed`.
- **Why a script, not a data-migration:** the account is data, not schema; keep it out of `0016` so
  the migration stays a pure additive schema change and the seed is independently re-runnable/testable.
- Slice B will EXTEND this seed to import the `.env` provider keys as this account's credentials — leave
  a one-line comment marking that extension point. (Do not import keys here; `provider_credentials`
  doesn't exist yet.)

### 5. Frontend — the login gate
- `frontend/src/lib/api.ts` — add typed fns: `getMe(): Promise<{id, email} | null>` (resolves `null`
  on 401, throws on other errors), `login(email, password)`, `register(email, password)`,
  `logout()`. Add a tiny **401 handler seam**: a module-level `setUnauthorizedHandler(fn)` plus a
  check inside the existing `getJSON` GET helper (and inside `getMe`) that, on `res.status === 401`,
  invokes the handler before throwing. (You do NOT need to add the check to every POST/PATCH/DELETE
  call site — the next GET poll surfaces an expired session, which is sufficient for v1; keep the
  mutation call sites byte-unchanged apart from this.)
- `frontend/src/components/AuthGate.tsx` (new) — on mount calls `getMe()`. State `loading | authed |
  unauthed`. While loading, render a minimal placeholder. If `unauthed`, render `<LoginScreen
  onAuthed={...} />`. If `authed`, render `<App user={user} onLogout={...} />`. Register a
  `setUnauthorizedHandler` that flips state to `unauthed` (so an expired session mid-session drops
  back to the login screen). `onLogout` calls `logout()` then flips to `unauthed`.
- `frontend/src/components/LoginScreen.tsx` (new) — email + password inputs and a **Login / Register
  toggle**; submit calls `login()` / `register()`; on success calls `onAuthed`. Show inline errors for
  401 (bad credentials) / 409 (email taken) / 422 (validation). Use the existing design-system / CSS
  conventions (look at an existing component + the CSS files) so it doesn't look unstyled. Avoid
  raw HTML `<form>`-submit page reloads — use button `onClick` handlers.
- `frontend/src/main.tsx` — render `<AuthGate />` instead of `<App />`.
- `frontend/src/App.tsx` — **minimal diff only**: add optional props to the signature
  (`{ user, onLogout }`, both optional so existing tests/usage don't break) and a small **logout
  control** (and optionally the logged-in email) in the existing top bar. **Everything else in App.tsx
  must be byte-identical** (it will be diffed against `main`).

### 6. Tests
- **Backend (pytest):** new tests for the auth surface — register (success + 409 dup + 422 validation),
  login (success + 401 bad creds), logout clears the cookie, `me` (401 without / 200 with a session),
  `get_current_user` rejects a missing/invalid/expired cookie, and that a protected endpoint (e.g.
  `GET /api/teams`) returns **401 without a session** and works **with** one.
  - **Enforcement churn (plan for this):** adding `current_user` to the product router will make
    **every existing endpoint test fail** (they hit `/api/teams`, `/api/runs`, etc. via `TestClient`
    with no session). Add a shared pytest fixture that yields an **authenticated `TestClient`** (create
    + log a test user in, so the client carries the `tv_session` cookie) and thread it through every
    existing endpoint test. This fixture is the single point that makes the suite pass under
    enforcement. The backend test count must **not drop below 268** and will rise with the new auth tests.
- **Frontend (vitest):** new tests for `AuthGate` (renders `LoginScreen` when `getMe` resolves
  null/401; renders `App` when authed) and `LoginScreen` (login vs register submit calls the right api
  fn; error states). Mock `fetch` / the api fns per the existing test conventions. If `App.test.tsx`
  breaks because `App` now takes props, keep it green (give the props sane defaults / pass them). The
  vitest count must **not drop below 144** and will rise.

### 7. Live acceptance — `make auth-e2e` (no agent, no NVIDIA key)
- `scripts/auth_e2e.sh` — **mirror `scripts/launch_panel_e2e.sh`** (Postgres + `alembic upgrade head`
  + a real backend on the LOCAL sandbox + the Vite dev server + `npx playwright install chromium` +
  run the spec + screenshots). **One addition:** after migrate and before Playwright, **run the seed**
  (`cd backend && uv run python -m tvashtr.seed`) and export `TVASHTR_SEED_EMAIL` / `TVASHTR_SEED_PASSWORD`
  (the same defaults) so the spec can log in as the seeded account. NO `NVIDIA_BUILD_API_KEY` needed;
  `TVASHTR_AGENT_SANDBOX=local`.
- `frontend/e2e/auth.spec.ts` — four checks, a **screenshot per check**, using **targeted selectors**
  (NOT a full-page accessibility snapshot — the canvas chokes it; the login screen itself is simple):
  1. Visit the base URL in a fresh context → assert the **login screen** is visible (an email input /
     a "Log in" control) and the canvas is NOT.
  2. **Register** a brand-new unique account (e.g. `e2e+<timestamp>@tvashtr.local`) → assert the app
     renders (a known canvas selector, e.g. the TeamsRail or the "Run this team" affordance — find a
     stable selector by reading the FE).
  3. **Logout** → assert the login screen is back.
  4. **Login as the seeded account** (`TVASHTR_SEED_EMAIL` / `TVASHTR_SEED_PASSWORD`) → assert the
     canvas renders. (This proves the seed + the login path the Slice-B harness will rely on.)
- Add a `make auth-e2e` target that runs `./scripts/auth_e2e.sh` (match the Makefile's e2e-target style;
  put a one-line `##` help string on it like the other targets).

### 8. The freeze hook bump — the LAST step (only because this slice adds a migration)
- After everything else is green, edit `.claude/hooks/protect-migrations.sh`: change the regex
  `^00(0[1-9]|1[0-5])_.*\.py$` → `^00(0[1-9]|1[0-6])_.*\.py$` (i.e. `1[0-5]` → `1[0-6]`) and update its
  comment `0001-0015` → `0001-0016`. Editing this hook file is allowed (it only guards the migration
  *files*, not itself). Do this LAST so you can still author `0016` (creating `0016_*.py` is already
  permitted — it isn't matched by the old regex).

---

## Invariants / do-not-touch (expressed as on-disk checks — keep these verifiable)
- **`_direct_agent_api_key` and `agent_llm_routing` in `config.py` stay byte-identical** (you only ADD
  `session_secret` — and optionally read the seed env in `seed.py`, not here — to `Settings`). The
  resolution path is NOT changed in this slice. No `.env` fallback is removed here (that's Slice B).
- **`control_plane/team_run.py`, the engine adapters (`engines/*.py`), `control_plane/teams.py`
  (builders + the PM/ENGINEER/REVIEWER/ARCHITECT prompts), and `build_two_node_team`** are **untouched**
  (zero diff). This slice does not go near the run/agent path.
- **Migrations `0001`–`0015` are byte-intact**; the only new migration is `0016_users.py`.
- **`App.tsx`'s diff is limited** to (a) the optional `{ user, onLogout }` props in the signature and
  (b) the top-bar logout control (+ optional email). Everything else byte-identical.
- **A logged-in run behaves exactly as today** — no change to model resolution, sandbox, ship, or any
  existing run/team behavior. The ONLY new requirement to use the app is "be logged in."
- **No new runtime dependency** beyond `bcrypt` and `itsdangerous`, both declared directly + pinned.
- `team_run.py` stays openhands-free at import (unchanged); the no-push hook stays intact.

---

## Acceptance / evidence checklist (run each yourself to green; echo the decisive line into the chat)
The `/goal` evaluator reads only the transcript — after each command, echo its decisive line verbatim:
1. `make migrate` → the Alembic head prints **`0016_users`**. Echo the head line.
2. `make seed` run **twice** → first prints "created", second prints "exists — no-op" (idempotent).
   Echo both.
3. `make test` → the final `=== N passed in Xs ===` line, with **N ≥ 268 + the new auth tests**
   (every existing endpoint test updated to the authenticated fixture). Echo it.
4. `make lint` → clean. Echo the result line.
5. `make test-frontend` → vitest **≥ 144 + new** green (echo the summary) AND `make build-frontend`
   green (echo the final line).
6. `make auth-e2e` → **PASS** — echo the final PASS line + the screenshot list. The four checks
   (unauthenticated→login, register→canvas, logout→login, seeded-login→canvas) all green.
7. Write `READY_TO_MERGE: branch=feat/m-accounts-auth, sha=<sha>, tests=<N> backend / <M> vitest` to
   `STATE.md`. Echo that line.

---

## Reproduce-first
This is a **feature slice**, not a bug-fix, so no failing-regression-first is required. The closest
analog: the new backend test "`GET /api/teams` is 401 without a session, 200 with one" — confirm it
**fails before** enforcement is wired (or would, conceptually) and passes after. Make the auth tests
mutation-real (assert real status codes + that the cookie is actually set/cleared + that a tampered
cookie is rejected), not smoke-asserts.

---

## Stop conditions
- Hard turn cap: stop and write `NEEDS_HUMAN: <reason>` to `STATE.md` if you exceed a reasonable cap
  with no progress (this slice has NO live-LLM gate, so it should run clean — there is no NIM
  flakiness to absorb).
- Distinguish: **a second/unknown problem that would need a broad or unproven change → STOP + write
  `NEEDS_HUMAN`**; a code-proven, contained, regression-guarded fix to a single identified cause → may
  proceed.
- Branch: `feat/m-accounts-auth`. Commit your own changed paths only (conventional commits). **Never
  push; never merge** — the operator fast-forward-merges after the disk audit. Do not stage the
  architect's living docs (`PROJECTPLAN.md`, `HANDOVER.md`) or `prompts/*.md`.
