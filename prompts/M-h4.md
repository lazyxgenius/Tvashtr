# M-h4 — DEPLOY: Tvashtr live on Fly at `tvashtr.fly.dev` (backend + one-origin FE, Neon, sleep-when-idle)

> Architect brief for Tvashtr-77's launch. The `/goal` points here. This brief SUPERSEDES
> `CLI-RULES.md` §7 for this run and overrides CLI-RULES anywhere they conflict — the ground truth
> below is architect-verified on disk. Read it FULLY before writing any code. **USE the ultracode /
> dynamic-workflows / superpowers skills** as the init prompt instructs.

---

## 1. Objective (one sentence)

Ship the **last code milestone before public launch**: `tvashtr` runs **LIVE, public, HTTPS at
`tvashtr.fly.dev`** with the **backend on Fly** (off the laptop, no WireGuard tunnel), the **frontend
served one-origin from that same backend**, the DB on **Neon** (schema applied by the deploy's release
step), **sign-in working**, and the machine **sleeping when idle** — proven by a live `.fly.dev` smoke
and Playwright screenshots.

Branch: **`feat/m-h4-deploy`**

This is **DEPLOY + the small serving/config code it needs**. It is config-heavy (a Dockerfile + a
fly.toml) plus ~5 small code edits. It adds **NO migration** and does **NOT** touch the agent/executor
logic beyond one region-fallback change + config threading.

---

## 2. Ground truth (architect-verified on disk — trust THIS over stale CLI-RULES §2/§4.6/§7)

- `main` @ **`857d9b2`**. **No `[remote]` in `.git/config`** — pushing Tvashtr's own repo is
  structurally impossible; that is why bypass mode is safe.
- Alembic head **`0030_hosted_github_run`**. Freeze hook blocks `0001`–`0030`. **M-h4 adds NO
  migration.** Head stays `0030`. Do **not** bump the freeze.
