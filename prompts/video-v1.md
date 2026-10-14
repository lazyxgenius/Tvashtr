# Brief — Video V1: the camera for every scene

Architect: Tvashtr Sidechat-21, 2026-10-03. Path: `/Users/adimac/Desktop/Tvashtr/prompts/video-v1.md`.
`prompts/` is untracked: never commit it. Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins (CLI-RULES' numbers and milestone list are out of date). V0's brief
(`prompts/video-v0.md`) is background only; this brief replaces its rules.

## What the film is (context)

One ~7-minute main film of Tvashtr in 8 chapters (31 scenes), plus a 90-second highlight and
vertical shorts cut from the same footage. It is shot in the **Tvashtr Desktop app** against a
**local copy of Tvashtr**, with agents running on the operator's **Claude and Grok subscriptions**
through the Desktop runner. Product Demo Director (PDD) edits it later (V4). V0 proved the toolchain
(`video/README.md`). Seven video steps: V0 toolchain ✅ → **V1 camera (this)** → V2 the real runs →
V3 script and voice → V4 rough cut → V5 polish → V6 cuts.

**V1's job: every scene becomes a take script that re-records by name.** Scenes without agent work
are filmed for real now. Scenes with agent work are scripted and rehearsed up to their run, and the
**record-and-replay** path is proven on one real run, so V2 only has to run the real runs.

Honesty rules (they apply to every frame): agent work shown is a real run of the real product
(sped up and labelled later); sample data only for screens that need weeks of history; a replay is
a recording of a real run, labelled as such in `take.json`; shortened timers are captioned (V4); no
secret on screen (no unmasked key, token or personal email).

## Where things are (checked by the architect on disk, 2026-10-03; updated by Sidechat-22, 2026-10-10)

- `main` is **`268ed099`** = `e30b8bd9` + V0 (`video/**`) + the gate-script fix + M-desk-routes +
  M-desk-2 + the DBOS cron fix + M-desk-3 (`02488987`) + **M-desk-4** (fast-forwarded 2026-10-10).
  Alembic head `0053`; the freeze hook covers `0001`–`0053`.
- **On the Desktop, every agent path runs on the subscriptions now:** main runs, Resume,
  Start-from, Compare, task sets, agent tests, "Test this agent", Ask, and saving with tests or a
  set check (M-desk-routes + M-desk-2). The Tests, Save and Compare estimates name the subscription.
  M-desk-3 also made the save dialog's set check and the task-set results name the Desktop.
  **M-desk-4** (merged) changes how the Desktop shows money and
  time: work on a subscription names the subscription instead of "$0.00", Resume talks about work
  saved, budgets say they count API-key spend, estimates count the turns lanes take, a queued
  task-set lane says it is waiting. So: **find elements by role and label, never by money or time
  strings**. `scripts/design-parity/scenarios/desk4.mjs` answers the Desktop's reads
  (`?desktop_target=1`) the way the server does since M-desk-4 — build the money/time parts of
  `video/fixtures/` from it, since the Desktop's sample mode must answer those reads too.
- **DBOS cron fix merged:** scheduled sweeps run on the version that queued them, so the stall
  sweep works on any database. Still: never run `make test` against the filming database.
- **V0's camera** (`video/camera/*.mjs`): `desktop.mjs` launches the dev Electron Desktop in a
  throwaway profile at 1440×900 CSS px @2× and drives the current UI (sign-in, setup skip, Engines,
  teams, composer launch, gates, run events); `capture.mjs` is the CDP PNG screencast → 30 fps
  2880×1800 (SSIM 0.9994); `subs-gate.mjs --take` films a run and writes `take.json`;
  `stall-probe.mjs` pauses a Desktop job's CLI (SIGSTOP via the Electron PID tree). Reuse them.
- **The main checkout already holds V0's ignored installs:** `video/node_modules/` and
  `video/vendor/product-demo-director` (pinned `7725d6af`, set up). Don't reinstall unless broken.
- **Sample data:** `scripts/design-parity/scenarios/*.mjs` answer every `/api` call from fixtures
  (the design's sample story: "Indicator sprint team", "Add an RSI indicator"); `shoot-app.mjs`
  shows how they are served. 38 Playwright e2e specs in `frontend/e2e/` drive almost every feature —
  reuse their selectors.
- **The Desktop's GitHub sign-in opens the system browser** (`desktop/electron/auth/desktopSignIn.cjs`,
  `openExternal`), which Playwright can't film: the GitHub side of scene 1.1 is a MAC shot.
- **trade_mcp** (`lazyxgenius/trade_mcp` @ `b9bf427`) already has, in `core/indicators.py`: sma, ema,
  rsi, macd, bollinger, keltner, donchian, adx, supertrend, parabolic_sar, ichimoku, aroon, atr,
  stochastic, wma, roc, cci, williams_r, vwma, stoch_rsi, kama, obv, ad, cmf, mfi, vwap (registry
  `INDICATORS`, tests in `tests/test_indicators.py`). It has no Hull MA, TRIX, DEMA, TEMA, Vortex,
  Chande momentum or zero-lag EMA. There is no `migrations/` folder.
- Seeding: `make seed` (reads `TVASHTR_SEED_EMAIL` / `TVASHTR_SEED_PASSWORD`) and
  `scripts/demo_proof_seed.py`; V0's README gives the exact commands (blank the out-of-credit keys).
  The seeded dev account is `operator@tvashtr.local` (avatar "O"); the design boards show "Lazyx".

## Decisions (final)

**F1 — A fresh filming database.** `tvashtr_film`, a new database on the Postgres server in `.env`'s
`DATABASE_URL`, migrated to head and seeded. Every filming command loads `.env` per command with
`DATABASE_URL` overridden to `tvashtr_film` (never copy, print or edit `.env`). `video/stack/`
holds the scripts: `up` (DB if missing, migrate, seed, backend with `UVICORN_RELOAD_EXCLUDES`, Vite
on :5173, optional stall knobs), `down`, and `reset` (drops and rebuilds **only** `tvashtr_film`).
The filming account is seeded as `lazyx@tvashtr.local` (`TVASHTR_SEED_EMAIL`) so the app shows
"L"/"lazyx" instead of "operator". Find where the app takes the name from; no database writes to
fake one. *What the viewer gets:* a clean account — every team, run and number on screen was made
while filming.

**F2 — The story.** One source, `video/story.json`, used by every take and every fixture:

| Use | Value |
|---|---|
| Team | "Indicator sprint team" on `lazyxgenius/trade_mcp`, branch `main`, folder `core/` |
| Agents | Product manager (Claude), Engineer (Claude), Reviewer (starts on Claude → switched to Grok in 2.5), Fixer on the failure path (DeepSeek, the one API key) |
| Guardrail (2.4, 3.6) | secret scan + no edits to `servers/` |
| Hero run (0.1, 3.x) | "Add a Hull moving average indicator" |
| Stall + resume (4.x) | "Add a TRIX indicator" |
| Next run from this (5.1) | "Add a DEMA indicator", starting from the hero run's PR branch |
| Task set (6.3) | "Indicators": "Add a Vortex indicator", "Add a Chande momentum oscillator" |

Copy the design-parity scenarios you need into `video/fixtures/` and rewrite them to this story
(names, tasks, files, PR titles). **Sample data must agree with the live footage:** same team,
agents, models and tasks; runs on subscriptions show what the app shows for them (since M-desk-4:
the subscription's name and work time, never "$0.00"), never key-priced dollar figures from
the design. When unsure what the app would show, look
at a real screen first. List every remaining mismatch in `video/SCENES.md`.

**F3 — Real-run budget for V1:** at most **2 real Desktop runs** (each a tiny task, e.g. a one-line
README note; the first proves record-and-replay, the second only if the first fails), **1** "Test
this agent" and **1** Ask. No compares, no task sets, no save-with-tests. If a usage cap is hit, stop
with NEEDS_HUMAN and the reset time if one is shown. (V2 sets its own per-sitting budget.)

**F4 — Where this runs:** the main checkout, branch `video/v1-camera` from the current `main` (it must contain `268ed099`, M-desk-4).
This session owns :8000, :5173 and the one Tvashtr Desktop while it runs.

**F5 — Record and replay.** A *recording* is the renderer's view of a real run: every `/api`
response the Desktop renderer received during a live take, with its time, saved under
`video/recordings/<name>/` (ignored). A *replay* runs the real Desktop app with the renderer's `/api`
calls answered from a recording by elapsed time (Playwright route interception on the Electron
window); a request the recording can't answer fails the take loudly (never a silent fall-through to
the backend); the Desktop runner stays idle. `take.json` names the mode and the recording. Prove it
on one real run: record it live, replay it, film the replay, and show matched pairs of live and
replay screenshots at the same moments (Now bar and Activity text identical). *What the viewer
gets:* a re-take never needs a second real run; the run on screen is the run that happened.

**F6 — Sample-data mode in the real Desktop:** the same interception, fed from `video/fixtures/`,
in the real Electron window (not a browser emulating the Desktop). `take.json` says `mode: sample`.

**F7 — The cursor:** drawn in the page by the camera (an injected overlay, never product code):
eased glides between targets with the real mouse moving along the same path (so hover states are
real), a click ripple, crisp at 2×, parked off the controls after each click; typing at a human
pace. Every step goes into `take.json` (time, kind, label, position) for V4's zooms.

**F8 — Scenes are independent.** Each scene has an off-camera `setup` that builds its starting
state through the app's own API (or a recording/fixtures) from a clean `tvashtr_film`, then films.
`make -C video take SCENE=2.4` (a Makefile inside `video/`; the root Makefile is product) or
`node video/camera/take.mjs 2.4` re-records one scene in any order; `--dry` stops before anything
that spends a subscription.

**F9 — Pre-roll for every take:** a fresh throwaway profile; first-run setup finished as the take
needs it; the "Get a notification when a run needs you?" prompt answered "Not now" (except in 3.2,
where the ask is part of the scene); the window at 1440×900 @2×, frontmost; `caffeinate -dimsu`;
the cursor parked.

**F10 — What is filmed in V1:**

| Mode | Scenes |
|---|---|
| LIVE now (real takes) | 1.2 (app side), 1.3, 2.1–2.7 (2.7 uses the one "Test this agent"), 7.1, 7.2 (a second account made through the app's own sign-up) |
| SAMPLE now | 1.4 and 1.5 (unless the operator supplies Linear / an embeddings key — not in V1), 3.5, the history part of 6.2, 8.1 |
| WEB now | the website half of 8.1 (the same local frontend in Playwright's Chromium, not Desktop mode) |
| Run scenes — scripted, rehearsed `--dry` to the launch; filmed in V2 | 0.1 (the PR page in Chromium), 3.1–3.4, 3.6, 3.7 (uses the one Ask if you rehearse it), 4.1–4.2, 5.1, 6.1, the save part of 6.2, 6.3 |
| Proof run (F5) | a short cut of 3.2 on a tiny task, recorded live and replayed |
| MAC (operator, Recordly) | 1.1 GitHub side, 1.2 Terminal sign-in, 4.1 the macOS notification — write a numbered click-by-click script for each in `video/SCENES.md` |
| MOTION (V5) | 0.2, 8.2 — not filmed |

Chapter time budgets from the plan (for take length; record more, V4 trims): 0 · 20 s, 1 · 55 s,
2 · 70 s, 3 · 90 s, 4 · 45 s, 5 · 30 s, 6 · 75 s, 7 · 30 s, 8 · 25 s.

## The storyboard (the plan's scenes; "said" lines are V3's, not yours)

0.1 PR on GitHub, opened by Tvashtr, Reviewer's approval · 0.2 title (MOTION) ·
1.1 Sign in with GitHub; install the GitHub App on trade_mcp · 1.2 Engines: Claude and Grok
connected with your own sign-in (opens Terminal); one API key, masked; a backup model · 1.3 Toolkit:
a web-fetch tool, a secret by name, a skill imported from GitHub · 1.4 Connectors: Linear · 1.5
Domains: "Exchange API docs", upload PDFs, ask, answer with sources ·
2.1 New team from a template; canvas opens · 2.2 Product manager's instructions; Edits allowed off ·
2.3 a Query domain box feeding the Product manager · 2.4 Spec approval gate; Engineer with tools and
skills; Reviewer; loop-back "up to 3 rounds"; guardrail gate (secret scan, no edits to `servers/`);
Ship and Stop · 2.5 a model per agent; the Reviewer on Claude → the same-model hint → switch to Grok ·
2.6 Remember what I learn; a $5 budget; "If it fails or times out" → a Fixer · 2.7 Test this agent
on the Reviewer; Tidy; group the loop; the header shows v1 ·
3.1 Home composer: task, repo, branch, folder `core/` · 3.2 live run view: Now bar, Activity; the
notifications ask · 3.3 gate → Needs you; open the spec, fix one line, approve · 3.4 Engineer in its
own copy of the repo on the Claude sign-in; Reviewer (Grok) rejects round 1; round 2 approved · 3.5
retrying, then the backup-model switch (SAMPLE) · 3.6 guardrail passes; Ship; the PR; the Done row ·
3.7 Changes tab; ask the Reviewer "why did you reject round 1?"; cost per round; Memory: confirm one
fact, reject one ·
4.1 the Engineer goes Quiet → Stalled → Failed (shortened timers, the CLI paused on purpose); a Mac
notification · 4.2 Needs you → Resume from here; the confirm (kept / runs again / saved); Carried
over; it ships ·
5.1 Start the next run from this: carry spec, decisions, memories, summaries; start from the PR
branch; Recent tasks while typing ·
6.1 Make this a test from a Reviewer round; Add tests from a CSV; an AI check; Check the AI check ·
6.2 edit the Reviewer; "2 changes since v7"; Save as v8; save and run the tests; results in History;
What changed · 6.3 Compare v7 and v8; results; a task set with hidden checks; Restore ·
7.1 Save as my agent "Strict Reviewer"; use it in another team; Undo; "Based on Strict Reviewer v1" ·
7.2 Team file: Download ("No secrets inside"); Import on a second account; the things-to-fix card ·
8.1 Home: Running now, Recent runs, spend and budget, ⌘K; a run on a local folder; the same Home on
the website · 8.2 end card (MOTION).

## Rules

1. **No product change.** Only `video/**` and video ignore rules in the root `.gitignore`. Not
   `backend/`, `frontend/`, `desktop/`, `scripts/`, the root `Makefile`, migrations, hooks or
   settings. Prove it with `git diff --stat main...video/v1-camera`. If a scene can't be filmed
   without a product change, record it in `SCENES.md` (what, where, why) and move on.
2. **Media and run data never in git:** `video/takes/`, `video/out/`, `video/recordings/`,
   `video/vendor/`, `video/node_modules/` stay ignored. Before each commit, scan what you stage for
   key/token patterns.
3. **No push.** `git config --get remote.origin.pushurl` must print
   `DISABLED-no-push-during-video-work`, and `git push --dry-run origin HEAD` must fail. If the guard
   is off, stop with NEEDS_HUMAN (don't set it yourself). Never force; never `reset --hard`.
4. **`.env` is fenced:** load it per command, override `DATABASE_URL`; never open, copy or print it.
5. **Secrets:** never print, log, screenshot or record a key, token, password or CLI credential
   file; never open the `claude` or `grok` credential files. A secret typed on camera (1.3) is a
   placeholder value you delete afterwards; an API key on camera (1.2) is shown masked only, and
   no real key is typed on camera in V1 (the "add a key" moment waits for a throwaway key from the
   operator — list it as an operator item).
6. **Subscriptions:** the F3 budget. Before the first real run, check the Engines page says Claude
   and Grok "Connected"; the first run's log must show Claude `apiKeySource: none`. If a CLI sign-in
   has expired, stop with NEEDS_HUMAN (the operator runs `claude auth login`).
7. **Live-stack hygiene** (CLI-RULES §4.5): clear stale runs and PENDING `run_team` workflows on
   `tvashtr_film` before a real run; after a run, delete stray untracked `REPORT.md`/`DEMO_PROOF.md`
   only once `git ls-files --error-unmatch` proves them untracked.
8. **The Mac:** record under `caffeinate -dimsu`, Tvashtr frontmost. Find any process you pause or
   stop only through the Electron PID tree you launched, never by name (this session is a `claude`
   process). Never touch `~/Library/Application Support/tvashtr-desktop/` outside a throwaway profile.
9. **Collisions:** before starting the stack or the Desktop, check who listens on :8000 and :5173
   (and each listener's cwd) and that no other Tvashtr Electron runs. If another session holds them,
   echo `STACK_WAITING`, re-check every 5 minutes, never drive or stop it; after 3 hours, NEEDS_HUMAN.
   A Code-tab preview server on those ports: stop it first.
10. **PRs:** list every PR opened on `trade_mcp` with its URL; don't close them.
11. **Commits:** conventional, your own paths by name (never `-A`); a checkpoint commit per chapter;
    never commit `prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md` or `design/`.
12. **Time box:** 8 hours of work (waiting on a cap or a held stack doesn't count). Three-attempt
    rule: a problem that survives three distinct fixes, each with its output in the chat, is
    recorded in `SCENES.md` with the evidence; move on to the next scene.
13. **Safe state at any stop:** nothing running (servers, Vite, Electron, Playwright, background
    tasks), the branch committed, the checkout back on `main`, clean apart from the operator's
    untracked files.
14. **After a compaction:** read this brief again and the end of `STATE.md`.

## What to build and prove (A–J)

**A. Preflight.** Echo: the push guard (rule 3); `main`'s sha (it must contain `268ed099`, M-desk-4) and your branch; `node`,
`python3`, ffmpeg (`. video/env.sh`); Docker running; `./pdd doctor` still "Ready to direct.".

**B. The filming stack (F1).** `video/stack/` up/down/reset; `tvashtr_film` at head `0053`, seeded;
the account shows as lazyx (screenshot of the header avatar/menu).

**C. The story (F2).** `video/story.json`; `video/fixtures/` rewritten to it.

**D. The camera core.** The scene registry (`video/camera/scenes/<id>.mjs`, one per scene, MOTION
ones as stubs that say so), the runner (`take.mjs` + `video/Makefile`), the pre-roll (F9), the
cursor (F7). Output per take: `video/takes/v1/<scene>/take.mp4` + `take.json` (scene, mode,
recording or fixtures, steps with time/kind/label/position, regions of interest).

**E. Sample-data mode (F6)** in the real Electron window, proven on one SAMPLE scene with a
screenshot.

**F. Record and replay (F5)**, proven on the one proof run: the run id, the recording path, the
replay take, and the matched live/replay screenshot pairs (N of N identical texts).

**G. The takes (F10).** Every LIVE-now, SAMPLE-now and WEB scene recorded; every run scene rehearsed
with `--dry` to its launch point. A contact sheet (`video/out/v1/contact-sheet.png`: one frame per
take, labelled) and a chapter 2 preview (`video/out/v1/ch2-preview.mp4`: its takes joined with
ffmpeg at 1920×1080, no narration).

**H. `video/SCENES.md`.** One row per scene: mode, script, status (clip / dry / blocked + why), raw
length vs the chapter budget, story mismatches, and the operator items — each MAC shot as a
numbered click-by-click script (which app, which visible label to click, what should show).

**I. Before V2 (report only).** What V2 needs, measured from V1: the real runs per scene and their
expected work time on the subscriptions; a suggested split into sittings; anything V2 must fix
first.

**J. `video/README.md`** updated: the filming stack, the take runner, record/replay, sample mode,
the cursor, what didn't work.

## Evidence lines (echo each as it completes)

`NO_PUSH_GUARD: ON` · `PREFLIGHT: …` · `FILM_STACK: tvashtr_film head=0053 account=<as shown>` ·
`STORY: video/story.json <n> fixtures` · `CURSOR: <how> <sample frame path>` ·
`SAMPLE_MODE: <scene> <screenshot>` · `RECORD_REPLAY: run=<id> recording=<path> replay=<take> pairs=<n>/<n>` ·
`TAKES: <clips>/<filmable> clips, <dry>/<run scenes> rehearsed, blocked=<list>` ·
`CONTACT_SHEET: <path>` · `CH2_PREVIEW: <path> <seconds>s` · `RUNS_USED: runs=<n>/2 test=<n>/1 ask=<n>/1` ·
`DIFF: <git diff --stat main...video/v1-camera — only video/** and .gitignore>` · `PRS: <urls>` ·
then `READY_TO_MERGE video/v1-camera <sha>`, then the FINAL REPORT (CLI-RULES §4.7, eight sections).

## Stop with NEEDS_HUMAN (written to STATE.md and echoed in chat, with the FINAL REPORT) when

- the push guard is off;
- Claude or Grok isn't "Connected", a CLI sign-in has expired, or a usage cap is hit;
- macOS asks for a permission only a human can grant;
- another session has held the stack or the Desktop for 3 hours;
- record-and-replay can't be made to work inside `video/**` after three distinct attempts (this
  changes V2's plan: report what you learned);
- a second, unknown problem needs a broad or unproven change.

A contained, proven fix inside `video/**` may proceed.
