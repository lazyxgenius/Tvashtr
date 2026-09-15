# Tvashtr Desktop (v1)

Electron shell around the **existing** React/Vite frontend. Hosted control-plane API:
`https://tvashtr.fly.dev`.

See [`../docs/desktop-v1.md`](../docs/desktop-v1.md) for architecture decisions.

## Prerequisites

- Node 20+
- From repo root: frontend dependencies available (`cd frontend && npm ci` once)

## Scripts

| Script | What it does |
|--------|----------------|
| `npm run build` | Builds `../frontend` into `desktop/dist-fe` (Vite). Leaves `VITE_API_BASE` empty; API is reached via the local reverse proxy at runtime. |
| `npm run start` | Serves `dist-fe` on `127.0.0.1`, proxies `/api` + `/health` → `TVASHTR_API_BASE` (default `https://tvashtr.fly.dev`), opens Electron. |
| `npm run dev` | Starts Vite on `:5173` with `TVASHTR_API_PROXY_TARGET` → fly.dev, then opens Electron on that origin. |

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `TVASHTR_API_BASE` | `https://tvashtr.fly.dev` | Hosted API the local proxy targets (`VITE_API_BASE` accepted as alias for the proxy target). |
| `TVASHTR_DESKTOP_PORT` | `5178` | Preferred local static-server port (`start` path). |
| `TVASHTR_DESKTOP_DEV_URL` | `http://127.0.0.1:5173` | Override Electron load URL in `dev`. |
| `TVASHTR_DESKTOP_SMOKE` | unset | If truthy, Electron quits after a short load (CI / xvfb smoke). |
| `VITE_API_BASE` | empty at FE build | **Do not** point the built SPA at fly.dev absolutely in v1 — that breaks one-origin cookies/CORS. Use the local proxy instead. |

## Mac (Pagani / Aditya)

```bash
git pull   # once the desktop branch/commits are on the remote
cd desktop
npm ci
npm run build
npm start
# or iterative:
npm run dev
```

No `.dmg` / notarization in v1 — `electron .` / `npm start` only.

## Linux smoke (headless)

```bash
cd desktop && npm ci && npm run build
TVASHTR_DESKTOP_SMOKE=1 xvfb-run -a npm start
```


## GitHub login (required App callback)

Desktop rewrites the OAuth `redirect_uri` to the local server:

`http://127.0.0.1:5178/api/auth/github/callback` (`npm start`)  
or `http://127.0.0.1:5173/api/auth/github/callback` (`npm run dev`).

**Register that callback URL on the GitHub App** (in addition to fly.dev + localhost:8000). See [`../docs/desktop-v1.md`](../docs/desktop-v1.md#github-oauth-desktop-login).

OAuth stays inside the Electron window; the local proxy forwards the callback to fly.dev with desktop headers and strips `Domain`/`Secure` on `Set-Cookie` so `tv_session` sticks on loopback.

## Desktop detection

`preload.cjs` exposes `window.tvashtrDesktop` as a truthy object bridge (`engines.*`, `runs.*`) and `window.tvashtrDesktopInfo` (`version` ≥ 2). FE detection: prefer truthiness (`if (window.tvashtrDesktop)`), not `=== true`. The FE rewrites `github_install_url` for loopback OAuth when the bridge is present.

See [`../docs/desktop-v1.md`](../docs/desktop-v1.md#dual-engine-credentials-approach-a) for Approach A dual-engine / subscription Connect.