- Floors: **880 backend / 379 vitest**. Backend goes UP (new reproduce-first tests). Vitest stays
  **≥ 379** (the frontend is untouched — you only *build* it, you don't edit it).
- Agent model is **DeepSeek** (`.env` `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`). CLI-RULES §4.6
  ("proven = NIM 70b"), §2 (head `0014`, old counts) are STALE — ignore them.
- **Package manager `uv`.** Exact commands (from the `Makefile`, verbatim):
  - backend deps: `uv` from `backend/uv.lock` (+ `backend/pyproject.toml`, `backend/.python-version` pins 3.12)
  - backend tests: `cd backend && uv run pytest`  · lint: `make lint`  · migrate: `cd backend && uv run alembic upgrade head`
  - **backend run (dev)**: `cd backend && uv run uvicorn tvashtr.main:app --reload --host 127.0.0.1 --port 8000` → **the prod CMD drops `--reload` and binds `0.0.0.0:8080`**
  - FE build: `cd frontend && npm run build` (= `tsc --noEmit` + `vite build`) → **`frontend/dist`** (Vite, no `base` override → served from domain root; perfect for one-origin)
  - vitest: `cd frontend && npm test`
- **Alembic runs headless off `DATABASE_URL`:** `backend/alembic/env.py` sets the URL from
  `tvashtr.db.sqlalchemy_url()` — no hardcoded local URL. `backend/tvashtr/db.py` pins **psycopg3**
  (`postgresql://` → `postgresql+psycopg://`) + `pool_pre_ping=True`, so the Neon **direct** URL works
  as-is. Migration **`0025`** does `CREATE EXTENSION IF NOT EXISTS vector` FIRST — **pgvector is
  confirmed supported on Neon free**, so `alembic upgrade head` on Neon enables it and builds the whole
  schema.
- **Service inventory = backend + Neon ONLY.** LiteLLM proxy is opt-in/OFF; nothing uses Redis or
  object storage → **ONE Fly app**, no sidecars.
- **`main.py` serves NO frontend today** — only `/api`, `/health`, `/api/config`, `/api/auth/*`.
  One-origin SPA serving is NEW code (Deliverable 3).
- **The cookie is insecure:** `set_session_cookie` (in `backend/tvashtr/…auth.py`) hardcodes
  `secure=False`; `clear_session_cookie` must be changed to MATCH (Deliverable 4).
- **GitHub install URL has no `redirect_uri`:** the callback is `GET /api/auth/github/callback`;
  `build_install_url()` (in `…github_app.py`) appends no `redirect_uri`, so with two callbacks now
  registered GitHub can't tell which environment to return to (Deliverable 6).
- **The Fly client is built in ONE place:** `backend/tvashtr/engines/openhands_fly_adapter.py`
  `_new_fly_client()` constructs `FlyMachines(token=…, org=settings.fly_org, region=settings.fly_region,
  image=…, guest_cpus=…, guest_memory_mb=…, egress_ports=parse_egress_ports(settings.fly_egress_allowed_ports))`
  — note it **parses `egress_ports` HERE**, keeping `fly_machines` free of the config layer. `parse_regions`
  MIRRORS that pattern (Deliverable 5). `fly_machines.py` `create_machine` today sends a single
  `{"region": self.region, …}`; a 422 surfaces through `_request` as
  `FlyApiError "HTTP 422 …insufficient_capacity…"`.

**Fly-side state the deploy lands INTO (operator setup, DONE + verified — do NOT redo, do NOT print any secret value):**

- **Fly app `tvashtr` exists** in org `personal` → **`tvashtr.fly.dev`**; NO machines yet ($0). This
  first `fly deploy` creates the first machine.
- **10 secrets STAGED** on the app (they auto-apply on the first `fly deploy`, INCLUDING the
  release-command machine, so it has `DATABASE_URL`): `DATABASE_URL` (Neon **direct/non-pooler**),
  `TVASHTR_SESSION_SECRET`, `TVASHTR_SECRET_KEY` (Fernet), `TVASHTR_FLY_SESSION_SECRET`,
  `TVASHTR_FLY_API_TOKEN` (a short-expiry org token), `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`,
  `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY_B64`. **Do NOT put any of
  these in fly.toml, the Dockerfile, `.env.example`, a test, a log, or the transcript.** They live in
  Fly's vault.
- **GitHub App** carries BOTH callbacks — `http://localhost:8000/api/auth/github/callback` (local) +
  `https://tvashtr.fly.dev/api/auth/github/callback` (new); OAuth-during-install is checked.
- Neon project: AWS `ap-southeast-1` (next to Fly `sin`), free plan. The staged `DATABASE_URL` is the
  **direct** connection (no `-pooler`) so DBOS/psycopg prepared statements don't break on Neon's
  transaction pooler.

---

## 3. WHY this shape — read this, it constrains everything below

- **Backend on Fly kills the tunnel.** M-h1b/M-h2a ran the backend on the laptop, which needed an
  Active WireGuard tunnel to reach the `tv-run-*.flycast` agent machines. Put the backend ON Fly in the
  **same `personal` org** and it sits on the org's default 6PN network → it reaches every `tv-run-*`
  machine over Flycast **natively, no tunnel**. This is inherent to running on Fly — **NO adapter code
  change** is needed for it; the fly adapter's Flycast path already works. (The only fly-adapter change
  this milestone is the region fallback, Deliverable 5.)
- **One-origin FE kills the cross-origin cookie fragility.** Serve the SPA from the SAME backend that
  serves `/api`, so the session cookie is first-party, same-site — no CORS/cookie dance. That is why
  `samesite="lax"` stays and `secure=True` becomes safe (HTTPS, same origin).
- **Sleep-when-idle = ~$0 standing.** `auto_stop_machines="suspend"` + `min_machines_running=0`: the
  one machine suspends (memory snapshot → fast wake) when idle, starts on the next request. A stopped
  backend holds no DB connection → **Neon** scales to zero after ~5 min on its own. Do NOT try to verify
  idle-stop live (it takes minutes) — configure-and-trust.
- **Health check must NOT wake Neon.** `/health` calls `db.ping()`, which WAKES Neon on every hit.
  Keep `/health` for humans; add a **DB-free `/healthz`** and point Fly's check there, so a briefly-up
  machine doesn't hold Neon awake.
- **Region fallback because `bom` is capacity-tight.** Fly's own docs flag `bom` (Mumbai) as
  high-demand — the exact `insufficient_capacity` we hit twice. Home region is `sin`; on a 422 capacity
  error, walk `sin → iad → fra`. Fences (per-user network + per-run Flycast + egress) span regions
  within one org, so a fallback-region machine keeps ALL fences.

---

