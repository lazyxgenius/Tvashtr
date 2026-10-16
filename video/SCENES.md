# The demo film's scenes (V1, V2, V2b)

Every scene of the storyboard (`prompts/video-v1.md`) as a take script that re-records by name:
`make -C video take SCENE=<id>` (`DRY=1` to rehearse; `"<id>*"` for a scene's parts). V2b's takes land
in `video/takes/v2b/<take>/` (V1's and V2's stay in `video/takes/v1/`, `video/takes/v2/`; a rehearsal in
`<take>-dry/`) — `take.mp4` 2880×1800 · 30 fps, `take.json`, `poster.png`, `shots/`. Review files:
`video/out/v2b/contact-sheet.png` (the newest take of every scene, V2b over V2 over V1) and
`video/out/v2b/ch2-preview.mp4` … `ch7-preview.mp4` (V1's and V2's `video/out/…` stay). How the camera
works: `video/README.md`.

## Status

Generated from the takes on disk (`node video/camera/sheet.mjs scenes-table`): one row per take,
its V1, V2 and V2b status. "clip" = a filmed take (mode, raw length); "rehearsed" = a `--dry` take
that stopped before the named spend (or ran through when it spends nothing); "—" = not taken in that
version. Budgets are the scene's own and the plan's chapter budget — raw takes run longer on purpose
(record more, V4 trims). V2b's first sitting stopped at a Grok usage cap; **its second sitting
(2026-10-16) filmed everything it owed** — 6.1–6.3 on a fresh team with the Reviewer on Claude Opus,
3.5, chapters 2 and 7, and 0.1 (below).

<!-- scenes-table -->
| take | script | V1 | V2 | V2b | scene budget · chapter budget |
|---|---|---|---|---|---|
| 0.1 | `scenes/0.1.mjs` (web) | blocked: trade_mcp is private — run node video/camera/github-login.mjs once (operator) | clip (web) 12.7 s | clip (web) 12.7 s | 20 s · ch 0: 20 s |
| 0.2 | `scenes/0.2.mjs` (motion) | MOTION | MOTION | MOTION | — s · ch 0: 20 s |
| 1.1 | `scenes/1.1.mjs` (mac) | MAC | MAC | MAC | — s · ch 1: 55 s |
| 1.2 | `scenes/1.2.mjs` (live) | clip (live) 15.3 s | — | rehearsed (live, no spend) | 20 s · ch 1: 55 s |
| 1.3 | `scenes/1.3.mjs` (live) | clip (live) 43.1 s | — | — | 20 s · ch 1: 55 s |
| 1.4 | `scenes/1.4.mjs` (sample) | clip (sample) 20.2 s | — | — | 12 s · ch 1: 55 s |
| 1.5 | `scenes/1.5.mjs` (sample) | clip (sample) 36.9 s | — | — | 15 s · ch 1: 55 s |
| 2.1 | `scenes/2.1.mjs` (live) | clip (live) 14.3 s | — | — | 12 s · ch 2: 70 s |
| 2.2 | `scenes/2.2.mjs` (live) | clip (live) 18.8 s | — | — | 12 s · ch 2: 70 s |
| 2.3 | `scenes/2.3.mjs` (live) | clip (live) 12.6 s | — | — | 12 s · ch 2: 70 s |
| 2.4 | `scenes/2.4.mjs` (live) | clip (live) 80.7 s | — | clip (live) 66.9 s | 30 s · ch 2: 70 s |
| 2.5 | `scenes/2.5.mjs` (live) | clip (live) 40.8 s | — | clip (live) 49.8 s | 25 s · ch 2: 70 s |
| 2.6 | `scenes/2.6.mjs` (live) | clip (live) 29.2 s | — | clip (live) 31.7 s | 25 s · ch 2: 70 s |
| 2.7 | `scenes/2.7.mjs` (live) | clip (live) 154.6 s | — | clip (live) 56.1 s | 30 s · ch 2: 70 s |
| 3.1 | `scenes/3.1.mjs` (record) | rehearsed · stopped before “Launch” | clip (record) 2281.1 s | clip (record) 657.2 s | 15 s · ch 3: 90 s |
| 3.2 | `scenes/3.2.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 15.8 s | clip (replay) 15.8 s | 25 s · ch 3: 90 s |
| 3.2-proof | `scenes/3.2.mjs` (record) | clip (record) 1869.2 s | — | — | 25 s · ch 3: 90 s |
| 3.2-replay | `scenes/3.2.mjs` (replay) | clip (replay) 1867 s | — | — | 25 s · ch 3: 90 s |
| 3.3 | `scenes/3.3.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 22 s | clip (replay) 22.4 s | 25 s · ch 3: 90 s |
| 3.4 | `scenes/3.4.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 29.8 s | clip (replay) 22 s | 30 s · ch 3: 90 s |
| 3.4-verdict | `scenes/3.4.mjs` (replay) | — | — | clip (replay) 30.1 s | 30 s · ch 3: 90 s |
| 3.5 | `scenes/3.5.mjs` (sample) | clip (sample) 21 s | — | clip (sample) 20.5 s | 15 s · ch 3: 90 s |
| 3.6 | `scenes/3.6.mjs` (replay) | rehearsed (replay, no spend) | clip (replay) 25.6 s | clip (replay) 24.1 s | 20 s · ch 3: 90 s |
| 3.7 | `scenes/3.7.mjs` (live) | rehearsed · stopped before “Send” | clip (live) 52.6 s | clip (live) 77.4 s | 30 s · ch 3: 90 s |
| 4.1 | `scenes/4.1.mjs` (live) | rehearsed · stopped before “Launch” | clip (live) 282.4 s | clip (live) 319.2 s | 30 s · ch 4: 45 s |
| 4.2 | `scenes/4.2.mjs` (live) | rehearsed · stopped before “Resume (needs 4.1's failed run)” | clip (live) 24.7 s | clip (live) 19.9 s | 25 s · ch 4: 45 s |
| 4.2-p6 | `scenes/4.2.mjs` (live) | — | — | clip (live) 40.1 s | 25 s · ch 4: 45 s |
| 5.1 | `scenes/5.1.mjs` (live) | rehearsed · stopped before “Start run” | clip (live) 26.5 s | clip (live) 22.6 s | 25 s · ch 5: 30 s |
| 5.1-recent | `scenes/5.1.mjs` (live) | rehearsed (live, no spend) | clip (live) 7 s | clip (live) 6.9 s | 25 s · ch 5: 30 s |
| 6.1 | `scenes/6.1.mjs` (live) | rehearsed · stopped before “Run all” | — | clip (live) 28.5 s | 30 s · ch 6: 75 s |
| 6.1-evidence | `scenes/6.1.mjs` (live) | — | — | clip (live) 37.9 s | 30 s · ch 6: 75 s |
| 6.1-p5 | `scenes/6.1.mjs` (live) | — | — | clip (live) 18.5 s | 30 s · ch 6: 75 s |
| 6.1-s4 | `scenes/6.1.mjs` (live) | — | — | clip (live) 9.4 s | 30 s · ch 6: 75 s |
| 6.1-seed | `scenes/6.1.mjs` (live) | — | — | clip (live) 34.4 s | 30 s · ch 6: 75 s |
| 6.2 | `scenes/6.2.mjs` (run) | clip (sample) 23.9 s | — | clip (run) 60.9 s | 40 s · ch 6: 75 s |
| 6.3 | `scenes/6.3.mjs` (run) | rehearsed · stopped before “Start compare” | — | clip (run) 35.4 s | 40 s · ch 6: 75 s |
| 6.3-set | `scenes/6.3.mjs` (run) | — | — | clip (run) 72.1 s | 40 s · ch 6: 75 s |
| 7.1 | `scenes/7.1.mjs` (live) | clip (live) 27.6 s | — | clip (live) 27.7 s | 20 s · ch 7: 30 s |
| 7.2 | `scenes/7.2.mjs` (live) | clip (live) 33.3 s | — | clip (live) 33.6 s | 30 s · ch 7: 30 s |
| 8.1 | `scenes/8.1.mjs` (sample) | clip (sample) 23.6 s | — | — | 25 s · ch 8: 25 s |
| 8.1-web | `scenes/8.1.mjs` (web) | clip (web) 23.5 s | — | — | 25 s · ch 8: 25 s |
| 8.2 | `scenes/8.2.mjs` (motion) | MOTION | MOTION | MOTION | — s · ch 8: 25 s |
<!-- /scenes-table -->

## V2b, second sitting (2026-10-16): the Reviewer on Claude Opus, chapter 6 on a fresh team, every owed scene

Brief `prompts/m-desk-8-v2b2.md` Part B, on `video/v2b-refilm`: `feat/m-desk-8` merged in (`db0135b2`,
`--no-ff`; P1–P6, the on-camera fixes the first sitting's product notes asked for). No Grok job ran in
this sitting. Ledger `video/out/v2b/budget-2.json` (caps 10 runs · 12 test replays · 1 Ask): **runs 8 ·
test replays 9 · Asks 1**; Claude CLI probes 1 of 2.

- **K8: the Reviewer runs on `anthropic/claude-opus-5-5`** for the rest of the film (`story.json`
  `agents.reviewer`, `runs_on: "claude"`). The picker's Claude presets are Sonnet 5 and Sonnet 4, so
  Opus goes in as a custom model ID (`flows.pickCustomModel`); one `claude -p --model claude-opus-5-5`
  with the runner's own flags proved the operator's subscription takes it (`apiKeySource=none`, reply
  "ok"). **The continuity break is accepted:** chapters 3–5 show the Grok Reviewer (V2b's first
  sitting); chapters 2, 6 and 7 show the Opus one.
- **K9: chapter 6 on a fresh "Indicator sprint team"** (final, no Query domain step, the Tests check,
  the Opus Reviewer; the hero team became "Indicator sprint team (earlier)"), with one **seed run off
  camera** (part `6.1-seed`, `video/out/v2b/seed.json`; `flows.seedRun` finds it).
- **K10: 6.1 and 6.2 re-taken whole** on that team; 6.3 and its set followed. Chapter 2 rebuilt the
  film team after chapter 6 (its own team renamed "… (earlier)", its runs kept).

### The real runs (second sitting)

| run | # | scene | task | what happened | wall clock | PR |
|---|---|---|---|---|---|---|
| `70e2e4bf` | 1 | 6.1-seed (off camera) | Add a zero-lag EMA indicator, fresh team v1 | spec gate approved → Engineer → **Tests failed** (12 lines back) → Engineer round 2 → **Tests passed · 665** → Opus Reviewer **approved round 1** ("Approved — zlema is a pure function in core/indicators.py:31 …") → Secret scan → No edits to servers/ → Ship | "Done in 6m 7s · on your Claude subscription" | [#63](https://github.com/lazyxgenius/trade_mcp/pull/63) |
| `a2cb79c8` | 5 | 4.2-p6 (evidence) | Add an Ultimate oscillator indicator, on the "(earlier)" team | spec gate approved → Engineer started → stopped through the app → the resume confirm opened for P6, then cancelled | stopped | — |
| `b30aac78` / `afe9c70e` | 3 | 6.3 compare | Add a TEMA indicator, v1 / v2 | each: Tests failed → Engineer round 2 → Tests passed → Reviewer approved; **"v2 did better"** (Reviewer's tests 3 of 4 → 4 of 4; work 2m 30s vs 3m 26s) | 6m 2s / 6m 54s (lanes take turns on Claude) | none in a compare |
| `04ba00a7` / `b686e82c` | 5 | 6.3-set | Add a Vortex indicator, v1 / v2 | as above; hidden checks pass | 8m 22s / 9m 27s | none in a compare |
| `0ceade84` / `e7029130` | 7 | 6.3-set | Add a Chande momentum oscillator, v1 / v2 | as above; set: hidden checks **2 of 2 → 2 of 2**, rounds 2.0 → 2.0, no Restore | 8m 56s / 9m 47s | none in a compare |

Test replays: 6.1 "Run all 4" on v1 (**3 of 4 passed** — the round test failed for real: the replayed
Reviewer had no test result, below), 6.2 "Save and run tests" on v2 (4), 2.7 "Run all 1" on a chapter-2
team (**1 of 1 passed**). The one Ask (6.1-evidence, the seed run's Opus Reviewer): "In a short
bulleted list, what did you check before you approved? Put each file name in backticks." (its answer
is kept at `video/out/v2b/ask-answer.md`).

### The live smoke (second sitting) — every line with its screenshot (opened)

| check | result | screenshot (`takes/v2b/…`) |
|---|---|---|
| 6.1 L1/D8 | **PASS** — 0.0 s: "On v1 · on your Claude subscription"; results "3 of 4 passed" (real counts, no usage error) | `6.1/shots/running.png`, `results.png` |
| S4 (6.1's replays on Claude) | **PASS** — 4× `--restricted --safe-mode` | `6.1/shots/results.png` |
| 6.2 L1/D8 | **PASS** — 0.0 s: `ran_on {"subscriptions":["claude"],"all":true}`; the card "Testing 1 of 4" | `6.2/shots/testing.png` |
| S4 (6.2's replays on Claude) | **PASS** — 4× `--restricted --safe-mode` | `6.2/shots/tested.png` |
| 6.3 H5 (compare) | **PASS** — "about 12 min" = the turns added up (12) | `6.3/shots/6.3-lanes.png` |
| 6.3 H1 lanes / results | **PASS** — header and lanes "on your Claude subscription"; v2's lane "PM · Waiting for your Claude subscription — one job at a time."; Cost rows name the subscription | `6.3/shots/6.3-lanes.png`, `6.3-compare-results.png` |
| 6.3 H5 (set) | **PASS** — "about 26 min" = 26 | `6.3-set/shots/6.3-set-queued.png` |
| 6.3 H4 | **PASS** — a queued cell "PM · Waiting for your Claude subscription — one job at a time." | `6.3-set/shots/6.3-set-queued.png` |
| 6.3 H1 set running / results | **PASS** — cost cards and cells "on your Claude subscription" | `6.3-set/shots/6.3-set-results.png` |
| 6.3 every lane runs the Tests check | **PASS** — 6 of 6 lane runs: "Tests failed — back to Engineer with the last 12 lines" → "Tests passed" | `6.3-set/shots/6.3-set-results.png` |
| P1 (2.4's gate cards) | **PASS** — bare and set: "PRD approval · Escalation · Tests pass · Secret scan · No edits to servers/", never a raw kind | `2.4/shots/p1-gates-bare.png`, `p1-gates-set.png` |
| P2 (a run view's loop arcs) | **PASS** — "tests failed" on the check's arc, "changes requested" on the Reviewer's | `6.1-evidence/shots/p2-arcs.png` |
| P3 (a verdict line) | **PASS** — "Approved — zlema is a pure function in core/indicators.py:31 …" | `6.1-evidence/shots/p3-verdict.png` |
| P4 (a drawer's round row) | **PASS** — "113,198 in / 2,940 out · on your Claude subscription", no $0.0000 | `6.1-evidence/shots/p4-round-row.png` |
| P5 (the Ask's answer renders markdown) | **PASS** — strong 9 · li 9 · code 30, no `**` outside code (the in-take line of 6.1-evidence said FAIL: its heuristic counted a glob's `**` inside a code span; fixed, and 6.1-p5 replays that exact answer with no spend) | `6.1-p5/shots/p5-answer-whole.png`, `p5-ask-replay.png` |
| S4 (the Ask on Claude) | **PASS** — `--restricted --safe-mode` | `6.1-evidence/shots/p5-ask.png` |
| P6 (the resume confirm) | **PASS** — runs again: "Engineer · round 1 / Tests pass — Tvashtr runs the tests / Reviewer · round 1, and round 2 if it asks for more / Secret scan — Tvashtr checks it / No edits to servers/ — Tvashtr checks it / Ship, if the checks pass" | `4.2-p6/shots/p6-confirm.png` |
| 2.5 (same-model advisory) | **PASS** — "Reviewer and Engineer both run anthropic/claude-sonnet-5 …" → `anthropic/claude-opus-5-5`: cleared | `2.5/shots/same-model-hint.png`, `chosen-model.png` |
| 2.7 L1/D8 | **PASS** — 0.0 s: "On v1 · on your Claude subscription"; "1 of 1 passed" | `2.7/shots/running.png`, `tested.png` |
| S4 (2.7's replay on Claude) | **PASS** — `--restricted --safe-mode` | `2.7/shots/tested.png` |
| S4 (every Claude job's lock line) | **PASS** — `smoke.mjs s4` on all 12 runs; this sitting's 8: 0 Grok · 29 Claude jobs, each with its lock line and `--restricted`; the seed run's Reviewer: "--model claude-opus-5-5 --restricted --safe-mode; lock line present" | `6.1-s4/shots/reviewer-raw-log-drawer.png` |

### Bends from the storyboard (second sitting)

- **K8's continuity break** (above): the Reviewer's model changes between chapter 5 and chapter 6.
- **2.5 ends on a warning, not a clean pick:** the advisory clears on Opus, and in its place the
  custom ID shows "No provider matches anthropic/claude-opus-5-5. On this Mac it runs on your Claude
  subscription; it will fail at run time if the name is wrong." (true — Opus isn't a preset; the probe
  and the seed run prove the name).
- **6.1's round test fails for real** ("3 of 4 passed"): replayed on round 1's inputs, the Opus
  Reviewer asked for test output — a test replay doesn't carry the Tests check's result. Kept (G1);
  6.2's v2 adds the line and reads 4 of 4.
- **The P-items are shown in evidence takes** where the film's own take doesn't reach them:
  `6.1-evidence` (P2–P5, the one Ask), `6.1-p5` (P5 whole, no spend), `4.2-p6` (P6 on a stopped run),
  `6.1-s4` (S4's lock line). Their titles say "not for the film"; previews leave them out.
- **3.5's sample follows the film team:** `fixtures/base.mjs` picks the film team's graph by name (the
  capture now passes chapter 6's canvas too) and the sample's `ran_on` is Claude plus the DeepSeek key
  (it read "Claude and Grok").
- **0.1 is filmed on PR #57** (the hero's) with the operator's GitHub session, deleted after (never
  opened).

### Product notes seen on camera (for the architect; no product code in Part B)

- A test replay doesn't carry the Tests check's result, so a Reviewer test can fail on "no test result
  was supplied" (6.1's round test).
- The Now bar's chips still name checks by kind ("Secret leak scan", "Diff touches forbidden paths")
  — P1 fixed the canvas cards only (3.5, 6.1).
- The run drawer's lower area is short under the Activity panel: an Ask's answer and the Raw log sit
  below its fold, and Raw log rows are cut to a few characters (the full line is the row's title).
- "1 library tool(s) — tools aren't used by Desktop subscription agents yet" shows on every run.
- "$0.00 in all" on compare and set results is the key-spend total (by design), beside cards that
  name the subscription.
- Import's "things to fix" card lists "Add a key for anthropic" twice (one per Claude model) on an
  account without the Desktop (7.2).

### What V3 needs (second sitting)

- **6.1** (28.5 s), **6.2** (60.9 s), **6.3** (35.4 s), **6.3-set** (72.1 s): keep; chapter 6 now
  reads v1 → v2 → "v2 did better" on the Opus Reviewer.
- **2.4** (66.9 s), **2.5** (49.8 s; caption or trim the custom-ID warning), **2.6** (31.7 s), **2.7**
  (56.1 s): keep; 2.1–2.3 stay V1's.
- **3.5** (20.5 s, sample): keep. **7.1** (27.7 s) and **7.2** (33.6 s): keep. **0.1** (12.7 s): keep.
- Still V1-only: 1.3–1.5, 2.1–2.3, 8.1; MAC and MOTION scenes are the operator's.
- Review files: `video/out/v2b/contact-sheet.png` (40 takes: 28 V2b, 12 V1) and
  `ch2-preview.mp4` 250.0 s · `ch3` 272.3 s · `ch4` 339.0 s · `ch5` 29.5 s · `ch6` 197.0 s · `ch7` 61.2 s.

## V2b (2026-10-14): the re-film with the Tests check — stopped at a Grok usage cap

Brief `prompts/m-desk-7-v2b.md` Part B, on `video/v2b-refilm` (from `feat/m-desk-7` 71ca1078: S4 locks
every Grok job to its copy, F1 names the check "Tests pass", F2 keeps the running toolbar on one row).
`video/stack/reset` first (a clean `tvashtr_film`: run #1 is the hero), Claude and Grok **Connected**
(`takes/v2b/1.2-dry/shots/engines-connected.png`), `apiKeySource: none` on every Claude job that spoke,
`READING_KEY = none`. **K1:** the film team runs Engineer → **Tests pass** → Reviewer; a failed check
goes back to the Engineer (limit 3); the Fixer feeds Tests pass; the group "Review loop" holds all
three (`story.json` "tests": `pip install -q -e '.[dev]' 'mcp<2' -e servers/kline_cache && python -m
pytest -q tests`).

Sittings 1 (chapter 3) and 2 (chapter 4) and most of 3 (5.1, 5.1-recent, 6.1, 6.2) are filmed. During
6.1 the operator's Grok plan hit its limit: **every Grok test replay since 09:52 UTC answered "You've
reached your free Grok Build usage limit for now … try again later"** (no reset time shown). V2b stops
there (NEEDS_HUMAN), before 6.3 and the chapter 2/7 re-takes.

### The real runs (ledger `video/out/v2b/budget.json`: runs 4 of 14 · test replays 8 of 12 · Asks 1 of 2)

| run | # | scene | task | what happened | length | PR |
|---|---|---|---|---|---|---|
| `b98f6fcc` | 1 | 3.1 hero (recorded) | Add a Hull moving average indicator — trade_mcp, `main`, scope `core/`, budget $5.00 | PM → spec gate (one line added, approved on camera) → Engineer → **Tests failed — back to Engineer with the last 12 lines** → Engineer round 2 → **Tests passed · 665 passed, 16 deselected, 3 warnings in 1.68s** → Grok Reviewer **approved round 1**, citing "Tvashtr pytest reported 665 passed…" → Secret scan → No edits to servers/ → Ship; no Escalation | "Done in 10m 21s" (unchanged after "Saved 6 new memories") | [#57](https://github.com/lazyxgenius/trade_mcp/pull/57) |
| `51d784d3` | 2 | 4.1 | Add a TRIX indicator | stack QUIET=20 STALLED=60 FAIL=180; spec gate approved → the Engineer's Claude CLI paused at its start (SIGSTOP, the Desktop's own process tree, only Claude's `stream-json`) → Quiet → Stalled → Failed | "Failed after 4m 52s · on your Claude subscription" | — |
| `3da31f1c` | 3 | 4.2 | resume of run #2 from Engineer, round 1 — opened from **Home's Needs you** | stack back to normal timers; spec v2 + approval kept ("Skips 1 min of finished work") → Engineer → Tests failed → Engineer → Tests passed · 664 → Reviewer approved → Ship | "Done in 7m 4s" | [#58](https://github.com/lazyxgenius/trade_mcp/pull/58) |
| `f7d6c632` | 4 | 5.1 | Add a DEMA indicator, from run #1 ("brought spec v2, 1 decision and 1 memory"), from the hero's PR branch | PM → PRD gate approved on camera → Engineer → Tests failed → Engineer → Tests passed · 669 → Reviewer approved → Ship; PR #59's base is `tvashtr/b98f6fcc-…` | "Done in 7m 9s" | [#59](https://github.com/lazyxgenius/trade_mcp/pull/59) |

Test replays: 6.1 "Run all 4" on v1 (the round-1 test + 3 CSV tests) and 6.2 "Save and run tests" on v2
(4) — all 8 ran under their own Grok profiles and **all 8 failed on the usage limit** ("It didn't
finish: … free Grok Build usage limit"), so both versions read 0 of 4. The one Ask (3.7, Grok):
"Tvashtr's tests failed on the first build. What did you check once they passed?" → "Once the run
reported **665 passed** the reviewer did not…" (K4: the question follows what really happened).

### The live smoke (V2b) — every line with its screenshot (opened)

| check | result | screenshot |
|---|---|---|
| Hero Tests check (T1): "Running the tests…" then "Tests failed — back to Engineer with the last 12 lines" / "Tests passed · …" | **PASS** — failed (12 lines shown on camera) → passed · 665 passed | `takes/v2b/3.1/shots/tests-1-running.png`, `tests-2-failed.png`, `tests-4-passed.png` |
| Hero T2: the failed lines reach the Engineer's next round; the Reviewer cites Tvashtr's result; no verdict asks for command or test output | **PASS** — 1 failed check, its lines in the Engineer's round 2 (`revision`); the Reviewer was given `check_result` and wrote "Tvashtr pytest reported 665 passed, 16 deselected, 3 warnings"; no ask for output | `takes/v2b/3.1/shots/reviewer-verdict.png` |
| Hero S2: the Done line keeps its time after the post-ship memory save | **PASS** — "Done in 10m 21s · on your Claude and Grok subscriptions" before and after "Saved 6 new memories" | `takes/v2b/3.1/shots/done-after-memories.png` |
| Hero S1 + F2 at 1440×900 | **PASS** — running toolbar 56 px with the Engineer and with the Reviewer working, run card inside the bar and clear; the Done summary keeps "total time" | `takes/v2b/3.1/shots/running.png`, `running-reviewer.png`, `done.png` |
| F1: the check never reads "Approve before continuing?" | **PASS** — canvas card "Tests pass" (`takes/v2b/3.1-dry/shots/canvas.png`), run view card (`3.1/shots/done.png`), Activity label "Tests pass" | as listed |
| S4: every Grok job's lock line + its own `--sandbox tvashtr-j<hex>`; every Claude job's lock line + `--restricted`; no file opened outside the copy | **PASS** — runs #1–#4: 3 Grok + 10 Claude jobs (`node video/camera/smoke.mjs s4`); Grok folders under `…/T/tvg-0484c6/j…`; the Ask (`tvashtr-j47f6e1`) and all 8 test replays ran under their own profiles | `takes/v2b/s4-rawlog/shots/reviewer-lock-line.png`, `engineer-lock-line.png`, `3.7/shots/ask.png`, `6.1/shots/results.png`, `6.2/shots/tested.png` |
| L1/H1: the subscriptions wording from launch to Done | **PASS** — 0 of 1525 recorded responses with "$0.00 +"/"$0.0000" or a Desktop read saying not all on subscriptions; Done line "· on your Claude and Grok subscriptions" | `takes/v2b/3.1/shots/done.png` |
| L2: no verdict names Tvashtr's own files | **PASS** | `takes/v2b/3.1/shots/reviewer-verdict.png` |
| L3: Changes after Done = the PR's "Files changed" | **PASS** — `core/indicators.py` +22, `tests/test_indicators.py` +35 −3, `web/lib/engine-facts.ts` +1 −1 = PR #57 | `takes/v2b/3.7/shots/changes.png` |
| 4.1 H1/H2 | **PASS** — "Failed after 4m 52s · on your Claude subscription"; "Next: resume from Engineer, round 1. Tvashtr skips the work that is done…" | `takes/v2b/4.1/shots/failed.png` |
| 4.2 opens from Needs you; H2 confirm; no dollar per step | **PASS** — "Run failed · Add a TRIX indicator · Resume"; "This starts run #3. It picks up where run #2 stopped." "Skips 1 min of finished work. Only the steps that run again use your Claude subscription." | `takes/v2b/4.2/shots/needs-you.png`, `confirm.png`, `picker.png` |
| 6.1 L1/D8: a running test's line names its subscription from its first second | **PASS** — "Running 1 of 4 · 0s — On v1 · on your Grok subscription", 0.9 s after the click (take.json: click 26.6 s, shot 27.5 s; the in-take line printed FAIL because it timed from the cursor's glide — fixed 36f32863) | `takes/v2b/6.1/shots/running.png` |
| 6.2 L1/D8 | **PASS** — at the click the app's Tests read already said `ran_on {"subscriptions":["grok"],"all":true}` | `takes/v2b/6.2/shots/testing.png` |
| 6.3 H4, H5, H1 | **NOT RUN** — 6.3 not filmed (usage cap) | — |
| 2.7 L1/D8 | **NOT RUN** — chapter 2 not re-taken (filmed last; usage cap) | — |

### Bends from the storyboard (V2b)

- **A Grok usage cap stopped the session** (above). 6.1's and 6.2's footage shows the real outcome
  (G1): "0 of 4 passed" with the usage-limit error on every row; 6.2's History pills read 0/4 for v1
  and v2. Their non-test beats (Make this a test, the CSV, Save as v2, History, What changed in v2)
  are filmed as intended.
- **The Tests check is round 1's story now:** every run's first build failed the check (the
  indicator count pinned in the tests), went back to the Engineer with the last 12 lines, passed, and
  the Grok Reviewer approved round 1 — no Escalation in V2b (V2's runs all escalated).
- **4.2 opens from Home's Needs you** (K3, lost in V2), on the normal-timer stack: the stack was put
  back to normal *before* 4.2 so a quiet Grok Reviewer can't fail the resumed run at FAIL=180.
- **3.5 moved to the last sitting:** re-capturing its sample base (`fixtures/capture-live.mjs`)
  rebuilds the film team by name, which would retire the hero team chapters 3–6 work on.
- **0.1 is blocked:** `video/out/github-session.json` was deleted after V2's 0.1 (G8); the operator
  signs in again with `node video/camera/github-login.mjs` before a re-take.
- **The operator's installed Tvashtr.app was open** (idle, not signed in to this stack — no runner
  polled the film account): `take.mjs` gained `VIDEO_OTHER_DESKTOP_OK=<pid>`; it was never touched.
- **S4 screenshots come from an evidence take** (`takes/v2b/s4-rawlog`, no spend): the record take's
  Raw log sat below the short drawer's fold; the evidence take wraps the feed rows (a style injected
  into that take only) so the lock lines read whole.
- **V2's hero recording** moved to `video/recordings/hero-v2` (3.1 records to `hero`).

### Product notes seen on camera (for the architect; no product code in Part B)

- The Activity verdict line drops a `reasons` **string** (the Reviewer wrote one): "Approved" shows
  without its reasons, though `REVIEW_VERDICT.json` cites Tvashtr's pytest.
- The guardrail cards read their raw kinds (`secret_leak_scan`, `diff_touches_forbidden_paths`):
  `gateLabel` names only PRD approval, Escalation and Tests pass.
- Both loop arcs (Tests pass → Engineer, Reviewer → Engineer) read "changes requested".
- The resume confirm lists "Tests pass, when you approve" (the check needs no approval) and "use your
  Claude subscription" though the Grok Reviewer runs again.
- The Reviewer drawer's round row reads "$0.0000" (3.7's "cost per round"); the Ask's answer shows raw
  `**markdown**`; "1 library tool(s) — tools aren't used by Desktop subscription agents yet" shows on
  every run.

### Still owed (V2b → after the Grok limit resets)

All filmed in the second sitting (above): the Reviewer moved to Claude (K8), so no Grok job was needed.

| scene | real work | note |
|---|---|---|
| 6.1 / 6.2 test results | "Run again" on v1 and v2: 4 + 4 test replays | the budget has **4** left (8 of 12 spent on the capped replays) — the architect decides |
| 6.3 + 6.3-set | 2 + 4 runs (budget left 10) | hidden checks proven in the sandbox image (127 passed on `main`, exit 0; the indicator greps exit 1 until an agent adds them) |
| 3.5 | none (sample) | after 6.3: `take.mjs video/fixtures/capture-live.mjs`, `node video/fixtures/export-live.mjs`, then `take.mjs 3.5` |
| 2.4, 2.5, 2.6, 2.7, 7.1, 7.2 | 2.7: 1 test replay | last (they rebuild teams by name) |
| 0.1 | none | needs the operator's GitHub session; delete it after (G8) |
| review files | none | contact sheet + ch2–ch7 previews again at the end |

### What V3 needs (per filmed scene)

- **3.1** (record, 657.2 s): keep; V4 uses its first minute. **3.2** 15.8 s, **3.3** 22.4 s, **3.4**
  22 s (Tests failed → its lines opened), **3.4-verdict** 30.1 s, **3.6** 24.1 s: keep; re-takes are
  free from `recordings/hero`.
- **3.7** (77.4 s, 1 Ask): keep; caption "cost per round $0.0000" (product) or crop it.
- **4.1** (319.2 s) and **4.2** (19.9 s on camera): keep — 4.2 now opens on Needs you.
- **5.1** (22.6 s) and **5.1-recent** (6.9 s): keep.
- **6.1** (29 s) and **6.2** (60.6 s): re-take their results after the limit resets (or V4 cuts at
  "Running 1 of 4").
- **6.3**, **3.5**, **0.1**, chapters **2** and **7**: owed (above).

## V2 (2026-10-11): the real runs — wrapped up after chapter 5

Brief `prompts/m-desk-5-v2.md` Part B, on `video/v2-runs`, after Part A (M-desk-5) fixed L1–L4.
`video/stack/reset` first (a clean `tvashtr_film`), Claude and Grok **Connected** on the Desktop, the
Claude CLI log `apiKeySource: none` on every job, `READING_KEY = none`. Sittings 1 (chapter 3 + 0.1)
and 2 (chapter 4) are done; sitting 3 stopped after 5.1 on the operator's request: **6.1, 6.2, 6.3
and the 2.7 re-take are still owed** (and with them the 6.1/6.2 and 6.3 smoke checks and the
ch5/ch6 previews).

### The real runs (ledger `video/out/v2/budget.json`: runs 6 of 12 · test replays 0 of 12 · Asks 1 of 2)

Run numbers are the app's (the account's runs in order). Times per job are the Desktop runner's
claim → finish; a run's length is the app's own where it showed one.

| run | # | scene | task | what happened | length | PR |
|---|---|---|---|---|---|---|
| `86bff6c6` | 1 | 3.1 hero (recorded) | Add a Hull moving average indicator — trade_mcp, `main`, scope `core/`, budget $5.00 | PM 1.5 min → spec gate (one line added, approved on camera) → Engineer 2.0 → Grok Reviewer 5.5 (changes requested: the indicator registry) → Engineer 3.5 → Reviewer 12.0 → Engineer 3.2 → Reviewer 9.0 → Escalation approved on camera → Ship | "Done in 37m 16s" (37m 36s later: see bends) | [#53](https://github.com/lazyxgenius/trade_mcp/pull/53) |
| `e0078405` | 2 | 4.1, take 1 | Add a TRIX indicator | the camera found no job CLI to pause (a camera bug, fixed) → **cancelled through the app**; its Engineer had already edited `core/indicators.py` +1 | — | — |
| `99115ced` | 3 | 4.1 | Add a TRIX indicator | PM 0.6 → spec gate approved → Engineer's CLI paused at its start (SIGSTOP, the Desktop's own process tree) → Quiet → Stalled → Failed | "Failed after 4m 17s" | — |
| `77b1547e` | 4 | 4.2, take 1 | resume of run #3 | camera slip: the scene clicked the first "Resume from here" (the PM's) → nothing kept → **cancelled through the app**; run #3 now reads "Picked up again as run #4" | — | — |
| `828210b9` | 5 | 4.2 | resume of run #2 from Engineer, round 1 | spec v2 + approval kept ("Skips 1 min of finished work") → Engineer 2.7 → Reviewer 8.7 → Engineer 2.3 → Reviewer 9.8 → Engineer 2.2 → Reviewer 8.5 → Escalation approved on camera → Ship | ≈34.6 min | [#54](https://github.com/lazyxgenius/trade_mcp/pull/54) |
| `95a2d956` | 6 | 5.1 | Add a DEMA indicator, started from run #1 (spec, decisions, memories, summaries carried; from the PR branch `tvashtr/86bff6c6-…`) | PM 1.3 (this run's spec v1) → PRD gate approved on camera → Engineer 2.3 → Reviewer 7.4 → Engineer 2.2 → Reviewer 10.0 → Engineer 2.1 → Reviewer 7.3 → Escalation approved on camera → Ship | ≈33.2 min | [#55](https://github.com/lazyxgenius/trade_mcp/pull/55) |

The one Ask (3.7, the Reviewer on Grok): "Why did you reject round 1?" → answered in ≈20 s (Grok job
0.2 min): round 1 was `changes_requested` because adding `hma` grows `INDICATORS` from 28 to 29 (the
registry count the tests pin).

### The live smoke (M-desk-4 + M-desk-5)

| check | result | screenshot |
|---|---|---|
| 3.6 / hero (L1, H1): chip, banner, Done summary, Activity's last line name the subscriptions | **PASS** — "on your Claude and Grok subscriptions" everywhere; "Done in 37m 16s · on your Claude and Grok subscriptions"; no "$0.00 +", no "$0.0000" | `video/takes/v2/3.1/shots/done.png` (+ `running.png`, 3.6's `poster.png`) |
| hero (L2): no verdict names `REPORT.md`, `REVIEW_VERDICT.json`, `SPEC.md`, `TVASHTR_REMEMBER.jsonl` | **PASS** — 0 of 3 verdicts; the Grok jobs carried only `REVIEW_VERDICT.json` home | `video/takes/v2/3.1/shots/reviewer-verdict.png` |
| 3.7 (L3): after Done, Changes lists the PR's "Files changed" | **PASS** — 3 of 3: `core/indicators.py` +21, `tests/test_indicators.py` +13 −2, `web/lib/engine-facts.ts` +1 −1 (= `gh api …/pulls/53/files`; the app's `/api/runs/<id>/diff` gave the same 3); the run's workspace is gone | `video/takes/v2/3.7/shots/changes-list.png` — the same run view in headless Chromium (the website surface, same `/diff` answer) with the list scrolled into view; the Desktop take's `changes.png` shows only the first row above the drawer's fold |
| hero (L4): no "repo produced no skills" line | **PASS** — the only banner is the by-design "1 library tool(s) — tools aren't used by Desktop subscription agents yet"; `mcp-builder` was in all 3 Engineer jobs | `video/takes/v2/3.1/shots/running.png` |
| 4.1 (H1, H2): failure line "· on your Claude subscription"; "Next: resume from …" says Tvashtr skips done work | **PASS** — "Failed after 4m 17s · on your Claude subscription"; "Next: resume from Engineer, round 1. Tvashtr skips the work that is done, so it doesn't run again." | `video/takes/v2/4.1/shots/failed.png` |
| 4.2 (H2): "Skips N min of finished work." + "Only the steps that run again use your Claude subscription."; no dollar per step | **PASS** — both lines, word for word; the picker shows plans, no dollars | `video/takes/v2/4.2/shots/confirm.png`, `picker.png` |
| 6.3 (H4, H5, H1): queued set cell; estimate minutes add up the turns; header/lanes/results/set cards name the subscriptions | **NOT RUN** (owed with 6.3) | — |
| 6.1/6.2 (L1, D8): a running test's line names its subscription from its first second | **NOT RUN** (owed with 6.1/6.2; the scenes now shoot `running`/`testing` for it) | — |

### Decisions G1–G9, as filmed

- **G1** real numbers and bends: this section and the scene notes below.
- **G2** real versions: `story.json` says v1 → v2 and V1's v7/v8 sample (`fixtures/history.mjs`) is
  retired; the film team is still at **v1** — 6.2 (which saves v2) and 6.3 (which compares them) are
  owed.
- **G3** `READING_KEY = none`: the hero team has no Query domain step; 1.5 stays SAMPLE; **2.3 is for
  V4: "an example step — cut or caption".**
- **G4** no team-instruction workarounds: the Reviewer's instructions are chapter 2's; `mcp-builder`
  stays on the Engineer.
- **G5** the record take (3.1) opened the spec gate's spec, the Engineer's drawer while it worked,
  the Reviewer's drawer and Changes — 3.2/3.3/3.4/3.6 replayed without an unanswered request.
- **G6** the notifications ask is asked **once per account** (`notify_asked`): 3.1 answered "Not
  now" on camera (22.8 s), so 4.1 never sees it. MAC-3 stays the operator's.
- **G7** AI checks: the stack's settings have no checks key (read as a boolean only, never printed),
  so the server's `ai_status` reports AI checks unavailable. The probe *through the app* (6.1 reads
  its Tests answer first) has **not run** — 6.1 is owed; when it runs and AI checks are unavailable,
  6.1 films those moments from sample data listed in take.json `sample`.
- **G8** 0.1 filmed on PR #53 with the operator's GitHub session; then
  `video/out/github-session.json` was **deleted** (never opened).
- **G9** the Engines "N to fix" badge counts team × surface pairs that can't run (Claude/Grok teams
  on the website, which has no keys for them) — by design, not hidden.

### Bends from the storyboard (V2)

- **Every Desktop run ends at the Escalation gate.** The Grok Reviewer has no shell on the Desktop
  (file tools only), so it can't run `pytest`/`git diff`: round 1 is a real review, rounds 2–3 ask
  for test output it can't get. All three shipped runs (#1, #5, #6) took 3 rounds and were approved
  on camera ("ship the last build as-is"). The storyboard's "round 1 back, round 2 approved" (3.4)
  is round 1 back, rounds 2–3 back, Escalation.
- **The Done line rewrites itself:** the hero read "Done in 37m 16s" at Done and "Done in 37m 36s"
  after the post-ship memory save ("Saved 8 new memories from this run", 20 s later). 3.6 shows the
  first, 3.7 the second.
- **4.2 resumes run #2, not 4.1's run #3.** A camera slip resumed #3 from the PM (run #4,
  cancelled); the product then counts #3 as picked up. Run #2 (the same TRIX task, stopped while its
  Engineer worked) is resumed from its own run view's callout — Needs you lists failed runs, not
  stopped ones — so 4.2 opens on "You stopped this run at Engineer, round 1", not on Home's Needs you.
  The confirm reads "This starts run #5. It picks up where run #2 stopped."
- **5.1's PM writes a new spec** (the run's spec v1) even with "The final spec" carried, and the
  PRD gate asks again (approved on camera); the Now bar reads "From run #1".
- **The Reviewer's own files show in Activity:** "Edited REVIEW_VERDICT.json", "Edited REPORT.md"
  (its sidecars) — the verdicts no longer mention them (L2), the Activity still lists the edits.
- **3.7's Memory beat is on the Engineer's drawer:** the hero's 8 new memories wait for review (5 the
  Engineer's, 3 with no source agent); the Reviewer learned none.
- **Off-camera cuts:** 4.2 waits 2064 s off camera (the resumed run), 5.1 waits 81 s + 1893 s (each a
  jump cut marked "back on camera" with `off_s` in take.json); the Desktop stays open throughout.
- **Layout seen on every run view at 1440×900** (product, not camera): the run card under the
  toolbar overlaps the toolbar row ("Opened PR" clipped), and the Done summary clips "total time" and
  wraps "on your Claude and Grok subscriptions" onto two lines.

### Still owed (V2 → next sitting)

| scene | real work | note |
|---|---|---|
| 6.1 | 4 test replays (1 round test + 3 CSV) on Grok | AI checks from sample data (G7); smoke L1/D8 (`shots/running`) |
| 6.2 | 4 test replays ("Save and run tests") | saves **v2** (G2); smoke L1/D8 (`shots/testing`) |
| 6.3 | 6 runs (one task × 2 versions + "Indicators" 2 tasks × 2 versions) | after 6.2; smoke H4/H5/H1; 2–3 h unattended |
| 2.7 re-take | 1 test replay | the test line's subscription from its first second (L1); builds its own team — film it last |
| ch5/ch6 previews | none | after 6.x |

Budget left for them: 6 runs, 12 test replays, 1 Ask — exactly 6.3's six runs; no retry room.

### What V3 needs (per filmed scene)

- **0.1** (12.7 s, PR #53): fine as is; a fresh GitHub session is needed for any re-take (the file
  was deleted).
- **3.1** (record, 2281 s): V4 uses only its first minute; the hero can stay.
- **3.2–3.6** (replays 15.8 / 22 / 29.8 / 25.6 s): re-takes are free; 3.4 must narrate three
  rounds + Escalation (or V3 decides on a Reviewer that can run tests on the Desktop — a product
  decision, not a camera one).
- **3.7** (52.6 s, 1 Ask): the Changes list sits below the drawer's fold — scroll it into view
  before the shot (`changes-list.png` was taken separately for the smoke).
- **4.1** (282.4 s): keep; the Quiet/Stalled/Failed holds can be trimmed in V4.
- **4.2** (24.7 s on camera): the "Needs you" opening is lost (see bends); a clean re-take needs a
  fresh 4.1 failure (1 run) plus the resume (1 run) in one sitting.
- **5.1** (26.5 s) + **5.1-recent** (7 s): keep.
- Captions for V4: the Escalation approvals, the Done-line rewrite, the run card overlap.

## Scene by scene: how it is filmed, and what doesn't match the story

Modes: LIVE (the real Desktop on tvashtr_film) · SAMPLE (fixtures in the real Desktop) · WEB
(Chromium) · RUN (scripted; spends in V2, rehearsed `--dry` in V1) · REPLAY (a recording of a real
run) · MAC (the operator, Recordly) · MOTION (V5). "Pre-wired" = built off camera through the app's
API before the take, because filming it reliably isn't possible (named per scene).

**0.1 PR on GitHub** — RUN/WEB, `scenes/0.1.mjs`. trade_mcp is **private**: the PR page needs the
operator's GitHub session (`node video/camera/github-login.mjs` once; saved to the ignored
`video/out/github-session.json`). Until then the take stops with "BLOCKED". The V1 proof PR is
https://github.com/lazyxgenius/trade_mcp/pull/51. **V2:** filmed on the hero PR #53 (12.7 s), then
`video/out/github-session.json` was deleted (G8) — a re-take needs a new session.
**0.2 title** — MOTION (V5).
**1.1 Sign in with GitHub; install the App** — MAC (below): the Desktop's sign-in opens the system
browser, which the camera can't film.
**1.2 Engines** — LIVE. Overview → Subscriptions (Claude and Grok **Connected**) → API keys (the one
key, DeepSeek, shown `•••• <last4>`). The Terminal sign-in is MAC-2. "A backup model" is per agent
(Advanced → Backup model), filmed in 2.5 on the Engineer. Seen once: the Desktop's launch probe
read Grok as "Needs login" while `grok models` answered in 1 s — the pre-roll now uses the app's own
Refresh (never a Terminal sign-in) and stops NEEDS_HUMAN if still not Connected. The Engines nav's
"N to fix" badge (team × surface pairs that can't run: Claude/Grok teams on the website) is by
design (G9) and stays on screen.
**1.3 Toolkit** — LIVE. Web fetch (Browse → Add), a secret by name `EXCHANGE_API_KEY` (a placeholder
value, deleted after the take), and `mcp-builder` imported from `anthropics/skills` (the only public
skills repo checked; trade_mcp is an MCP server). The dialog finds 19 skills; the take keeps only
mcp-builder. **Product finding:** in a run, that library skill fails to load — the run view's banner
reads "repo produced no skills (… filter='mcp-builder')" (proof run 610661d5). **Fixed by M-desk-5
L4:** in V2's hero run `mcp-builder` loaded into all three Engineer jobs and no such line appeared.
**1.4 Connectors: Linear** — SAMPLE (`fixtures/connectors.mjs`). No Linear account: the browser half
never happens (window.open / shell.openExternal stubbed in the take), the connection turns
connected on the 3rd poll; the tool list is a guess at Linear's MCP tools (not on screen).
**1.5 Domains** — SAMPLE (`fixtures/domains.mjs`, three tiny real PDFs). The sample adds a Hugging
Face reading key the film account doesn't have; the answer text, latency and passages are sample
content; the answer model shows as "deepseek deepseek-chat" (the server's label). Operator item: an
embeddings key (HF or OpenAI) to film it live.
**2.1 New team from a template** — LIVE. New team → "PM → Engineer ⇄ Reviewer" → name → Create team.
**2.2 PM's instructions; Edits allowed off** — LIVE. One line typed into the PM's instructions;
"Edits allowed off" is the PM's **locked** Read-only (the entry agent can't edit files, so it can't
be switched on camera); Save.
**2.3 A Query domain feeding the PM** — LIVE, via Domains › Exchange API docs › Use in teams › "Add
as a step in a team". **Mismatch:** a Query domain can't come *before* the PM (the first node must
be a thinker: `root_not_thinker`), so it sits PM → Query domain → PRD gate and feeds the spec the
Engineer and Reviewer read. The domain has no files and no embeddings key on the film account:
**a run through this step would fail**. **V2 (G3, `READING_KEY = none`):** the hero team has no
domain step; 2.3 is marked for V4 — "an example step — cut or caption".
**2.4 Spec gate; Engineer tools and skills; Reviewer loop; guardrail; Ship and Stop** — LIVE. The
gate card reads **"PRD approval"**, not "Spec approval". The guardrail is **two gates** (a gate has
one check): their cards read the raw kinds `secret_leak_scan` and `diff_touches_forbidden_paths`,
and the path is the glob `servers/**`. Pre-wired: the two gates (plain approval gates, wired
Reviewer → gate → gate → Ship / Stop); their checks are set on camera. The Engineer's Skills & tools
tab notes that tools aren't used on a Claude-subscription run (skills are added to its
instructions). "Up to 3 rounds" is visible only on the group frame (2.7); the loop arc reads
"changes requested".
**2.5 A model per agent** — LIVE. Engineer and PM → claude-sonnet-5; the Engineer's backup model
DeepSeek (the Desktop notes Claude runs use the subscription and don't switch to it); Reviewer →
claude-sonnet-5 → the same-model hint ("Reviewer and Engineer both run …") → grok-4.7 (V1–V2b first
sitting); since K8 → a custom model ID, `anthropic/claude-opus-5-5` (the hint clears).
**2.6 Remember; budget; failure path → Fixer** — LIVE. The label is **"Remember what it learns"**
(not "I learn"). There is **no budget control on the canvas**: the $5.00 is the composer's "Budget
for this run" (3.1's Run options; the server default). Pre-wired: an unconfigured new agent between
the Engineer and the Reviewer (a downstream "+" lands it on top of the Reviewer, and the Fixer → Reviewer
edge needs a drag); on camera it is renamed Fixer, given the Engineer template and DeepSeek, and its
path becomes "If it fails or times out". **Story mismatch:** the Fixer never runs for a stalled
Desktop job — the stall sweep fails such a run instead of taking the failure path.
**2.7 Tidy; group the loop; v1; Test this agent** — LIVE. Tidy, select Engineer + Reviewer, Group
"Review loop" (frame: "Engineer ⇄ Reviewer · up to 3 rounds"), the header "v1 · saved just now"
(layout changes aren't versions), then More actions → Test this agent → Tests → Run all 1 — a real
replay of the Reviewer on its Grok subscription (V1's one test; since K8 on its Claude subscription). Before any run the Reviewer has no
rounds, so its test comes from a CSV (setup). Order changed so a `--dry` rehearsal covers all but
the spend.
**3.1 Home composer** — RUN, record "hero" (V2). The task, trade_mcp, Run options: branch main,
Scope `core`, Budget $5.00 → Launch, then the whole hero run is recorded (3.2–3.6 are replays of it).
On a fresh account Desktop Home shows the ready card instead of the composer; the flow handles it.
**3.2 Live run view** — REPLAY of "hero" from the launch (V2); V1: rehearsed on the proof
recording, and the F5 proof is its "proof" (record) and "replay" parts: run 610661d5 recorded live
(1869 s, 74 pair moments), replayed with the Desktop runner signed out (every claim 401). Pairs
(`video/out/v1/pairs-3.2-replay.png`): **53/74 identical; 71/74 identical apart from relative ages
("1 s ago" vs "3 s ago"); 3/74 (pairs 4, 19, 43) one Activity poll apart.** The live page and the
replay poll on their own timers, so a replay matches the live take to the poll, not to the second.
**3.3 Gate → Needs you → fix one line → approve** — REPLAY from the gate (V2); rehearsed on proof.
**3.4 Engineer on Claude; Reviewer on Grok; round 1 back, round 2 approved** — REPLAY (V2). "Its own
copy of the repo" has no visible copy (the raw log names "Running on this computer with your own
Claude Code"). Rounds are the real run's: the proof run needed 3 rounds then the escalation gate,
and so did V2's hero (the Grok Reviewer has no shell: rounds 2–3 ask for test output) — 29.8 s replay.
**3.5 Retrying → backup switch** — SAMPLE (`fixtures/retrying.mjs`). **Not reachable live:** a
Desktop subscription job never emits retry/backup events (only the API-key gateway path does), and
the film account has no second provider for a backup. V4 must caption it as an illustration or drop it.
**3.6 Guardrail passes; Ship; PR; Done** — REPLAY (V2). A passing guardrail writes no Activity line
(its card turns Approved).
**3.7 Changes; Ask; cost per round; Memory** — LIVE on the newest finished run (V2: hero; V1
rehearsed on the proof run, stops before the Ask's Send). Memory review mode is switched on in setup
so new memories wait for Keep/Discard. **V2:** 52.6 s on the hero run, one Ask ("Why did you reject
round 1?"); Keep/Discard on the **Engineer's** drawer (the Reviewer learned nothing); the Changes list
sits below the drawer's fold (`shots/changes-list.png`, taken in headless Chromium, shows all three).
**4.1 Quiet → Stalled → Failed** — RUN (V2): stack with `QUIET=20 STALLED=60 FAIL=180`; the
Engineer's CLI is paused through the Desktop's own process tree (SIGSTOP). The Mac notification is
MAC-3. **V2:** 282.4 s, run #3 — Quiet ≈92 s, Stalled ≈131 s, Failed ≈274 s into the take ("Failed
after 4m 17s · on your Claude subscription"). The camera finds the CLI by `--output-format` once the
runner claims the job (Claude reads its prompt on stdin, so its command line has no `runner-jobs/`
path — take 1 failed on that); the notifications ask doesn't come (3.1 answered it).
**4.2 Resume** — RUN (V2). **V2:** 24.7 s on camera (2064 s off camera), run #5 resumed from run
#2 at "Engineer, round 1" via the stopped run's own callout (see "Bends"); PR #54. V1 has no failed run, so its rehearsal only opens
Home's Needs you and stops there. The confirm's sections are "Kept", "Runs again" and a
"Skips N min of finished work" line — there is no "saved" heading ("Safe:" is in the failed callout).
**5.1 Start the next run from this** — RUN (V2) on the hero run: "Add a DEMA indicator", carry
spec/decisions/memories/summaries, Start from the PR branch. Recent tasks exist only in Home's
composer: part `5.1-recent`. **V2:** 26.5 s on camera (81 s + 1893 s off camera), run #6 from the
hero's branch → PR #55; the PM still writes the run's own spec and the PRD gate asks again; 5.1-recent
7 s.
**6.1 Tests** — RUN. Make this a test (round 1, an AI check) → tests from a CSV (the column mapped
on camera) → Run all (a spend: V1's one test went to 2.7). "Check the AI check" opens only from a
failed AI-check result, after Run all.
**6.2 History** — V1: SAMPLE (`fixtures/history.mjs`, v7/v8). **V2 (G2):** rewritten LIVE on the film
team — edit the Reviewer, "N changes since v1", Save as **v2** with "Save and run the Reviewer's 4
tests", History, What changed in v2; the v7/v8 sample is retired. **Not filmed yet (owed).**
**6.3 Compare; task set; Restore** — RUN (V2; compares and task sets spend). The task set
"Indicators" with hidden checks is saved on camera; the compare stops before "Start compare". **V2:**
compares v1 and v2 (after 6.2) on "Add a TEMA indicator", then the set on both versions, each wait
off camera; Restore shows only when the winning version isn't current. **Not filmed yet (owed);
rehearsed in V1 only.**
**7.1 My agents** — LIVE. Save the Reviewer as "Strict Reviewer" → another team ("Bugfix squad") →
Templates → Strict Reviewer → Undo → again → "Based on Strict Reviewer v1".
**7.2 Team file; Import on a second account** — LIVE with `HOSTED=0 video/stack/up` (the email
sign-up exists only on a self-hosted backend; hosted mode offers only GitHub). The panel's lock line
reads **"No secrets or sign-ins inside"**. Account B finishes this Mac's first-run setup the moment
it is created (a camera hook on the sign-up response, not product code); each re-take makes a new
`lazyx.teammate+<n>@tvashtr.local`. The Desktop saves the team file through Electron's own download
(a native Save panel): the camera sets the save path in the main process first. On the imported
team's canvas the "things to fix" card covers the Product manager's card.
**8.1 Home** — SAMPLE (`fixtures/home.mjs`) + part `8.1-web` (WEB, the same Home on the website).
The local-folder run ("Branch tvashtr/…") is sample data; **product layout bug:** a long branch name
squeezes that Recent runs row (the idea disappears). The composer placeholder still says "Add an RSI
indicator with tests" (product copy).
**8.2 end card** — MOTION (V5).

### Across the film

- **Money on subscriptions:** the live proof run's toolbar read "$0.00 + your Claude and Grok
  subscriptions" (the mixed wording) with no API-key work in it. **V2 (M-desk-5 L1):** "on your
  Claude and Grok subscriptions" from launch to Done.
- **Escalation:** in the proof run the Grok Reviewer asked three rounds running for the agents'
  scratch files (`REPORT.md`, `TVASHTR_REMEMBER…`) to be removed; the run parked at the Escalation
  gate, which V1 approved through the app's API ("ship the last build as-is") so the recording could
  end — PR #51 carries those files. **V2 (M-desk-5 L2):** no verdict names those files any more;
  the runs still escalate, now because the Grok Reviewer can't run tests (no shell).
- **Local paths on screen:** an Activity line shows the Desktop job's temp path
  (`…/runner-jobs/<id>/prompt.txt`).
- **2.4's first take configured the wrong gate** ("approval" matched "PRD approval"); gates are found
  by node id now, and 2.4 was re-filmed.
- **Team names:** each scene rebuilds "Indicator sprint team"; a same-named team that already has
  runs is renamed "… (earlier)" (deleting would delete its runs). For V2's clean account,
  `video/stack/reset` first.


## Before V2 (measured in V1)

V1's measurements and plan, kept as written; what V2 did with each item is in "V2" above (1 → G3,
2 → L4, 3 → L2, 4 → G2, 5 → G8, 7 → G5, 8 → done).

**What a real run costs on the subscriptions** — the F5 proof run (one README line, the full film
team without the domain step): PM spec 0.6 min · Engineer round 1 0.2 min · Grok Reviewer 6.5 min ·
Engineer round 2 2.8 min · Reviewer 4.4 min · Engineer round 3 3.0 min · Reviewer 7.2 min · (the
Escalation gate, then Ship) — **30m 42s** to PR #51. The Grok Reviewer is the slow seat (4–7 min a
round); every one of its three rejections was about the agents' scratch files, not the change.

**Real work per scene in V2** (V1 measured what it could; the rest is estimated from the proof run):

| scene | real work | expected time |
|---|---|---|
| 3.1 (records the hero run; 3.2–3.6 are replays of it) | 1 run: "Add a Hull moving average indicator" | 30–45 min (2–3 rounds) |
| 3.7 | 1 Ask (the Reviewer, Grok) | 1–3 min |
| 0.1 | none (the hero PR's page; operator GitHub session) | — |
| 4.1 | 1 run: "Add a TRIX indicator", Engineer paused (stack with QUIET=20 STALLED=60 FAIL=180) | ~6 min to Failed |
| 4.2 | 1 run: the resume of 4.1 | 20–35 min |
| 5.1 | 1 run: "Add a DEMA indicator" from the hero run | 30–45 min |
| 6.1 | the Reviewer's tests (a round test + 3 CSV tests) on Grok | ~8 min |
| 6.2 save | "Save and run tests" (4 tests) on Grok | ~8 min |
| 6.3 | Compare v7/v8 on one task (2 runs) + the "Indicators" set (2 tasks × 2 versions = 4 runs), lanes taking turns on the subscriptions | 2–3 h |
| 2.7 (re-take only) | 1 test replay (V1 used it: passed) | ~2 min |

**Suggested sittings:** (1) `video/stack/reset`, then 3.1 → 3.2/3.3/3.4/3.6 replays → 3.7 → 0.1
(≈1 h 15 min, one run); (2) stack with the stall knobs: 4.1 → 4.2 (+ MAC-3) (≈45 min, two runs);
(3) 5.1 → 6.1 → 6.2 save (≈1 h, one run + tests); (4) 6.3 unattended (2–3 h, six runs — check the
plans' usage caps first); MAC-1/MAC-2 any time.

**V2 must fix or decide first:**
1. **The Query domain step would fail the hero run** (no embeddings key, no files in "Exchange API
   docs"): give the account an OpenAI or Hugging Face key plus real exchange-API PDFs (then 1.5 can
   be live too), or run the hero on the team without the domain step (as the proof did).
2. **The mcp-builder library skill doesn't load at run time** (the run view's banner): take it off
   the Engineer before the hero run, or wait for a product fix.
3. **The Reviewer rejects over the agents' scratch files** (`REPORT.md`, `TVASHTR_REMEMBER*`): add
   one line to the Reviewer's instructions (a team edit, not product) — or expect the Escalation
   gate again.
4. **Version numbering:** chapter 2 ends at v1, 6.2 says "2 changes since v7" — save versions
   through the story or relabel 6.2.
5. **0.1:** the operator runs `node video/camera/github-login.mjs` once (trade_mcp is private).
6. **7.2** needs `HOSTED=0 video/stack/up` (restart the backend), then back to hosted.
7. **The hero record take paces the replays:** a replay holds at each gate the page approved until
   the camera clicks it, but any drawer or tab a later scene opens must also have been opened in the
   record take (3.4's Engineer drawer wasn't in the proof recording) — add those views to 3.1's flow
   before V2 records.
8. `video/stack/reset` before V2, so the account holds only the film's own teams and runs.

## Operator items

### MAC shots (record with Recordly; Tvashtr frontmost; `caffeinate -dimsu` running)

Each script names the app, the visible label to click and what should show. Record at 1440×900 if
Recordly lets you pick a window size; V4 cuts them in beside the camera's takes.

**MAC-1 — 1.1 Sign in with GitHub; install the GitHub App on trade_mcp** (the GitHub side; the
Desktop opens the system browser, which the camera can't film)

1. Quit every Tvashtr Desktop. Open Tvashtr Desktop signed out (the Welcome page): heading
   **"Welcome to Tvashtr"**.
2. Start Recordly on the whole screen (the Desktop and the browser will both show).
3. Tvashtr: click **"Sign in with GitHub"**. The Desktop shows **"Finish signing in in your
   browser"** (buttons "Open the browser again", "Copy the sign-in link", "Cancel").
4. Browser (opened by itself): GitHub's **"Authorize Tvashtr"** page (the app is `tvashtr-dev` on
   the local stack) → click the green **"Authorize …"** button. If GitHub asks which account, pick
   **lazyxgenius**.
5. Browser: the Tvashtr page **"Open Tvashtr Desktop"** → click it; macOS asks **"Open Tvashtr?"**
   → **"Open Link"**. The Desktop moves on by itself (signed in).
6. Install the App on trade_mcp: Tvashtr → Home → the composer's repo button (shows
   "Pick a folder") → **"Install the Tvashtr GitHub App →"** (or, when it is already installed,
   **"Add repositories on GitHub →"**).
7. Browser: github.com **"Install Tvashtr"** (or "Configure") → **"Only select repositories"** →
   pick **lazyxgenius/trade_mcp** → **"Install"** (or "Save").
8. Back in Tvashtr, open the repo picker again: **lazyxgenius/trade_mcp · main** is listed under
   "GitHub App repos". Stop recording.

Note: the App is already installed on trade_mcp for this account, so GitHub shows "Configure" and
"Save" rather than "Install". On the local stack the GitHub OAuth callback is
`http://localhost:8000/api/auth/github/callback` (the dev App); for the website flavour use the
production app at https://tvashtr.fly.dev with the installed Tvashtr Desktop.

**MAC-2 — 1.2 Claude and Grok connected with your own sign-in (opens Terminal)**

The Desktop opens Terminal only when the CLI is signed out (an already signed-in CLI just shows
"Connected"). Recording this means signing the CLI out first and back in on camera — your call.

1. In a plain Terminal (not inside the Claude app): `claude auth logout` (Grok: `grok logout`).
2. Start Recordly on the whole screen.
3. Tvashtr → **Engines** → **Subscriptions** → the **Claude** card shows **"Needs sign-in"** →
   click **"Connect"**.
4. Terminal opens by itself with the line **"Signing in to Claude Code — follow the prompts
   below."** The Tvashtr card shows **"Waiting for sign-in"** and the callout "Finish signing in to
   Claude in the Terminal window that just opened…".
5. Terminal: follow the prompts (choose your **Claude subscription**, not an API key); the browser
   opens claude.ai → **"Authorize"**. Never film the code/token Terminal may print — cover or crop
   that part, or stop and restart recording around it.
6. Terminal prints **"When you're done, switch back to Tvashtr — it re-checks automatically."**
   Switch back: the card turns **"Connected" · "Claude Max · via Claude Code"** (Grok: "Grok
   subscription"). Stop recording.

**MAC-3 — 4.1 the Mac notification ("Indicator sprint team stalled")**

1. In the run view of a 4.1-style run, turn notifications on: the ask comes once per account and
   V2's 3.1 answered it "Not now", so use the run toolbar's bell (Notifications) → **"Turn on"**
   (keep "When a run stalls or fails" ticked). macOS may ask **"“Electron” Would Like to Send You
   Notifications"** (the dev Desktop is "Electron"; the installed app is "Tvashtr") → **"Allow"**.
   That macOS permission is yours to grant (V1 never clicks it).
2. Start Recordly on the top-right of the screen before the Engineer goes Stalled.
3. The banner shows **"Indicator sprint team stalled"** — "No update for N minutes. Nothing
   shipped; finished steps are saved." (later "Indicator sprint team failed" is suppressed when
   the stall was already announced). Click it: Tvashtr opens the run. Stop recording.

### Other operator items

- **A throwaway API key** for the "add a key" moment of 1.2 (V1 shows the DeepSeek key masked only;
  no real key is typed on camera).
- **Linear** (1.4) and **an embeddings key** (1.5) if those scenes should be filmed live instead of
  from sample data.
- **The Claude CLI sign-in**: check `claude auth status` from a plain Terminal before V2's runs
  (inside the Claude app it reads the app's own sign-in).
