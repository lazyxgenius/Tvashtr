# M-subs-desktop — Claude and Grok subscriptions actually run a team on Tvashtr Desktop

> Architect brief, 2026-09-24 (v2 — adds the October-style compliance model). Read this whole file before planning. It is the source of truth for this milestone; the `/goal` points here.

## 0. Why this milestone exists

The operator cannot use his Claude and Grok **subscriptions** (his own `claude` / `grok` CLI logins) for the agents in his teams inside **Tvashtr Desktop** (the Electron app in `desktop/`). A Grok-driven session was partway through fixing this and stopped; its half-done changes were probably never pushed. Your first job is to find out whether any of that work exists anywhere, then fix the problem for real — the same way October Desktop (october.dev) does it (§3.0).

## 1. Where the code is (important — `main` is far behind)

- GitHub `origin/main` is at `df1c63d` (docs only). **All recent work is on stacked, unmerged branches.** The newest tip is `origin/feat/domains-eval-graph-polish` @ `f20664a` ("fix(desktop): enrich harness PATH so Dock finds npm-global CLIs"), which contains ~123 commits beyond `origin/main`, including `feat/subscription-connect-dual-engine`, `feat/harness-real-cli-auth`, `feat/engines-hosted-clarity`, `fix/hosted-credential-cta` and `fix/desktop-harness-path-detect` (same sha as the tip).
- The local checkout is on `feat/domains-eval-graph-polish`. Local `main` (`ed39e5a`) is behind `origin/main`. **Do not touch `main`, and do not try to merge the stack into it** — that is a separate housekeeping task.
- `HANDOVER.md` is stale (2026-09-08). Everything since 2026-09-13 is recorded only in git history and in `docs/superpowers/specs/` + `docs/superpowers/plans/`. Read:
  - `docs/superpowers/specs/2026-09-15-subscription-connect-dual-engine-design.md` (the design; "Approach A — no secrets to Fly" is locked)
  - `docs/superpowers/plans/2026-09-15-subscription-connect-dual-engine.md`
  - `docs/desktop-v1.md`, `desktop/README.md`
  - `git log --oneline origin/main..origin/feat/domains-eval-graph-polish`
  - `PROJECTPLAN.md` — **never read line 6** (an ~80K-char banner blob). Index headers with `grep -nE '^#{1,3} ' PROJECTPLAN.md`, then read sections with `sed -n 'A,Bp'`.

## 2. Architect diagnosis (UNPROVEN until you reproduce it — reproduce-first)

**F1 — Run on Desktop never uses the subscription.** The FE on Desktop sets `launchTarget = "local"` (`App.tsx` ~L605, `TeamNodePanel.tsx` ~L567) and, via `missingProvidersForModels` in `frontend/src/lib/engines.ts`, enables **Run** when a connected subscription covers a node's provider. But clicking Run still calls the hosted `POST /api/runs` (through the Desktop's local proxy to `tvashtr.fly.dev`). Nothing in `frontend/src` calls `window.tvashtrDesktop.runs.startLocal` (it is only typed in `vite-env.d.ts`). The server preflight (`routers.py` ~L1055, `_missing_provider_credentials` → 422, `subscription_only` wording) refuses a subscription-only team — or, if an API key exists for that provider, the run silently spends the API key instead of the subscription. The FE and server disagree, and neither path ever reaches the user's CLI.

**F2 — The local runner is a placeholder.** `desktop/electron/harness/localRuns.cjs` spawns `node -e "...skeleton ready..."` and idles. No agent, no team graph, no CLI call. Its own header says "YAGNI: no full agent loop; log-only placeholder worker."

**F3 — Auth probes run without the enriched PATH.** `f20664a` enriched PATH only for *finding* the binary (`pathDetect.cjs`). The probes in `claude.cjs` / `grok.cjs` / `codex.cjs` call `execFile` with no `env`, so they inherit the Dock-launched app's thin PATH. An npm-global CLI is a `#!/usr/bin/env node` script; with no `node` on that PATH the probe exits non-zero and the card says "Needs login" even though the user is logged in. Also `claude.cjs` `startLogin` runs `claude auth login` through a blocking 15-second `execFile`. Check what the **installed** CLIs actually support (`claude --help`, `claude auth --help`, `grok --help`) — don't trust the flags the current code assumes (`claude auth status`, `claude whoami`, `grok models`).

