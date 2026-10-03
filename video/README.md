# video/ — the demo-film toolchain (V0)

Everything the Tvashtr demo film is made with, and nothing of the product: the Desktop **camera**
(Playwright driving the real dev Desktop), the **reel** builder (Product Demo Director), and two
report-only **probes**. Brief: `prompts/video-v0.md`. Media never enters git: `video/out/`,
`video/takes/`, `video/vendor/` and `video/node_modules/` are ignored.

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

## What didn't work (V0)

- `desktop/scripts/live-subscription-gate.mjs` no longer runs: it predates the Desktop setup wizard
  and the Engines/launch revamp (its launch disclosure, Engines shelf and launch-panel locators are
  gone). `camera/subs-gate.mjs` keeps every check on the current UI.
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
