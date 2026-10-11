# video/ — the demo-film toolchain (V0 toolchain, V1 camera)

Everything the Tvashtr demo film is made with, and nothing of the product: the Desktop **camera**
(Playwright driving the real dev Desktop), the **reel** builder (Product Demo Director), and two
report-only **probes**. Briefs: `prompts/video-v0.md`, `prompts/video-v1.md`. Media and run data
never enter git: `video/out/`, `video/takes/`, `video/recordings/`, `video/vendor/` and
`video/node_modules/` are ignored. V1 (below) made every scene a take script that re-records by
name; `video/SCENES.md` has each scene's status and the operator's MAC scripts.

## V1 — the camera for every scene

### The filming stack (`video/stack/`)

A fresh database, `tvashtr_film`, on the Postgres in `.env`'s `DATABASE_URL` (never opened: the
Makefile and pydantic read `.env`; every command overrides `DATABASE_URL`). The filming account is
`lazyx@tvashtr.local`; the app shows it as **Lazyx** (avatar "L"): the name comes from the email
(`auth.display_name_for`), no database write fakes it.

```bash
video/stack/up        # docker Postgres → tvashtr_film if missing → migrate → seed (lazyx, the DeepSeek
                      # key only, the GitHub App installation) → backend :8000 → Vite :5173
QUIET=20 STALLED=60 FAIL=180 video/stack/up   # shortened stall timers (scene 4.1)
HOSTED=0 video/stack/up                       # self-hosted backend: the email sign-up (scene 7.2)
video/stack/down      # this checkout's servers only (--db: docker too)
video/stack/reset     # drop and rebuild ONLY tvashtr_film, then up
```

`up` refuses (STACK_WAITING, exit 2) when another checkout holds :8000 or :5173. Logs and pids:
`video/out/stack/`.

### The take runner

```bash
make -C video take SCENE=2.4          # = node video/camera/take.mjs 2.4
make -C video take SCENE=3.1 DRY=1    # rehearse: stop before anything that spends a subscription
make -C video take SCENE="3.2*"       # every take of a scene (its parts too)
make -C video list                    # the registry: 31 scenes + parts, with their modes
```

Each scene is `video/camera/scenes/<id>.mjs` (a default export: `id, title, mode, budget, setup,
before, film, after, parts`). A take: an **off-camera setup** builds the scene's starting state
through the app's own API (`camera/film.mjs`: the film team stage by stage, the Toolkit, the domain;
a team that has runs is renamed "… (earlier)", never deleted — deleting a team deletes its runs),
then the **pre-roll** (F9): a fresh throwaway profile with first-run setup finished, the
notifications ask pre-answered "Not now" (account preference; 3.2 leaves it to ask), Claude and
Grok "Connected" on the Desktop *and* the server counting its runner fresh, the window checked at
1440×900 @2×, frontmost, `caffeinate -dimsu`, the cursor parked; then **film**. Output:
`video/takes/v1/<take>/take.mp4` (2880×1800, 30 fps), `take.json` (scene, mode, recording or
fixtures, steps with time/kind/label/position/box, regions of interest, pairs, spends), `poster.png`,
`shots/`. One Desktop at a time: takes queue on `video/out/v1/desktop.lock`.

