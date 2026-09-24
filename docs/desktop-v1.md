# Tvashtr Desktop v1

Status: scaffold on the local box (Electron shell). Cloud Agents were unavailable for this slice; work landed in-repo under `desktop/`.

## Locked product decisions

1. **Architecture option 2** — Electron desktop shell + existing backend APIs. No separate desktop backend.
2. **v1 hosted client only** — control plane is `https://tvashtr.fly.dev`. No shipping a local FastAPI stack inside the desktop app for v1.
3. **UI reuse + thin chrome** — load the existing React/Vite frontend inside Electron. Do **not** build a parallel desktop-specific product UI.
4. **Dual-engine credentials (later)** —
   - **Hosted runs (now):** API keys / BYOK via the existing account settings (same as web).
   - **Subscription engines:** Claude / Grok nodes run on the user's own installed CLI via the Desktop runner (see below); Codex is status-only.
5. **Secrets hygiene** — no real `.env` keys in the desktop tree; no committing secrets.

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

## Desktop detection

`desktop/electron/preload.cjs` exposes:

```js
window.tvashtrDesktop // truthy object: { engines: { getStatus, connect, disconnect, refresh, onStatus } }
window.tvashtrDesktopInfo // { shell: "electron", version: 3 }
```

Check it by truthiness (`if (window.tvashtrDesktop)`), never `=== true`.

Optional FE use: hide marketing CTAs or “open in browser” affordances later. v1 does not require large FE changes.

## Subscription engines — the Desktop runner (M-subs-desktop)

Tvashtr Desktop runs a team's **Claude** and **Grok** nodes with the user's OWN installed CLI and
the user's own sign-in — the way October Desktop does it. Analogy: a GitHub Actions self-hosted
runner. The hosted control plane still owns the team graph (routing, gates, documents, loop caps,
PR shipping); only a subscription node's "hands" run on the user's machine.

| Piece | Where | What it does |
|-------|-------|--------------|
| Engines cards | `frontend/src/components/EnginesShelf.tsx` | Status asked of each CLI (`claude auth status --json`, `grok models`). **Connect** opens the vendor's own login in Terminal (`claude auth login`, `grok login`); the card re-checks when the window regains focus. Disclosure shown on the cards and once per Desktop launch. |
| Status mirror | `PUT /api/engines/subscriptions/{p}` | Pushed by the Electron main process at launch and on connect / refresh / disconnect. Status only — never a token. |
| Runner | `desktop/electron/runner/` | Polls `POST /api/desktop-runner/claim` (each poll is the heartbeat), unpacks the job's workspace snapshot in a temp dir, runs the CLI headless, streams its output as run events, posts back the final text + a `git diff --binary`. One job per provider at a time. Quitting Desktop kills in-flight CLIs. |
| Engine adapter | `backend/tvashtr/engines/desktop_runner_adapter.py` | Queues the node job (idempotent on run/node/iteration), waits, applies the patch; a Desktop that stops checking in fails the node: *"Tvashtr Desktop went offline — reopen it and retry."* |
| Many machines | `control_plane/desktop_jobs.py` ⇄ `desktop_runner_routes.py` | Prod runs several Fly machines with separate disks; the workspace lives only on the machine running the workflow. A job records that `FLY_MACHINE_ID` (and follows a DBOS recovery onto another machine); a snapshot GET landing elsewhere answers 409 + `fly-replay: instance=<id>;timeout=10s;fallback=force_self`, so Fly's proxy replays it there. The runner retries a snapshot 409 a few times. Claim / events / result are Postgres-only, so any machine answers them. |
| Launch rule | `control_plane/credential_gate.py` ⇄ `frontend/src/lib/engines.ts` | One rule, one shared case file (`credentialGate.cases.json`): on a **Desktop** launch a FRESH connected Claude/Grok subscription (mirror connected AND the runner polled within ~2 min) covers its provider in place of an API key. **Hosted launches still need an API key.** |

Compliance model (brief `prompts/m-subs-desktop.md` §3.0): Tvashtr never reads `~/.claude*`,
`~/.grok/` (other than finding the executable in its `bin`), `~/.codex/auth.json` or the Keychain;
never uses `setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`; every CLI child gets a clean env with
`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `XAI_API_KEY`,
`OPENAI_API_KEY`, `CLAUDECODE` and `CLAUDE_CODE_*` removed (`desktop/electron/harness/spawnEnv.cjs`).

Headless commands (verified with `--help` + live runs):

- Claude Code: `claude -p --output-format stream-json --verbose --model <m> --permission-mode acceptEdits --permission-prompts none --restricted --safe-mode --no-session-persistence` (prompt on stdin). Its `init` event reports `apiKeySource: none` on a subscription login.
- Grok Build: `grok --prompt-file <f> --output-format streaming-json -m <m> --cwd <dir> --tools read_file,search_replace,write,list_dir,grep,todo_write --allow Edit --allow Read --allow Grep --sandbox workspace`.

Live gate: `node desktop/scripts/live-subscription-gate.mjs run|offline` (Playwright `_electron`,
local backend only — see the script header). Codex: status/Connect only; it does not run nodes yet.

## Distribution (Option 3)

Unsigned Mac `.dmg` via GitHub Releases + landing **Download for Mac** CTA.
See [`desktop-dmg-releases.md`](./desktop-dmg-releases.md).

## Explicitly not done in v1

- Apple notarization / Developer ID signing / auto-update
- A Tvashtr-owned "Sign in with Claude/Grok" (by design — sign-in happens only inside the vendor's own CLI)
- Auth cookie hardening beyond proxy Domain+Secure strip (e.g. partitioned cookies, custom Electron session partition policies)
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