## 4. The seven deliverables (self-decompose the steps; the shape below is the contract)

**Every new config knob gets a LOCAL-SAFE DEFAULT so local `make test` and http dev are byte-identical
to `main`. Prod values live ONLY in fly.toml `[env]` / Fly secrets.**

### D1 — Dockerfile (NEW; none exists)
Multi-stage:
- **Stage 1 (node):** `cd frontend && npm ci && npm run build` → `frontend/dist`.
- **Stage 2 (python 3.12):** install backend deps via `uv sync` from `backend/uv.lock` (+ pyproject),
  put the venv bin on PATH so `uvicorn`/`alembic` run directly. COPY `backend/tvashtr`,
  `backend/alembic`, `backend/alembic.ini`, and the built `frontend/dist` into the image at the path
  main.py reads (Deliverable 3).
- **CMD** = `uvicorn tvashtr.main:app --host 0.0.0.0 --port 8080` (no `--reload`), run from the backend
  context so `tvashtr.main` imports and `alembic.ini`/`alembic/` are alongside for the release command.
- **Do NOT `COPY .env`** into the image — secrets come from Fly's vault at runtime.

### D2 — fly.toml (NEW)
- `app = "tvashtr"`; `primary_region = "sin"`; `[build] dockerfile = "Dockerfile"`.
- `[env]`: `TVASHTR_HOSTED_MODE = "true"`, `TVASHTR_AGENT_SANDBOX = "fly"`,
  `TVASHTR_FLY_ORG = "personal"`, `TVASHTR_FLY_REGION = "sin,iad,fra"`,
  `TVASHTR_FRONTEND_ORIGIN = "https://tvashtr.fly.dev"`, `TVASHTR_PUBLIC_BASE_URL = "https://tvashtr.fly.dev"`,
  `TVASHTR_COOKIE_SECURE = "true"`. (Do NOT restate secrets here.)
- `[http_service]`: `internal_port = 8080`, `force_https = true`, `auto_stop_machines = "suspend"`,
  `auto_start_machines = true`, `min_machines_running = 0` (the sleep-when-idle knob). Fly health
  check → the **DB-free `/healthz`** (Deliverable 3), NOT `/health`.
- `[deploy] release_command = "alembic upgrade head"` — runs the EXISTING migrations (incl.
  `0025 CREATE EXTENSION vector`) against Neon BEFORE the new version serves; the release machine gets
  the staged secrets, so it has `DATABASE_URL`. (If your image WORKDIR isn't the backend, make the
  release command `cd` first — it must resolve `alembic.ini` + read `DATABASE_URL`.)

### D3 — one-origin frontend serving (`main.py` + config)
- Add config `frontend_dist: str` (alias `TVASHTR_FRONTEND_DIST`, default the in-image dist path).
- Mount `StaticFiles` at the built assets dir (`<dist>/assets`), and add a **catch-all GET** returning
  `<dist>/index.html` for any path that is NOT `/api/*`, `/health`, `/healthz`, or the FastAPI docs —
  so SPA client-side routing works on deep links / reload. **Register the API routers FIRST and the
  catch-all LAST** so it never shadows an API route.
- Add a **DB-free `/healthz` → `{"status":"ok"}`** (no `db.ping()`), for Fly's health check. Keep
  `/health` (which pings the DB) unchanged for humans.

### D4 — secure cookie (`auth.py` + config)
- Add config `cookie_secure: bool = False` (alias `TVASHTR_COOKIE_SECURE`).
- `set_session_cookie` uses `secure=get_settings().cookie_secure` instead of hardcoded `False`.
- **`clear_session_cookie` MUST pass the SAME `secure=` (and the same `samesite`/`path`)** — browsers
  only clear a cookie when the clearing `Set-Cookie` matches attributes, so a Secure cookie won't log
  out unless logout is also Secure.
- Keep `samesite="lax"` (one-origin = same-site). Local default `False` keeps http dev working; prod
  sets `True`.

### D5 — region-fallback ladder (`fly_machines.py` + `openhands_fly_adapter.py`)
- In `fly_machines.py`, add `parse_regions(raw: str) -> list[str]` MIRRORING `parse_egress_ports`
  (`"bom"` → `["bom"]`; `"sin,iad,fra"` → `["sin","iad","fra"]`; strip/lowercase, drop empties).