Modes: **live** (the real app on tvashtr_film) · **record** (live, and every renderer `/api`
response is saved) · **replay** (a recording answers the renderer) · **sample** (fixtures answer
it) · **web** (Playwright's Chromium, not the Desktop) · **mac** / **motion** (not filmed: SCENES.md).

Spends: `ctx.spend(kind, label, fn)` — `--dry` stops there; a real spend needs
`VIDEO_ALLOW_SPEND=1` and fits the ledger `video/out/v1/budget.json` (V1 caps: 2 runs, 1 test,
1 ask, no compares, task sets or save-with-tests). `ctx.advance` marks a step inside a paid run
(a gate approval): `--dry` stops there too. Dev aids, never takes: `--preview` (a sample/web take
headless with a stub Desktop bridge) and `--browser` (a live script headless against the real
stack).

### The cursor (F7)

`camera/cursor.mjs`: an SVG arrow drawn in the page by the camera (an init script, never product
code) that follows the **real** mouse, which glides along eased (cubic in-out) paths
(`page.mouse.move` every ~16 ms), so hover states are real; a coral ripple on each mousedown; parked
off the controls after each click (a nearby point with no control under it); typing per character
at a human pace with jitter. Hidden form controls (switches) are aimed at through their label; SVG
edges through `cam.clickAt` (a point a third along the path).

### Record and replay (F5)

`camera/intercept.mjs`. **Record**: passive — `page.on("response")` saves every renderer `/api`
response with its time since the anchor (the reload after sign-in) to
`video/recordings/<name>/recording.json.gz`; a failed take still saves it. **Replay**: the real
Desktop with every renderer `/api` call answered by `page.route` from the recording — the recorded
response for the same method + path + query nearest in time (at most 1 s ahead, so a poll landing
just before the live one isn't a poll stale); the page's clock is shifted to the recording's time
(so "2m ago" reads as it did); `spec.from` starts a replay part-way in; a request the recording
can't answer fails the take (599, listed). Set-Cookie is never replayed, so the Desktop runner
(main-process Node fetch, not interceptable) has no session and claims nothing — every claim is a
401 in the replay's Electron log. Matched pairs: the record take saves the Now bar / Activity /
summary texts (`ctx.pair`) at moments where they hold still; the replay re-reads them within one
poll of the same elapsed time and reports exact matches and matches apart from relative ages.
`node video/camera/sheet.mjs pairs 3.2-replay` draws them side by side.

V2's design: 3.1 records the hero run once; 3.2, 3.3, 3.4 and 3.6 are replay takes of that
recording (each from its moment: `MARK.launch/gate/approved/shipped` in `camera/flows.mjs`), so a
re-take never needs a second real run. V1 rehearses them on the proof recording.

### Sample mode (F6)

The same interception in the real Electron window, fed by `video/fixtures/<name>.mjs`
(design-parity's route format). Every fixture starts from `video/fixtures/live-base.json`, what the
real app answered for the film team on tvashtr_film (`video/fixtures/capture-live.mjs` then
`export-live.mjs`), plus `video/story.json`; only the history a screen needs is sample data.

### Review files

```bash
node video/camera/sheet.mjs contact-sheet      # video/out/v1/contact-sheet.png
node video/camera/sheet.mjs ch2-preview        # video/out/v1/ch2-preview.mp4 (1920×1080, no narration)
node video/camera/sheet.mjs scenes-table       # the status table in video/SCENES.md
```

| Path | What |
|---|---|
| `package.json` | pinned tools: `ffmpeg-static` 5.3.0 (ffmpeg 6.0), `@ffprobe-installer/ffprobe` 2.1.2 (ffprobe n4.4.1), `@playwright/test` 1.61.1, `testreel` 0.2.0 |
| `env.sh` | puts that ffmpeg/ffprobe first on PATH (`. video/env.sh` from the repo root) |
| `camera/desktop.mjs` | launches the dev Electron Desktop like `desktop/scripts/live-subscription-gate.mjs`, signs in, gets past setup, drives the current UI |
| `camera/capture.mjs` | CDP PNG screencast → 30 fps video, frame extraction, SSIM |
| `camera/sharpness.mjs` | the sharpness gate (SSIM ≥ 0.97, full frame + node-card crop) |
| `camera/subs-gate.mjs` | the subscription gate on the current UI; `--take` films it as the take |
| `camera/stall-probe.mjs` | pauses a Desktop job's CLI and watches the stall guard |
| `camera/testreel-cursor.mjs` | Testreel's animated cursor on the Desktop window |
| `probes/key_probe.py` | one tiny completion/embedding per held provider through the app's gateway |
| `reel/build-reel.mjs` | the 20 s test reel through Product Demo Director |

## Tools and pins

- Product Demo Director (PDD): `https://github.com/egorov-maxim/product-demo-director` at
  **`7725d6af14f752d48043f8496a177c2e06982e7d`** (2026-09-24), Remotion 4.0.496 inside it.
- Electron 35.7.5 (`desktop/node_modules`), node 24.14.1, python 3.14.4 (PDD's venv), Claude Code
  2.1.284, Grok CLI 1.0.44, Docker 29.6.1.

## Set up once

```bash
cd video && npm ci && cd ..
git clone https://github.com/egorov-maxim/product-demo-director video/vendor/product-demo-director
git -C video/vendor/product-demo-director checkout 7725d6af14f752d48043f8496a177c2e06982e7d
(cd video/vendor/product-demo-director && ./pdd setup)
. video/env.sh && (cd video/vendor/product-demo-director && ./pdd doctor)   # "Ready to direct."
```

Never run `./pdd install-skill` (it links into `~/.claude` and `~/.agents`). PDD's `.env` is not
needed until narration (V3): doctor's two NOTE lines are the missing ElevenLabs/Gemini keys.

## Start the local stack for filming

```bash
make db-up
# Seed without the out-of-credit openai/gemini keys (the Makefile's `include .env` beats env vars,
# so blank them as make variables; demo_proof_seed.py loads .env with setdefault, so export blanks).
make seed OPENROUTER_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= HF_TOKEN= HUGGINGFACE_API_KEY=
(cd backend && OPENAI_API_KEY= GEMINI_API_KEY= OPENROUTER_API_KEY= HF_TOKEN= HUGGINGFACE_API_KEY= \
  uv run python ../scripts/demo_proof_seed.py)
# A run clones its repo under backend/.tvashtr_clones and backend/.tvashtr_workspaces, which the
# dev server's --reload watches: exclude them (absolute paths — relative ones never match).
UVICORN_RELOAD_EXCLUDES="$PWD/backend/.tvashtr_clones $PWD/backend/.tvashtr_workspaces" make backend
(cd frontend && TVASHTR_API_PROXY_TARGET=http://localhost:8000 TVASHTR_DESKTOP_ORIGIN=http://127.0.0.1:5173 \
  npx vite --host 127.0.0.1 --port 5173 --strictPort)
```

Before a real run: `claude auth status` **from a plain Terminal** must say `loggedIn: true` (inside a
Claude desktop-app session the CLI borrows the app's sign-in and reads as logged in even when its
own has expired — the Desktop runner strips those variables); `claude auth login` otherwise. Clear
stale runs and PENDING `run_team` workflows (CLI-RULES §4.5) and, after each run, delete a stray
`REPORT.md`/`DEMO_PROOF.md` only once `git ls-files --error-unmatch` proves it untracked.

## The camera

The Desktop runs in a throwaway Electron profile (`TVASHTR_VIDEO_PROFILE`, default
`$TMPDIR/tvashtr-video-profile`), so filming never touches the operator's own Desktop profile (its
zoom level, sign-in, setup state). A fresh profile opens at exactly **1440×900 CSS px at 2×**. Its
first-run setup is skipped (Skip for now → "Decide when I launch a run"; no consent is ticked). The
variables only a Claude desktop-app shell carries (`ANTHROPIC_BASE_URL`, `CLAUDE_EFFORT`, …) never
reach Electron. During a take the window is kept on top (an occluded window may drop frames); run
everything under `caffeinate -dimsu`.

```bash
caffeinate -dimsu node video/camera/sharpness.mjs screencast   # or: recordvideo
caffeinate -dimsu node video/camera/subs-gate.mjs --take --dry  # rehearse up to Launch (no run)
caffeinate -dimsu node video/camera/subs-gate.mjs --take        # gate + take (spends the subscriptions)
```

**Capture method: CDP screencast.** Both methods pass the sharpness gate on a still canvas
(lossless `page.screenshot` vs the matching recorded frame, at 1440×900 with ffmpeg `ssim`):

| method | recording | SSIM full | SSIM node cards |
|---|---|---|---|
| Playwright `recordVideo` (size set to 1440×900) | 1440×900 VP8 (~1 Mbps), 25 fps | 0.9940 | 0.9922 |
| CDP `Page.startScreencast` PNG frames → 30 fps from their timestamps | **2880×1800** H.264 crf 12 | **0.9994** | **0.9993** |

The screencast keeps the Retina pixels, which the film's zooms need (a 1.8× zoom of a 1440×900
source in a 1920×1080 frame is upscaled 2.4×), and is the more faithful of the two. Frames arrive
only when the screen changes; the assembly holds each frame until the next one.

`take.json` (beside `take.mp4` in `video/takes/v0/<take>/`) lists every click and typing step with
its time in the clip and its screen position (CSS px of the 1440×900 view; ×2 for the video), and
the run view's regions (`now`, `activity`) — the reel places its zoom from them.

## The reel

```bash
node video/reel/build-reel.mjs              # video/takes/v0/scene-3-2 → video/out/v0/test-reel.mp4
REEL_START=32 node video/reel/build-reel.mjs   # pick the 20 s window (V0: where the Activity feed changes)
node video/reel/build-reel.mjs --rehearse   # a stand-in clip → video/out/v0/test-reel-rehearsal.mp4
```

The take is framed with ffmpeg on a 3840×2160 canvas (warm cream `#efece1` backdrop, the app window
at native 2880×1800 with rounded corners, a soft shadow and a coral `#d97757` ring), then PDD renders
it: one clip shot, one zoom region onto the Activity panel, one caption in Inter ("Watch every agent,
in plain words."). No narration, no music: the clip carries a silent track and `production.qa`
declares 0–20 s as intended silence — **the audio waiver**. `./pdd render` cannot finish a silent
master (its two-pass loudness normalisation cannot measure silence), so the builder runs PDD's
own stages by hand: `preflight --strict` → `build --contracts strict` → `finish --no-loudnorm` →
`qa --require-artifact --strict`.

## Probes

```bash
caffeinate -dimsu node video/camera/stall-probe.mjs        # backend started with the stall knobs:
#   make backend TVASHTR_QUIET_AFTER_S=20 TVASHTR_STALLED_AFTER_S=60 TVASHTR_STALL_FAIL_AFTER_S=180
(cd backend && uv run python ../video/probes/key_probe.py)  # provider, OK/FAIL, error class only
node video/camera/testreel-cursor.mjs
```

## V0 results

- Gate + take (run 3, `c0680459`): every check PASS, PR https://github.com/lazyxgenius/trade_mcp/pull/50;
  take `video/takes/v0/scene-3-2/take.mp4` 69.5 s, 2880×1800, 6 steps in `take.json`.
- Reel: `video/out/v0/test-reel.mp4` 1920×1080, 30 fps, 20.00 s (`REEL_START=32`), PDD QA pass
  (audio waived: 0–20 s declared silent).
- Next take: a fresh profile shows a one-time "Get a notification when a run needs you?" prompt
  over the run view after the first launch — dismiss it (Not now) before filming. The PM's Grok
  phase emits few Activity rows; film the Engineer's phase for a busier feed.

## What didn't work (V0)

- `desktop/scripts/live-subscription-gate.mjs` no longer ran on `main`: it predated the Desktop setup
  wizard and the Engines/launch revamp. `camera/subs-gate.mjs` keeps every check on the current UI;
  the product script is fixed separately on branch `fix/desktop-subs-gate-current-ui`.
- The Claude CLI's own sign-in had expired; inside a Claude desktop-app shell `claude auth status`
  still said logged in (it reads that app's sign-in). Check from a plain Terminal.
- `./pdd render` refuses a silent master (see The reel).
- Testreel attaches to an Electron page only after `page.setViewportSize` (Electron pages have no
  Playwright viewport), which emulates the page at 1×, and it needs `recordVideo`: its cursor works,
  but not with the 2× screencast camera — V1 builds its own cursor from `take.json`.
- `make backend`'s `--reload` restarts the server when a run clones its repo under `backend/`
  (`UVICORN_RELOAD_EXCLUDES` above fixes it — plural, from click's parameter name — and uvicorn only matches excluded directories by absolute
  path).
- The stall sweep never runs on this dev database: DBOS stamps each scheduled sweep with the
  *latest* application version registered in `dbos.application_versions` (`b19cf7b4…`, from a
  branch backend that used the DB on 2026-10-02), while main's backend (`3011d7ac…`) only dequeues
  its own version — so sweeps pile up `ENQUEUED` and a Stalled step is never ended Failed. The
  stall probe sees Quiet (20 s) and Stalled (61 s) on time for a paused Desktop CLI, but no Failed
  and no "Resume from here".
- trade_mcp already has `rsi()` (`core/indicators.py`), so the story's "Add an RSI indicator" is a
  one-line README note in V0.
