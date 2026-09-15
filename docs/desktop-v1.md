# Tvashtr Desktop v1

Status: scaffold on the local box (Electron shell). Cloud Agents were unavailable for this slice; work landed in-repo under `desktop/`.

## Locked product decisions

1. **Architecture option 2** — Electron desktop shell + existing backend APIs. No separate desktop backend.
2. **v1 hosted client only** — control plane is `https://tvashtr.fly.dev`. No shipping a local FastAPI stack inside the desktop app for v1.
3. **UI reuse + thin chrome** — load the existing React/Vite frontend inside Electron. Do **not** build a parallel desktop-specific product UI.
4. **Dual-engine credentials (Approach A)** —
   - **Hosted Fly microVM:** BYOK / API keys via `/api/providers` only. Subscription status never satisfies hosted preflight.
   - **Local Desktop subscription:** Claude → Grok → Codex harness adapters; status in OS `safeStorage`; prefer-subscription for local runs. Status-only mirror to Fly — **no tokens/cookies**.
5. **Secrets hygiene** — no real `.env` keys in the desktop tree; no committing secrets; subscription credentials never leave the Desktop host.

## Why Electron

- Reuses the web UI with minimal new surface area.
- Gives a native window, in-window GitHub OAuth (OS browser only for unrelated external links), and a place to add secure credential storage later.
- Alternatives considered and deferred: Tauri (more FE/build churn for v1), pure PWA (weaker OS integration / credential story).

## How the UI reaches the API

The production web app is **one-origin by design**: the FastAPI process serves both `/api/*` and the SPA (`mount_frontend` in `backend/tvashtr/main.py`). Session cookie `tv_session` is `SameSite=lax` (+ `Secure` on Fly). That only works when the page and `/api` share an origin.

Implications for desktop:

| Approach | Verdict for v1 |
|----------|----------------|
| `file://` + absolute `VITE_API_BASE=https://tvashtr.fly.dev` | Rejected — CORS + third-party cookies. |
| Electron loads fly.dev directly | Works as a thin browser, but does not “bundle” the FE; weaker offline/version pinning. Acceptable fallback, not the preferred path. |
| **Local HTTP origin + reverse proxy** (chosen) | Serve built FE from `http://127.0.0.1:<port>/`, proxy `/api` and `/health` to fly.dev. Relative fetches stay same-origin; cookies stay first-party to localhost. |

Runtime knob: `TVASHTR_API_BASE` (default `https://tvashtr.fly.dev`).  
`VITE_API_BASE` is documented as an **alias for that proxy target**, not as a baked absolute prefix inside the SPA for v1. Baking an absolute fly.dev base into the FE would re-open CORS/cookie breakage unless the server grows explicit localhost CORS + `SameSite=None` (out of scope; residual risk for later).

### Dev vs start

- **`npm run dev`**: Vite on `:5173` with `TVASHTR_API_PROXY_TARGET` → fly.dev (existing Vite proxy in `frontend/vite.config.ts`).
- **`npm run build` / `npm start`**: Vite build → `desktop/dist-fe`, then Electron starts `scripts/local-server.cjs` (Express static + `http-proxy-middleware`).


## GitHub OAuth (desktop login)

Web login on fly.dev is unchanged. Desktop uses a **loopback callback** so the `tv_session` cookie is set on `http://127.0.0.1:<port>` (same origin as the SPA + local `/api` proxy).

### One-time GitHub App setup (operator)

In the GitHub App settings → **Callback URL**, register **all** of:

1. `https://tvashtr.fly.dev/api/auth/github/callback` (hosted web — already required)
2. `http://localhost:8000/api/auth/github/callback` (local FastAPI — already required)
3. **`http://127.0.0.1:5178/api/auth/github/callback`** (desktop `npm start` default port)
4. Optional for `npm run dev`: `http://127.0.0.1:5173/api/auth/github/callback`

GitHub allows multiple callback URLs. Without (3)/(4), desktop authorize with a loopback `redirect_uri` is rejected by GitHub.

### Flow

1. FE detects `window.tvashtrDesktop` and rewrites `github_install_url`'s `redirect_uri` to `{window.location.origin}/api/auth/github/callback`.
2. Electron keeps GitHub OAuth / App-install URLs **in the BrowserWindow** (`loadURL`), not `shell.openExternal`.
3. GitHub redirects to the loopback callback; `local-server.cjs` (or Vite with `TVASHTR_DESKTOP_ORIGIN`) proxies `/api` → fly.dev and adds:
   - `X-Tvashtr-Redirect-Uri: http://127.0.0.1:<port>/api/auth/github/callback`
   - `X-Tvashtr-Frontend-Origin: http://127.0.0.1:<port>`
4. Fly `github_callback` allowlists those headers (127.0.0.1 / localhost only), passes `redirect_uri` into the token exchange, and redirects to the loopback SPA origin.
5. Proxy strips `Domain` and `Secure` from `Set-Cookie` so Electron stores `tv_session` on http loopback.
6. Safety net: if a post-login bounce still lands on `tvashtr.fly.dev`, Electron `will-navigate` / `will-redirect` forces the window back to the local origin.

Email/password login already works through the same proxy once `Secure` is stripped.

### Explicitly not done

- Changing Fly secrets / live GitHub App config from this box (operator registers callbacks manually)
- Session handoff tokens / opening OAuth in the OS browser

## Dual-engine credentials (Approach A)

| Engine path | Behavior |
|-------------|----------|
| Hosted Fly microVM | BYOK / API keys via `/api/providers` only. Subscription status never satisfies hosted preflight. |
| Local Desktop subscription | Claude → Grok → Codex harness adapters in `desktop/electron/harness/`. Status in OS `safeStorage`. Status-only mirror: `GET/PUT/DELETE /api/engines/subscriptions`. **No tokens/cookies to Fly.** |
| Prefer-subscription | Automatic for local Desktop runs when connected; BYOK for hosted. |
| Continuity | Quitting Desktop stops local/subscription runs. Fly BYOK runs can continue. |

### Desktop IPC

`window.tvashtrDesktop` is a truthy object:

- `engines.getStatus()` / `connect(provider)` / `disconnect(provider)` / `refresh(provider)`
- `runs.startLocal` / `stopLocal` / `subscribeLogs` (skeleton)

`window.tvashtrDesktopInfo.version` ≥ 2.

FE detection: prefer truthiness (`if (window.tvashtrDesktop)`), not `=== true`.

Same Engines shelf UI on web + Desktop; Connect is enabled only on Desktop (web cards show mirrored status, disabled).

## Explicitly not done in v1

- macOS `.dmg` / notarization / auto-update
- OAuth secondary Connect — only where a provider documents a desktop-safe path (harness-first is primary)
- Auth cookie hardening beyond proxy Domain+Secure strip (e.g. partitioned cookies, custom Electron session partition policies)
- Pushing from this Linux box if `gh` / git remotes lack credentials
- Loading a fully offline backend / full OpenHarness local stack
- Shipping subscription secrets or cookies to Fly

## Layout

```
desktop/
  README.md
  package.json
  electron/main.cjs      # BrowserWindow + lifecycle
  electron/preload.cjs   # window.tvashtrDesktop object bridge
  electron/harness/      # Claude / Grok / Codex subscription adapters
  scripts/local-server.cjs
  scripts/build.mjs
  scripts/dev.mjs
  scripts/start.mjs
  dist-fe/               # gitignored build output
docs/desktop-v1.md       # this file
```
