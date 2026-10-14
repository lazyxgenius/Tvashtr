# video/ — the demo-film toolchain (V0 toolchain, V1 camera, V2 real runs, V2b re-film)

Everything the Tvashtr demo film is made with, and nothing of the product: the Desktop **camera**
(Playwright driving the real dev Desktop), the **reel** builder (Product Demo Director), and two
report-only **probes**. Briefs: `prompts/video-v0.md`, `prompts/video-v1.md`, `prompts/m-desk-5-v2.md`
(Part B), `prompts/m-desk-7-v2b.md` (Part B). Media and run data
never enter git: `video/out/`, `video/takes/`, `video/recordings/`, `video/vendor/` and
`video/node_modules/` are ignored. V1 (below) made every scene a take script that re-records by
name; V2 (below) filmed the run scenes on real runs; `video/SCENES.md` has each scene's status, the
V2 numbers and bends, and the operator's MAC scripts.

## V2b — the re-film with the Tests check (2026-10-14, stopped at a Grok usage cap)

Branch `video/v2b-refilm` (from `feat/m-desk-7`: S4 locks every Grok job to its copy, F1, F2). The same
stack, camera and take runner as V2, with:

- **K1, the film team runs the Tests check:** `story.json` "tests" (title "Tests pass" and the command
  that passes on trade_mcp `main` in the sandbox); `buildFilmTeam` wires Engineer → Tests pass →
  Reviewer, a failed check back to the Engineer (limit 3), the Fixer → Tests pass, and the group
  "Review loop" over all three. 2.4 gets the three gates bare and sets them on camera.
- **V2b output (K5):** takes in `video/takes/v2b/<take>/`, review files and the Desktop lock in
  `video/out/v2b/`; the ledger `video/out/v2b/budget.json` with caps 14 runs, 12 test replays, 2 Asks
  (`node video/camera/take.mjs budget` prints it). The contact sheet ranks V2b over V2 over V1; the
  scenes table has a V2b column; previews `video/out/v2b/ch2-preview.mp4` … `ch7-preview.mp4`.