- `FlyMachines.__init__` takes `regions: Sequence[str]` instead of `region: str`; update every internal
  reader (`self.region` → `self.regions`). `create_machine` iterates the list, POSTing
  `{"region": r, …}` per region:
  - on a **422 whose body contains `insufficient_capacity`** (surfaced via the existing `FlyApiError`)
    → try the NEXT region (the app already exists — do NOT tear it down);
  - **any OTHER status/error → raise IMMEDIATELY** (never walk the list on a real failure);
  - all regions exhausted → raise a clear `FlyApiError` (e.g. "Fly capacity briefly unavailable in
    sin,iad,fra — retry shortly").
- Thread the parsed list in the ONE config site — `_new_fly_client()`: change `region=settings.fly_region`
  to `regions=parse_regions(settings.fly_region)` (import `parse_regions`). **Keep `fly_region` default
  `"bom"`** so a 1-element list = today's exact single-region behaviour (existing local gates
  byte-identical). Update any test that constructs `FlyMachines(region=…)` to `regions=[…]`.

### D6 — GitHub `redirect_uri` (`github_app.py` + config)
- Add config `public_base_url: str = "http://localhost:8000"` (alias `TVASHTR_PUBLIC_BASE_URL`).
- `build_install_url()` appends `&redirect_uri=<url-encoded {public_base_url}/api/auth/github/callback>`
  (`urllib.parse.quote`). Local default keeps local sign-in working; prod (`https://tvashtr.fly.dev`)
  routes to the deployed callback. Both callbacks are already registered on the App (§2).

### D7 — deploy + migrate + live smoke + Playwright + reproduce-first (CC runs ALL, debugs to green, echoes each decisive line)
Ordered:
1. **Reproduce-first (RED on pre-change code, GREEN after) — write these BEFORE the fixes:**
   - **cookie:** with `cookie_secure=True`, assert `set_session_cookie`'s `Set-Cookie` header contains
     `Secure` (RED on the hardcoded `False`).
   - **region:** a `FlyMachines` unit test with `httpx.MockTransport`: region1 → 422
     `insufficient_capacity`, region2 → 200; assert `create_machine` retried, succeeded, and used
     region2; plus an all-422 case → the clear soft-fail error (RED on the single-region code).
   - **Fly unit tests MUST fake the API** (`httpx.MockTransport` + fake token) — the live
     `TVASHTR_FLY_API_TOKEN` is ambient in `make test`; no test may hit the real API or spend a cent.
2. **Gates green:** `make test` (backend **≥ 880**) + `cd frontend && npm run build` + `npm test`
   (**≥ 379**) + `make lint`. Re-run the FULL lint AFTER all files exist.
3. **Deploy:** `fly deploy -a tvashtr` succeeds; the `release_command` (`alembic upgrade head`) succeeds
   against Neon (full schema + `CREATE EXTENSION vector`).
4. **LIVE smoke on `https://tvashtr.fly.dev`** (curl/httpx against the deployed URL — echo each):
   - `GET /health` → `200 {"status":"ok","db":"ok"}` (Neon reachable + schema present).
   - `GET /healthz` → `200 {"status":"ok"}` (the DB-free check).
   - `GET /api/config` → `hosted_mode: true` AND a `github_install_url` that **CONTAINS
     `redirect_uri=` with `tvashtr.fly.dev`** in it (proves D6).
   - `GET /` serves `index.html` (one-origin SPA root) — a non-`/api` deep link also returns
     `index.html`, not 404 (proves the D3 catch-all).
   - The full GitHub OAuth round-trip needs a real GitHub login — drive it far enough to confirm the
     redirect target, or leave the final click as the operator's numbered eyeball glance.
5. **Playwright self-sign-off (screenshots):** shot the DEPLOYED sign-in page and assert the "Continue
   with GitHub" control is present. **Targeted `browser_evaluate` on specific selectors + screenshots —
   NOT a full-page a11y snapshot** (it hangs on the React Flow canvas). Record screenshot paths in
   `STATE.md`.
6. **Branch + `READY_TO_MERGE`** in `STATE.md`.

---

## 5. Hard invariants (each must be PROVEN, not asserted — echo the proof)

1. **NO new migration.** `alembic heads` ⇒ `0030` (unchanged). The freeze is NOT bumped. The deploy
   RUNS the existing migrations on Neon; it does not add one.
