# Tvashtr Desktop v1

Status: scaffold on the local box (Electron shell). Cloud Agents were unavailable for this slice; work landed in-repo under `desktop/`.

## Locked product decisions

1. **Architecture option 2** — Electron desktop shell + existing backend APIs. No separate desktop backend.
2. **v1 hosted client only** — control plane is `https://tvashtr.fly.dev`. No shipping a local FastAPI stack inside the desktop app for v1.
3. **UI reuse + thin chrome** — load the existing React/Vite frontend inside Electron. Do **not** build a parallel desktop-specific product UI.
4. **Dual-engine credentials (later)** —
   - **Hosted runs (now):** API keys / BYOK via the existing account settings (same as web).
   - **Subscription engines (later):** Claude / ChatGPT / Grok harness or OAuth — stub only in v1; not implemented.
5. **Secrets hygiene** — no real `.env` keys in the desktop tree; no committing secrets.

## Why Electron

- Reuses the web UI with minimal new surface area.
- Gives a native window, OS open-external for GitHub OAuth/manage links, and a place to add secure credential storage later.
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

## Desktop detection

`desktop/electron/preload.cjs` exposes:

```js
window.tvashtrDesktop === true
window.tvashtrDesktopInfo // { shell: "electron", version: 1 }
```

Optional FE use: hide marketing CTAs or “open in browser” affordances later. v1 does not require large FE changes.

## Dual-engine credentials (stub)

| Engine path | v1 | Later |
|-------------|----|-------|
| Hosted Fly runs | Account BYOK / provider keys via existing `/api/providers` UI | unchanged |
| Claude / ChatGPT / Grok **subscriptions** | Not wired | Harness or OAuth tokens in OS-secure storage; never in git |

Desktop may eventually call `safeStorage` / keytar; not in this slice.

## Explicitly not done in v1

- macOS `.dmg` / notarization / auto-update
- Subscription OAuth / harness login
- Auth cookie hardening beyond proxy Domain-strip (e.g. partitioned cookies, custom Electron session partition policies)
- Pushing from this Linux box if `gh` / git remotes lack credentials
- Loading a fully offline backend

## Layout

```
desktop/
  README.md
  package.json
  electron/main.cjs      # BrowserWindow + lifecycle
  electron/preload.cjs   # window.tvashtrDesktop
  scripts/local-server.cjs
  scripts/build.mjs
  scripts/dev.mjs
  scripts/start.mjs
  dist-fe/               # gitignored build output
docs/desktop-v1.md       # this file
```
