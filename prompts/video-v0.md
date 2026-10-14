# Brief — Video V0: prove the demo-film toolchain

Architect: Tvashtr Sidechat-19, 2026-10-03. Path: `/Users/adimac/Desktop/Tvashtr/prompts/video-v0.md`.
`prompts/` is untracked: never commit it. Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins (CLI-RULES' numbers and milestone list are out of date).

## What the film is (context)

We are making a demo film of Tvashtr: one ~7-minute main film in 8 chapters, plus a 90-second
highlight and vertical shorts, all cut from the same footage. It is shot in the **Tvashtr Desktop
app**, running against a **local copy of Tvashtr** (same code as the live site), with agents running
on the operator's own **Claude and Grok subscriptions** through the Desktop runner. Every take is a
script that can be re-run. Product Demo Director edits and renders. Honesty rules: every agent
action shown is a real run (labelled when sped up); sample-data mode only for screens that need weeks
of history; no secrets on screen.

V0 is the first of seven video steps. Its only job: **prove the toolchain end to end before anything
is filmed for real.** Nothing in V0 changes the product.

## Where things are (checked by the architect on disk, 2026-10-03)

- `main` = `origin/main` = `e30b8bd9`, checkout on `main`. Alembic head `0052`; the freeze hook covers
  `0001`–`0052`. No `video/` folder yet.
- `desktop/scripts/live-subscription-gate.mjs` drives the REAL Desktop app (the dev Electron binary
  under `desktop/node_modules/electron/`) with Playwright against a LOCAL backend: sign-in → Engines
  (Claude and Grok "Connected") → a 2-node team (PM on `xai/grok-4.7`, Engineer on
  `anthropic/claude-sonnet-5`) → Run → gate → PR. It needs `make db-up`, `make backend` (:8000), Vite
  on :5173 proxying `/api` → :8000 (see `desktop/README.md`), `make seed` + `scripts/demo_proof_seed.py`,
  and the operator signed in to the `claude` and `grok` CLIs on this Mac. It asserts the account holds
  NO anthropic/xai API key: that is what proves the subscription path.
- The local operator's working provider keys (STATE.md, M10/M11): deepseek, groq, nvidia_nim. The
  openai and gemini rows were removed from the local DB; both accounts are out of credit or quota.
- The Desktop runner gives each job its own temporary copy of the repo under Electron's userData
  (`desktop/electron/runner/workspace.cjs`).
- The stall guard (M1): `TVASHTR_QUIET_AFTER_S` (default 90), `TVASHTR_STALLED_AFTER_S`,
  `TVASHTR_STALL_FAIL_AFTER_S`, the sweep `TVASHTR_STALL_SWEEP` / `TVASHTR_STALL_SWEEP_CRON`
  (`backend/tvashtr/config.py`); the proof harness `TVASHTR_FORCE_HANG_ROLE` (a host-side simulated
  hang that never reaches the Desktop runner).
- `scripts/design-parity/` renders the real frontend on canned fixtures (`shoot-app.mjs`; `desktop: true`
  scenarios emulate the Desktop). That is sample-data mode, used from V1 on.
- Story data for every take: team "Indicator sprint team", task "Add an RSI indicator", repo
  `lazyxgenius/trade_mcp`.

## Rules

1. **No product change.** You may add `video/**` and append video ignore rules to the root
   `.gitignore`. Nothing else: not `backend/`, `frontend/`, `desktop/`, `scripts/`, the `Makefile`,
   migrations, hooks or settings. Prove it at the end with `git diff --stat main...video/v0-toolchain`.
2. **Third-party tools stay in ignored folders.** Clone Product Demo Director
   (https://github.com/egorov-maxim/product-demo-director) into `video/vendor/product-demo-director`
   at a pinned commit; install npm packages (e.g. `testreel`) through `video/package.json`. Never run
   `./pdd install-skill`; never install plugins or skills into `~/.claude` or `~/.agents`; never change
   global git, npm or pip config.
3. **Media never in git.** Ignore `video/out/`, `video/takes/`, `video/vendor/` and
   `video/node_modules/` before the first take.
4. **No push, ever.** Your first action is the push guard in A. Never unset it (the operator turns it
   off when he needs to push). Never force anything; never `reset --hard`.
5. **`.env` is fenced.** Pass settings as inline env vars.
6. **Secrets:** never print, log, screenshot or copy a key, token or CLI credential file. Never open the
   `claude` or `grok` credential files. The key probe (G) prints provider names and OK/FAIL only.
7. **The subscriptions are the operator's.** At most **three real Desktop runs** in V0: (1) the gate
   run, (2) the camera take, (3) the stall probe, each on a tiny task. If a usage cap is hit, stop with
   NEEDS_HUMAN and the reset time if one is shown.
8. **Live-stack hygiene** (CLI-RULES §4.5): clear stale runs and PENDING DBOS workflows before the first
   run. Don't run `make test` in V0 (no product change). After each run, delete untracked stray files
   agents left outside their workspace (`REPORT.md`, `DEMO_PROOF.md`) only after
   `git ls-files --error-unmatch` proves them untracked.
9. **The Mac:** record under `caffeinate -dimsu` and keep the Tvashtr window frontmost while recording
   (an occluded window may drop frames). Find any process you pause or stop strictly through the
   Electron process you launched (its PID tree), never by name: this Claude Code session is itself a
   `claude` process.
10. **PRs:** list every PR opened on `trade_mcp` with its URL. Don't close them; the operator does.
11. **Commits:** conventional, your own paths by name (never `-A`); never commit `prompts/`,
    `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` or `design/`.
12. **Time box:** 4 hours of work (time waiting on a usage reset doesn't count). Three-attempt rule: a
    problem that survives three distinct fixes, each with its output in the chat, is recorded with the
    evidence; then move on, or stop as below.
13. **Safe state at any stop:** no servers, Vite, Electron, Playwright or background tasks running; the
    branch committed; the checkout back on `main`, clean apart from the operator's untracked files.
14. **Where this session runs:** the Claude desktop app's Code tab, in the main checkout (no worktree:
    the stack needs the untracked `.env` and the installed `node_modules`). Don't use the Code tab's
    preview server or auto-verify; you start the stack yourself on :8000 and :5173. If a preview server
    holds either port, stop it first.
15. **After a compaction:** when the project's compaction hook points you at CLI-RULES §3/§7, read this
    brief instead (and the end of STATE.md).

## What to build and prove (A–H)

**A. Preflight.** First, before anything else, turn on the push guard:
`git config --local remote.origin.pushurl DISABLED-no-push-during-video-work`, then prove it:
`git push --dry-run origin HEAD` must fail with "does not appear to be a git repository". Echo both.
If the dry run does not fail, stop with NEEDS_HUMAN and do not continue unguarded. (The guard covers
the Tvashtr repo only; product runs push to `trade_mcp` from their own clones, which it doesn't touch.)
Then echo: `main`'s sha and the branch; `claude --version`; `node --version` (≥ 20; say
whether ≥ 22), `python3 --version` (≥ 3.10), the first line of `ffmpeg -version`; Docker running;
`make db-up`.

**B. Product Demo Director.** Clone into `video/vendor/product-demo-director`, record the commit sha,
run `./pdd setup` (add `--with-capture` only if needed) and `./pdd doctor`. Missing ElevenLabs or
Gemini keys are expected (narration arrives at V3); everything else must pass. Echo the doctor summary.

**C. The subscription gate.** On the local stack, `node desktop/scripts/live-subscription-gate.mjs run`
must PASS and open a real PR (run 1). If the CLI rejects a default model slug, take the right slug
from that CLI's own model list and pass it via `TVASHTR_SUBS_PM_MODEL` / `TVASHTR_SUBS_ENG_MODEL`
(report it as a deviation). Echo its PASS lines and the PR URL.

**D. The camera.** Build `video/camera/` with Playwright, launching the Desktop app the way the gate
does (dev Electron binary, local backend, the seeded operator signed in through the Desktop's own
proxy). Content size: 1440×900 CSS px, at the Mac's Retina scale.
1. **Sharpness.** On a still screen (for example the team's canvas, nothing changing for 3 s), save a
   lossless `page.screenshot` and extract the matching frame from the recording. Compare them at
   1440×900 with ffmpeg's `ssim` filter, full frame and a crop around the node cards.
   **Gate: SSIM ≥ 0.97 on both.** Try Playwright's `recordVideo` first (set `size` explicitly; by
   default it scales the video down to fit 800×800). If that misses the gate, capture CDP screencast
   frames (PNG) and assemble them with ffmpeg at 30 fps from their timestamps. Keep the method that
   passes; echo both scores and the frame paths.
2. **The take (scene 3.2).** With the passing method, record about 60 s of a real Desktop run in
   progress (run 2, a tiny task on `trade_mcp`): the live run view's Now bar and Activity feed
   updating. Write `take.json` beside the clip: every click and typing step with its time and screen
   position (used for zooms later).
3. **Cursor.** Try Testreel's animated cursor on the Desktop window. If it can't attach to an Electron
   page, say so (V1 builds a cursor either way).

**E. The test reel.** 20 s, 1920×1080, 30 fps, made with Product Demo Director: the take's clip inside
a styled frame in the Tvashtr look (warm cream background, coral `#d97757` accent, Inter for the
caption), one connected zoom onto the Activity panel (placed from `take.json`) and one caption:
"Watch every agent, in plain words." No narration and no music in V0. Run PDD's QA and echo its
result; only audio checks may be waived, and say so. Output: `video/out/v0/test-reel.mp4`. If PDD's
pipeline refuses to render without narration, render through its Remotion engine with the same shots
and report it as a deviation. If neither works, stop with NEEDS_HUMAN and the error.

**F. Stall probe (report only, no product change).** Run 3, on the local copy started with
`TVASHTR_QUIET_AFTER_S=20 TVASHTR_STALLED_AFTER_S=60 TVASHTR_STALL_FAIL_AFTER_S=180` (and the sweep on
a short cron if the default is slow). Once the Engineer's Desktop job is working, pause its CLI process
(SIGSTOP, found through the Electron PID tree) and screenshot the run view at Quiet, Stalled and
Failed. Then stop the paused process (SIGTERM, then SIGKILL if needed), confirm nothing of that job is
still running, and confirm the run offers "Resume from here" (don't resume it). If the Desktop path
doesn't stall cleanly, try `TVASHTR_FORCE_HANG_ROLE` once and report both. Verdict: PASS, or FINDING
with the evidence.

**G. Key probe (report only).** For each provider the local operator holds a key for: one tiny
completion and, where the provider offers embeddings, one tiny embedding, through the app's own gateway
code. Print the provider, OK or FAIL, and the error class only. Purpose: choose the key for AI checks,
memory notes and Domains.

**H. `video/README.md`.** How to start the local stack for filming, record a take and render the reel;
tool versions and pinned shas; the capture method chosen and why; what didn't work.

## Evidence lines (echo each as it completes)

`NO_PUSH_GUARD: ON (dry-run push fails)` · `PREFLIGHT: …` · `PDD: <sha> doctor=<summary>` · `SUBS_GATE: PASS pr=<url>` ·
`CAMERA: method=<…> ssim_full=<x> ssim_crop=<y>` · `TAKE: <path> <seconds>s` ·
`REEL: video/out/v0/test-reel.mp4 <WxH> <fps> <seconds>s qa=<result>` · `STALL_PROBE: PASS|FINDING <one line>` ·
`KEY_PROBE: <provider: completion OK/FAIL, embeddings OK/FAIL/n.a.> …` ·
`DIFF: <git diff --stat main...video/v0-toolchain — only video/** and .gitignore>` · `PRS: <urls>` ·
then `READY_TO_MERGE video/v0-toolchain <sha>`, then the FINAL REPORT (CLI-RULES §4.7, eight sections).

## Stop with NEEDS_HUMAN (written to STATE.md and echoed in chat, with the FINAL REPORT) when

- the dry-run push does not fail after the guard is set;
- Claude or Grok isn't "Connected" on the Engines page (the operator must sign in);
- the GitHub App or seed is missing, or a subscription usage cap is hit;
- macOS asks for a permission only a human can grant;
- a product bug blocks the gate (report it; don't fix product code);
- Product Demo Director can't render at all.

A second, unknown problem that needs a broad or unproven change: stop. A contained, proven fix inside
`video/**`: go ahead.