2. **`local` + `docker` sandbox paths are byte-identical in behaviour.** ALL new config has local-safe
   defaults — `cookie_secure=False`, `public_base_url="http://localhost:8000"`, `fly_region="bom"`
   (a 1-element region list = today's single-region POST), `frontend_dist` defaulting so nothing local
   breaks. `make test` stays green; the existing docker/fly live gates are unaffected.
3. **The executor/agent logic is untouched beyond D5 + config threading.** The only `engines/` change
   is `parse_regions` + the region-iteration in `fly_machines.py` and the one-line thread in
   `_new_fly_client`. Prove with a scoped `git diff main -- backend/tvashtr/engines/` review that no
   other engine file changed in behaviour. `team_run.py` stays openhands-free at import.
4. **NO Fly unit test reaches the real API or spends a cent** (§4 D7.1). The fakes are the proof.
5. **Secrets discipline (the C8 invariant) holds.** No staged secret value appears in fly.toml, the
   Dockerfile, `.env.example`, a test, a log, an error, or the transcript. `.env` is NOT copied into
   the image.
6. **The frontend source is unchanged** (you only build it). `git diff main -- frontend/src` (excluding
   any new test) is empty; vitest stays **≥ 379**.

---

## 6. Acceptance — run every one YOURSELF, debug to green, echo the decisive line (CLI-RULES §4.3a)

Do NOT hand the operator commands to run. Echo each as you complete it:

- [ ] The two reproduce-first suites: cookie-`Secure` + region-fallback, shown RED on pre-change code
      then GREEN after (quote the RED failure line, then the GREEN pass).
- [ ] `make test` — **≥ 880** backend passing. Echo the `=== N passed ===` line.
- [ ] `cd frontend && npm run build` — green (tsc-strict + vite).
- [ ] `cd frontend && npm test` — **≥ 379** vitest. Echo the count.
- [ ] `make lint` — clean (re-run AFTER all files exist).
- [ ] `fly deploy -a tvashtr` — succeeded; the release `alembic upgrade head` on Neon succeeded (echo
      the release-command output showing the migrations ran to `0030` + the vector extension).
- [ ] The LIVE `.fly.dev` smoke: `/health` 200 db:ok, `/healthz` 200, `/api/config` hosted_mode:true +
      `github_install_url` containing `redirect_uri=…tvashtr.fly.dev…`, `/` and a deep link serve
      `index.html`. Echo each payload.
- [ ] Playwright: the deployed sign-in page screenshot + the "Continue with GitHub" control asserted
      present. Screenshot paths echoed.
- [ ] `alembic heads` ⇒ `0030` (unchanged). Echo it.
- [ ] The §5 invariant proofs with their actual output (the scoped `git diff` results; the empty
      `frontend/src` diff).
- [ ] `READY_TO_MERGE: branch=feat/m-h4-deploy, sha=<sha>, tests=<N>` in `STATE.md`.

---

## 7. Stop conditions

- **An INFRA blocker** — the Neon release migration fails; the `fly deploy` fails or hits capacity in
  every region; a staged secret is missing so the app can't boot; Neon unreachable — is **not** a code
  bug you can prove and contain ⇒ write `NEEDS_HUMAN: <exact reason>` to `STATE.md` and STOP. **Do not
  loop retrying a deploy.**
- **Split-stop:** a second/unknown problem needing a broad or unproven change ⇒ STOP + `NEEDS_HUMAN`.
  A code-proven, contained, regression-guarded fix to a SINGLE identified cause may proceed.
- Hard cap: **60 turns.**
- Emit the CLI-RULES §4.7 **FINAL REPORT** (all eight sections) at the end, whatever the terminal.

---

## 8. Explicitly OUT of scope (registered deferred — do NOT build)

- **The `tvashtr.online` domain cutover** — DNS + `fly certs add` + swapping the callback / cookie
  domain / origins to the real domain. Done when showing real users; `.fly.dev` first.
- **The slim agent-image lever** — optional cold-boot tuning; measure-then-tune later.
- **The DBOS-holds-Neon-awake watch item** — revisit only if Neon compute-hours climb; do not
  pre-optimise.
- The short-expiry Fly-token rotation is the OPERATOR's cadence chore, not a code task.
- Any frontend *source* change; any new migration; any change to the agent/executor beyond D5.