- **The live smoke:** `flows.mjs` prints one `SMOKE: <check> PASS|FAIL <shot> — <why>` line per check
  (kept in take.json's notes): the toolbar/run-card/total-time layout, each Tests check moment (a
  failed check's lines opened), the Raw log lock lines, a Grok process watcher for Asks and test
  replays (their `--sandbox`), the hero's S2. `node video/camera/smoke.mjs hero|s4` adds what a take
  can't see: T1/T2 from the recording and the trajectory, F1, L1 over every recorded response, L2, L3
  against `gh api …/pulls/<n>/files`, the `HERO:` line, and S4 over every run's Desktop jobs.
- **3.4** starts at the Tests result (part `3.4-verdict` at the verdict); **3.7** asks from what really
  happened; **4.1** pauses only Claude's CLI; **4.2** opens from Home's Needs you; **6.1–6.3** clear
  leftovers, wait off camera, and **6.3**'s set is its own part (`6.3-set`).
- **`VIDEO_OTHER_DESKTOP_OK=<pid>`**: lets one named, idle Desktop of the operator's stay open; each
  take first waits until no runner polls the film account.
- **V2's hero recording** is kept at `video/recordings/hero-v2`; 3.1 records `video/recordings/hero`.

What was filmed, the runs (#1–#4, PRs #57–#59), every SMOKE line, the bends and what's still owed:
`video/SCENES.md` › V2b.

## V2 — real runs (2026-10-11, wrapped up after chapter 5)

Branch `video/v2-runs` (from `feat/m-desk-5`, whose M-desk-5 fixes L1–L4 the run scenes show). The
same stack, camera and take runner as V1, with:

- **V2 output:** takes in `video/takes/v2/<take>/` (a `--dry` rehearsal in `<take>-dry/`, so it never
  overwrites a filmed take), review files in `video/out/v2/`, the Desktop lock
  `video/out/v2/desktop.lock`.
- **The V2 ledger** `video/out/v2/budget.json`: caps 12 runs (a compare or task-set run counts as a
  run), 12 test replays (`save_with_tests` counts its tests), 2 Asks; `ctx.spend(kind, label, fn,
  units)` refuses past a cap, and only with `VIDEO_ALLOW_SPEND=1`.
- **Off-camera waits:** `ctx.offCamera(label, fn)` pauses the screencast (`capture.mjs`
  `pause`/`resume`, frame times shifted), shifts the cursor clock, and marks "back on camera" with
  `off_s` in take.json — a 35-minute run becomes a jump cut while the Desktop keeps working.
  `flows.toTheEnd` waits a run out that way and comes back on camera for each gate that needs the
  operator (`approveWaiting`: the "Awaiting your approval" card → Approve) and for the end.
- **Hero continuity:** 3.1 records the hero run to `video/recordings/hero/` (`meta.json`: team, run,
  task); 3.2–3.6 replay it; 0.1, 3.7, 5.1 and 6.1 find it with `flows.heroRun`. The record take opens
  every view a replay shows (G5). `film.filmTeam` reuses the "Indicator sprint team" or builds it.
- **Sample moments inside a live take:** `ctx.sample(label)` lists them under `sample` in take.json
  (6.1's AI checks, G7: the stack has no server checks model).
- **Review files:** `node video/camera/sheet.mjs contact-sheet` (the newest take of every scene: a
  filmed clip over a rehearsal over a failed take, V2 over V1), `preview <ch>` (chapter `ch`'s newest
  filmed takes at 1920×1080, no narration; a record take contributes its first minute), and
  `scenes-table` (V1 and V2 columns).

```bash
video/stack/reset                                         # V2 starts on a clean tvashtr_film
VIDEO_ALLOW_SPEND=1 caffeinate -dimsu node video/camera/take.mjs 3.1      # the hero, recorded
node video/camera/take.mjs 3.2 3.3 3.4 3.6                # replays (no spend)
VIDEO_ALLOW_SPEND=1 caffeinate -dimsu node video/camera/take.mjs 3.7 0.1
video/stack/down && QUIET=20 STALLED=60 FAIL=180 video/stack/up
VIDEO_ALLOW_SPEND=1 caffeinate -dimsu node video/camera/take.mjs 4.1     # then 4.2
video/stack/down && video/stack/up                        # normal timers again
VIDEO_ALLOW_SPEND=1 caffeinate -dimsu node video/camera/take.mjs '5.1*'
node video/camera/sheet.mjs contact-sheet && node video/camera/sheet.mjs preview 3
```

### V2 results (2026-10-11)

- Runs (ledger: **6 of 12 runs, 0 of 12 test replays, 1 of 2 Asks**): the hero `86bff6c6` (#1, "Add a
  Hull moving average indicator", 3 Grok rounds → Escalation approved on camera → PR
  https://github.com/lazyxgenius/trade_mcp/pull/53, "Done in 37m 16s · on your Claude and Grok
  subscriptions"); TRIX `99115ced` (#3, 4.1, "Failed after 4m 17s · on your Claude subscription"); the
  resume `828210b9` (#5, 4.2, from run #2 → PR https://github.com/lazyxgenius/trade_mcp/pull/54);
  DEMA `95a2d956` (#6, 5.1, from run #1's branch → PR https://github.com/lazyxgenius/trade_mcp/pull/55);
  two cancelled through the app after camera faults (#2 `e0078405`, #4 `77b1547e`).
- Takes (11 V2): 0.1 web 12.7 s · 3.1 record 2281.1 s · 3.2 15.8 s · 3.3 22 s · 3.4 29.8 s · 3.6
  25.6 s (replays) · 3.7 live 52.6 s · 4.1 live 282.4 s · 4.2 live 24.7 s · 5.1 live 26.5 s ·
  5.1-recent live 7 s.
- The live smoke: hero L1/H1, L2, L4, 3.7 L3, 4.1 H1/H2, 4.2 H2 all **PASS** (screenshots in
  SCENES.md); 6.1/6.2 (L1/D8) and 6.3 (H4/H5/H1) not run — owed with those scenes.
- Review files: `video/out/v2/contact-sheet.png` (33 takes: 11 V2, 22 V1),
  `video/out/v2/ch3-preview.mp4` (226.7 s), `video/out/v2/ch4-preview.mp4` (307.1 s).
- `video/out/github-session.json` deleted after 0.1 (G8).
- Owed: 6.1, 6.2 (saves v2), 6.3 (6 runs), the 2.7 re-take, the ch5/ch6 previews.

### What didn't work (V2)

- **4.1 looked for the job CLI too early and by the wrong mark.** It searched the Electron tree 3 s
  after "Working", before the runner had claimed the job, and matched `runner-jobs/` — only the Grok
  CLI has that (its `--prompt-file`); Claude reads its prompt on stdin. A run was spent and cancelled.
  Fixed: poll up to 90 s for `--output-format` (both CLIs).
- **Recent tasks covered the repo picker.** Home's composer opens Recent tasks once its matches load;
  an Esc pressed before that does nothing. Fixed in `composeAndLaunch`: wait for the list, then Esc.
- **`.first()` picked the wrong step.** 4.2 clicked the first "Resume from here" (the PM's), so the
  resume kept nothing; cancelling it still counts as picking run #3 up (the resumed run opened a
  step). Fixed: the "Suggested" row's button; 4.2 resumes the newest failed *or stopped* run whose
  suggested step skips work, from its run view when Needs you doesn't list it.
- **Rehearsals in the contact sheet.** `<take>-dry` folders showed as their own cells; `newest()` now
  ranks one take per scene.
- **Every run escalates.** The Desktop's Grok Reviewer can't run tests (no shell); each shipped run
  needed 3 rounds and an Escalation approval (filmed, G4: no instruction workarounds).

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
node video/camera/sheet.mjs pairs 3.2-replay   # video/out/v1/pairs-3.2-replay.png (live | replay)
```

### V1 results (2026-10-11)

- Filming stack: `tvashtr_film` at `0053_desktop_routes`, the account shown as "Lazyx"
  (`video/takes/v1/1.2/shots/account-menu.png`).
- F5 proof: run `610661d5` ("Add one line to README.md …", the film team without the domain step)
  recorded live in `3.2-proof` (1869 s, 4,189 responses, `video/recordings/proof-3.2/`), PR
  https://github.com/lazyxgenius/trade_mcp/pull/51 (shipped through the Escalation gate: see
  SCENES.md); replayed in `3.2-replay` with the Desktop runner signed out (every claim 401).
  Pairs (`video/out/v1/pairs-3.2-replay.png`): 53/74 identical, 71/74 identical apart from relative
  ages, 3/74 one Activity poll apart.
- Takes: every LIVE-now, SAMPLE-now and WEB scene filmed in the real Desktop; every run scene
  rehearsed with `--dry` (3.2/3.3/3.4/3.6 as replays of the proof recording); 0.1 blocked on the
  operator's GitHub session. `video/out/v1/contact-sheet.png`, `video/out/v1/ch2-preview.mp4`.
- Spends: 1 run (the proof), 1 test (2.7: 1 of 1 passed on Grok), 0 asks — `video/out/v1/budget.json`.

### What didn't work (V1)

- **Time-based replay alone isn't a re-take.** A replay that only follows the recording's clock
  moves on while the camera is still walking to the gate (the live approval came 12 s after the
  gate opened); fixed with holds. Answering a poll with "the latest response before now" showed a
  poll-old state when the replay's timer fired just before the live one; fixed with the nearest
  response (≤ 1 s ahead, never past a hold). A replay starting part-way in asked for Activity from
  scratch and crawled through the cursor chain; fixed by rebuilding that answer from the recording.
- **A replay can only show what the live take asked for:** a drawer the record take never opened is
  an unanswered request (3.4's Engineer drawer). V2's record take must open every view its replays show.
- **Relative ages ("4 s ago")** tick with each poll, so a replay matches them only to the poll; the
  pair report counts exact matches and matches apart from relative ages separately.
- **Selectors by visible text can match too much:** "approval" matched "PRD approval" (2.4's first
  take configured the wrong gate); gates are now found by node id.
- **The Desktop's launch probe once read Grok as "Needs login"** while `grok models` answered in
  1 s; the pre-roll now asks the app to Refresh and waits for the server to count the runner fresh.
- **Hidden switches** (`role=switch` inputs) have no box to aim at: the cursor aims at their label.
- **trade_mcp is private:** the PR page (0.1) needs the operator's GitHub session.

## Files

| Path | What |
|---|---|
| `story.json` | the film's story (F2): one source for every take and fixture |
| `stack/` | the filming stack on `tvashtr_film` (`up`, `down`, `reset`, `lib.sh`) |
| `Makefile` | `make -C video take SCENE=<id> [DRY=1]`, `list`, `up`/`down`/`reset`, review files |
| `SCENES.md` | every scene's status, story mismatches, V2's needs, the operator's MAC scripts |
| `camera/take.mjs` | the take runner (modes, pre-roll, spends ledger, Desktop lock, pairs) |
| `camera/cursor.mjs` | the in-page cursor (F7) and the step log |
| `camera/intercept.mjs` | sample fixtures, record, replay (holds, nearest poll, clock shift) |
| `camera/film.mjs` | off-camera setup through the app's API (the film team by stage, Toolkit, domain) |
| `camera/flows.mjs` | on-camera flows (composer, gates, run views, canvas) and recording markers |
| `camera/scenes/<id>.mjs` | one script per scene (31) |
| `camera/sheet.mjs` | contact sheet, chapter previews, pairs sheet, SCENES.md table |
| `camera/smoke.mjs` | V2b's API-side live smoke: `hero` (T1/T2, F1, L1–L3, the HERO line), `s4` (every run's Desktop jobs) |
| `camera/github-login.mjs` | operator, once: a GitHub session for 0.1 (trade_mcp is private) |
| `fixtures/` | sample data: `base.mjs`, `live-base.json` (+ `capture-live.mjs`, `export-live.mjs`), one module per SAMPLE scene, `files/` |
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

V1: `video/stack/up` does all of this on `tvashtr_film` (above). V0's manual recipe, on the dev
database, for the record:

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