**F4 — Unverified:** whether Desktop ever pushes its status to `PUT /api/engines/subscriptions/{provider}` (the client call exists in `frontend/src/lib/api.ts`). Check and report.

**F5 — The Grok harness breaks the compliance model (§3.0).** `grok.cjs` `probeAuthFile` reads `$GROK_HOME/auth.json` / `~/.grok/auth.json` to decide "logged in", and `probeAuth` reports a connected **subscription** whenever `XAI_API_KEY` is set. Tvashtr must never read a vendor's credential file, and an API key is not a subscription. Remove both; ask the CLI itself.

If reproducing shows a different or additional root cause, follow the evidence and report it.

## 3. The decision (settled — build this)

### 3.0 Compliance model — do it the way October Desktop does

October Desktop runs each vendor's **own, unmodified** CLI (Claude Code, Codex, Grok…) as a real process on the user's own computer. The user signs in **inside that CLI**. October never reads, copies, stores or forwards the vendor's login. Tvashtr copies exactly that.

Why this is the line: Anthropic's Claude Code legal page (https://code.claude.com/docs/en/legal-and-compliance, read 2026-09-24) says third parties may not "offer Claude.ai login into their own applications", "route requests through Free, Pro, or Max plan credentials on behalf of their users", or "collect, store, or intermediate Claude.ai credentials or session tokens" — but that this does not "prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Tools Anthropic blocked in Jan/Apr 2026 (OpenCode, OpenClaw) lifted the login token into their own code; tools that run the real binary (Conductor, Zed, October) were not blocked. xAI documents Grok Build's headless mode (`-p`) for "agent orchestration apps" (https://docs.x.ai/build/cli/headless-scripting).

**DO**
- Run the vendor's published binary from the user's own install, unmodified, on the user's own machine only.
- Detect "installed" with the binary itself (`which` / `--version`). Detect "logged in" by **asking the CLI** (a documented status command; if none exists, a tiny prompt run only on an explicit Connect/Refresh, never on a timer).
- **Connect = open the user's Terminal running the vendor's own login** (whatever the installed CLI documents, e.g. `claude` → `/login` or `claude auth login`; `grok login`), then re-probe when the window regains focus / on Refresh. Sign-in always completes in the vendor's own flow.
- Store only status on the server (`connected`, `checked_at`, optional non-secret account hint).
- Give every job its own temporary copy of the repo; send back only the result and the patch.
- Spawn children with a clean env: **remove** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `XAI_API_KEY`, `OPENAI_API_KEY` and inherited Claude Code session vars (`CLAUDECODE`, `CLAUDE_CODE_*`), so the CLI uses the user's own sign-in and never an API key by accident. Add the enriched PATH.
- Keep usage "ordinary, individual": at most **one running subscription job per provider per user**; further jobs queue and the node log says "Waiting for your Claude subscription — one job at a time".
- Show this disclosure on the Engines subscription cards and once at Desktop launch: "Tvashtr runs your own installed Claude Code / Grok on this computer. You sign in inside that tool — Tvashtr never sees or stores your login. Usage counts against your own plan and follows Anthropic's / xAI's terms. Tvashtr isn't affiliated with or endorsed by Anthropic or xAI."

**NEVER**
- Read `~/.claude*`, `~/.grok/`, `~/.codex/auth.json`, or the macOS Keychain (`security find-generic-password` etc.). Never parse a vendor credential file for any reason.
- Use `claude setup-token`, set `CLAUDE_CODE_OAUTH_TOKEN`, or pass any token to a child process.
- Proxy vendor traffic through Tvashtr's servers, or run a subscription job anywhere except the owner's own Desktop (never Fly, never another user's machine).
- Build a Tvashtr-owned "Sign in with Claude/Grok" flow, or use the Agent SDK with claude.ai login.
- Pass flags that disable or restrict the CLI's own auth methods, or patch the binary.
- Treat an API key as a subscription.

### 3.1 The architecture

**The hosted control plane stays the one and only executor. The user's Desktop becomes a runner for subscription nodes.** Analogy: a GitHub Actions self-hosted runner — GitHub still owns the workflow, but the job's steps run on your own machine with your own logins.

Why: routing, gates, documents, loop caps and PR shipping are the product's core (`control_plane/team_run.py`). Rebuilding a graph executor in Electron JavaScript would fork that core. The engine-adapter boundary (`backend/tvashtr/engines/base.py`, `registry.py`) is exactly where a second way of running an agent is meant to plug in. Only the agent's "hands" move to the Desktop; the "brain" stays put.

### 3.2 Backend

- A launch from Desktop marks the run as **desktop-targeted** (e.g. a new optional field on `CreateRunRequest`; default keeps every existing caller byte-for-byte unchanged).
- A new engine adapter (e.g. `engines/desktop_runner_adapter.py`, registered lazily in `registry.py`) handles **agent and completion nodes** whose model provider maps to a subscription (`anthropic` → claude, `xai`/`grok` → grok; reuse `_MODEL_PROVIDER_TO_SUB`) **only** on desktop-targeted runs. Every other node keeps its current path.
- The adapter enqueues a **node job** and waits durably for its result. It must be DBOS-safe: idempotent on (run_id, node_id, attempt); a crash/recovery must not double-dispatch or double-apply. A timeout (Desktop closed / runner offline) fails that node with a readable error: "Tvashtr Desktop went offline — reopen it and retry." Pick the mechanism (DBOS messaging, a table, etc.) from the existing code; at most **one** new migration.
- Secret-free, session-authenticated, **owner-scoped** endpoints for the runner: claim the next job (only the run owner's jobs, ever); fetch the job's **workspace snapshot** (e.g. a `git bundle` or tarball of the run workspace at the node's base commit); stream events into the existing `RunEvent` sink; post the result (final text, outcome label, and a `git diff --binary` patch against the base). The control plane applies the patch and continues exactly as after an OpenHands node. Reject any body containing token/cookie/api-key-like fields (same guard as the status mirror).
- **Preflight:** for a desktop-targeted launch, a connected subscription mirror counts in place of an API key, but only if **fresh** (recent `checked_at`). Hosted launches unchanged: API key still required. A subscription job can never be executed by the Fly/OpenHands path.
- Read how the OpenHands adapters build the node's task/prompt, harvest the outcome label and report files changed — **reuse that; don't invent a second convention.**

### 3.3 Desktop (Electron main process)

- Replace the `localRuns.cjs` placeholder with a **runner loop**: while the app is open and a subscription is connected, poll/claim the signed-in user's jobs (through the same local proxy and session cookie the UI uses), materialize the workspace in a temp dir under `userData`, run the CLI headless, stream output as events, post the result, clean up.
- **Headless, vendor-documented modes only** (confirm every flag with `--help` on this Mac): Claude → `claude -p` in the workspace dir with streaming JSON output, the node's model passed to `--model` in a form the installed CLI accepts, edits allowed only inside that dir. Grok → `grok -p … --output-format streaming-json` (xAI headless docs), plus `--no-auto-update` if supported.
- Fix F3 and F5 in all harnesses: every spawn (probe, login, run) uses the clean env + enriched PATH from §3.0; login never blocks the main process; no credential-file reads anywhere.
- Push status to the mirror (`PUT /api/engines/subscriptions/{provider}`) on connect, refresh and disconnect so the server preflight knows what is live.
- Quitting Desktop stops the runner; in-flight jobs time out server-side with the readable error.
- Codex: out of scope beyond the shared helpers — don't break it.

### 3.4 Frontend

- On Desktop, Run posts to `/api/runs` with the desktop target. The FE credential gate must agree with the server preflight exactly (one rule, tested on both sides).
- Engines cards: Connect opens the vendor login in Terminal (§3.0); the disclosure text is shown.
- Node picker label for a covered model: "via your Claude subscription · runs on this computer" (Grok likewise).
- The run canvas stays the same as today: nodes light up, gates, documents, the PR at the end. The subscription node's live log shows the CLI output.

### 3.5 What the user sees when this is done

On Tvashtr Desktop, even when opened from the Dock, Engines shows **Claude — Connected** and **Grok — Connected**. If not signed in, **Connect** opens Terminal with Claude's (or Grok's) own sign-in; after signing in there, the card flips to Connected. A short note on the cards says Tvashtr runs your own installed tool and never sees your login. On a team, a node on an `anthropic/…` or `xai/…` model shows "via your Claude subscription · runs on this computer". **Run** looks exactly like today, with the Claude/Grok CLI output streaming into that node's log, no API key needed and nothing billed per token. Two Claude nodes at once? The second waits its turn, and its log says so. Close Desktop mid-run → the run stops with "Tvashtr Desktop went offline". On the web app, the same team still asks for an API key.

## 4. Invariants (show each as evidence)

1. **Never push** (the `protect-no-push.sh` hook enforces it). New branch `fix/desktop-subscription-runs` from `origin/feat/domains-eval-graph-polish`. Don't touch `main`. Don't merge.
2. **Existing migrations are frozen** — never edit one. At most one new migration.
3. **Compliance (§3.0):** a grep over `desktop/` and `backend/` shows no read of `~/.claude`, `~/.grok`, `~/.codex/auth.json`, `auth.json`, the Keychain (`security `), no `CLAUDE_CODE_OAUTH_TOKEN` / `setup-token` use, and the child-env builder strips the listed vars (unit-tested). A test proves `XAI_API_KEY` alone does NOT make Grok "connected".
4. **No secret reaches the server:** the runner endpoints' accepted fields + a test rejecting secret-bearing bodies. Nothing from vendor logins reaches Postgres, logs or run events.
5. **Hosted behaviour unchanged** — a non-desktop launch still requires an API key; all existing tests stay green.
6. **BYOK/OpenHands path unchanged** — `git diff` on `engines/openhands_*_adapter.py` empty, or each change justified in the report.
7. **No `fly deploy`.** Local only.
8. Commit only your own paths. Never commit `prompts/*.md`, `HANDOVER.md`, `PROJECTPLAN.md`.

## 5. Gotchas (from past sessions)

- `make test` **wipes the operator's provider credentials** — run `make seed` before any live gate.
- Cancel stale runs before a live gate or the fleet ceiling 429s you: `docker exec tvashtr-postgres psql -U tvashtr -d tvashtr -c "update runs set status='cancelled' where status in ('pending','running','awaiting_human');"` Never raise the ceiling env vars to get around it.
- Postgres container is `tvashtr-postgres`; use `docker compose start postgres`, not `up`.
- Never edit `frontend/src` while a Playwright/Vite live gate is running (HMR resets the run view).
- Playwright's full-tree accessibility snapshot chokes on the React Flow canvas — use targeted locators + screenshots.
- `.env` line 13 (`x-api-key=`) isn't a shell-valid identifier; don't `source` `.env` blindly.
- This Claude Code session itself may export `ANTHROPIC_API_KEY` / `CLAUDECODE`; the clean-env rule is exactly what stops a test run from billing an API key or tripping nested-session detection.

## 6. Stop conditions

Write `NEEDS_HUMAN: <reason + the exact one-line command the operator should run>` to `STATE.md` and stop when: a CLI isn't installed or isn't logged in on this Mac (e.g. the operator must run `grok login`); GitHub App / permission problems; anything that would need a deploy; any step that seems to require reading a vendor credential file (that means the approach is wrong — stop). A second, unknown root cause that needs a broad or unproven change → stop and report. A contained, code-proven, regression-guarded fix → you may proceed.

## 7. Final report (in chat AND appended to `STATE.md`)

- Grok leftovers: what you found (or didn't) and what you did with it.
- Per-file: what changed and why.
- The §3.0 DO/NEVER list, each line marked met, with the evidence.
- Decisive evidence quoted verbatim; every command run with its result.
- Deviations from this brief, with justification. Anything touched outside scope.
- What you deliberately did not do. Residual risks.
- Last line: `READY_TO_MERGE: YES|NO branch=fix/desktop-subscription-runs sha=<sha> tests=<backend>/<vitest>/<desktop>`

## 8. Operator amendments (2026-09-24 — these OVERRIDE §2/§3 where they differ)

- **A1 — F3 corrected.** The real Dock bug is that `pathDetect` misses `~/.grok/bin` (Grok shows `needs_install`). Add the vendor-installer bin dirs (`~/.grok/bin`, `~/.local/bin`, `~/.claude/local`). Under `~/.grok` and `~/.claude`, code may touch ONLY the executable path, never any other file; the §4.3 grep allows exactly those bin paths.
- **A2 — Login check.** Claude: `claude auth status --json`, read `loggedIn` + `authMethod`; only a `claude.ai` subscription login counts as subscription-connected — if the CLI is on an API key the card says so and it doesn't count. Grok: `grok models` text as today, minus the `auth.json` and `XAI_API_KEY` fallbacks. No `--no-auto-update`.
- **A3 — Fresh.** Fresh = a Desktop runner for this user polled recently (heartbeat, ~2 min) AND the mirror says connected. The main process pushes status at app launch and on connect/refresh/disconnect; runner polls are the heartbeat. No timed CLI re-probes.
