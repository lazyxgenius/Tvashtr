# Brief — M-desk-5 (what V1's live footage found) + Video V2 (the real runs), one session

Architect: Tvashtr Sidechat-22, 2026-10-11. Path: `/Users/adimac/Desktop/Tvashtr/prompts/m-desk-5-v2.md`.
`prompts/` is untracked: never commit it. Where this brief and `prompts/CLI-RULES.md` differ, this
brief wins (CLI-RULES' numbers and milestone list are out of date). Read `prompts/video-v1.md` and
`video/SCENES.md` too: V1's brief for the film's rules and storyboard, SCENES.md for every scene's
script, status and the "Before V2" list. This brief replaces V1's budget and its F10 table.

## The shape of this session

Two parts, in order, on two branches, in the main checkout (worktree off):

- **Part A — M-desk-5, a product fix** on `feat/m-desk-5` from `main` (`1bf725be`). Four problems
  V1's real run showed (L1–L4). Product code may change here, inside the invariants below.
- **Part B — Video V2, the real runs** on `video/v2-runs`, branched from **`feat/m-desk-5`'s tip**
  (so the stack you film runs the fixes). Only `video/**` and video ignore rules in `.gitignore`
  change in Part B — no product code.

Why this order: a replay plays back the server's exact words. A hero run recorded before the fixes
would carry "$0.00 + your … subscriptions", the skill-failure line and an empty Changes tab into
every re-take for good. The operator merges both branches after the architect's audit
(`feat/m-desk-5` first, then `video/v2-runs`); you never merge.

## Where things are (checked by the architect on disk, 2026-10-11)

- `main` = **`1bf725be`** = the six Sidechat-21 merges (`02488987`) + M-desk-4 (`268ed099`) + V1
  (`video/**`). `origin/main` is still `e30b8bd9`. Push guard ON. Alembic head `0053`; the freeze
  hook covers `0001`–`0053`. `backend/tvashtr/control_plane/team_run.py` blob `94eda1bb9fbb`;
  `desktop/electron/runner/runner.cjs` blob `15e977ad71f2`; DBOS application version locally
  `3011d7ac…`, production's fly-mode set `c7320dd5…` (both computed without a database, as the
  DBOS-fix and M-desk-4 sessions did).
- `video/v1-pairs-wip` (`9d1b6414`) is a parked, unproven V1 experiment: ignore it, don't merge it.
- V1's evidence lives in the main checkout's ignored folders: the proof recording
  `video/recordings/proof-3.2/recording.json.gz` (run `610661d5-85c7-459f-a433-ec827932e225`, PR
  trade_mcp#51), the takes in `video/takes/v1/`, `video/out/v1/` (pairs, contact sheet).
- The film account is `lazyx@tvashtr.local` on `tvashtr_film` (`video/stack/up|down|reset`). Its
  only API key is DeepSeek. No embeddings key works on this Mac today (V0's key probe: deepseek,
  groq, nvidia_nim held; none offers embeddings; the operator's OpenAI key is invalid).

---

# Part A — M-desk-5

## The four findings (evidence from V1's run 610661d5)

**L1 — Desktop money wording fails live (M-desk-4's H1).** On a run done only on the Claude and Grok
subscriptions, the Activity's last line read "Done in 30m 26s · $0.00 + your Claude and Grok
subscriptions", the Done summary "$0.00 + your Claude and Grok subscriptions", the toolbar chip the
same, and the run banner "cost $0.0000" (at some polls with no words at all). The recording's
`GET /api/runs/610661d5…?desktop_target=1` answers `ran_on: {"subscriptions": ["claude","grok"],
"all": false}` with `cost_total_usd: 0.0`. Cause (traced by the architect, confirm it):
`DesktopRunnerAdapter._completed` returns the CLI's token counts with `cost_usd=0.0`;
`team_run` meters any step whose `total_tokens` is non-zero, so every Desktop step writes a $0
`CostRecord` (a usage record); `desktop_jobs.ran_on` counts **any** cost row as API-key work →
`all: false` → the mixed wording. M-desk-4's fixtures assumed a Desktop step writes no cost row.
Also seen (2.7 frames): a Desktop test's line reads "On v1 · $0.00 so far" in its first second,
before its Desktop job exists, then "on your Grok subscription".

**L2 — The Reviewer reviews Tvashtr's own files.** In all three rounds the Grok Reviewer asked for a
fix because "REPORT.md and TVASHTR_REMEMBER.jsonl are extra files the idea and PRD forbid"; the run
parked at the Escalation gate after 30 minutes on a one-line change. The shipped branch
(`tvashtr/610661d5…`, PR #51) changes only `README.md` (checked by the architect), so shipping
already excludes them — the leak is in what the reviewing agent sees. The Engineer had "Remember
what it learns" on. Tvashtr's own working files are `REPORT.md`, `REVIEW_VERDICT.json`, `SPEC.md`,
`TVASHTR_REMEMBER.jsonl` (the `_OWN` sets in `resume.py` / `agent_tests.py`;
`desktop_runner_adapter.SIDECARS` force-adds three of them to a Desktop job's patch so they travel
home).

**L3 — The Changes tab is empty after a GitHub run finishes.** The recording's `GET
/api/runs/610661d5…/diff` answered `{"files": [], "total": 0}` 11 s after Done. A run on a GitHub
repo diffs its clone under `backend/.tvashtr_clones/`, which M-clonegc removes at run end, and
`get_run_diff` (routers.py) reads only that clone for a repo run (the greenfield snapshot in
`run_artifacts` doesn't cover it). This hits the website too.

**L4 — A skill imported from GitHub doesn't load in a run.** Scene 1.3 added `mcp-builder` from
`anthropics/skills` (the dialog listed 19 skills); the run's banner said "library — repo produced
no skills (url='https://github.com/anthropics/skills', ref='dbd4588f9e1033efb41dad4bef2f7947c8993d44',
filter='mcp-builder')". `node_skills._resolve_repo` calls the SDK's `load_public_skills`, which
returns `[]` on any failure, so the real cause is hidden.

## Rulings (final; each with what the user sees)

- **L1 — Key spend is work that didn't run on a subscription.** In `desktop_jobs.ran_on` (and every
  helper that decides "mixed": `ran_union`, `resume._ran_on`, compare, activity), a cost row counts
  as API-key work only when its work did not run as one of the run's Desktop jobs (a row whose
  `invocation_id` is a Desktop job's invocation is that subscription's usage record). Run-level
  rows from keyed work (a Query domain step, embeddings, a DeepSeek Fixer) still count. Keep the
  $0 usage rows — they are the ledger's token counts; don't change how they're written. The run
  banner (D4) shows the same words as the toolbar chip at every poll of a live run. Before a
  Desktop test, compare or set has its first job, its line names the subscription it is routed to
  (M-desk-2's routes), never "$0.00 so far".
  *User sees:* a subscription-only run reads "on your Claude and Grok subscriptions" in the Done
  line, Done summary, banner and toolbar from launch to Done; a run where the DeepSeek Fixer also
  worked reads "$0.03 + your Claude subscription"; the website is unchanged.
- **L2 — An agent never reviews Tvashtr's own working files.** Find where those four files enter
  what a reviewing agent sees as "the change" (the Desktop job's checkout, the patch it starts from,
  its git status, or the hosted workspace) and keep them out of it, on the Desktop and — if the
  same happens there — on the website. They still travel home for harvesting; shipping stays as is.
  Prefer a server-side fix (`desktop_jobs.py`, `desktop_runner_adapter.py`, the context compiler);
  change `desktop/` only if the cause is proven to be there (then desktop tests, and say the ship
  needs a `desktop-v*` tag — it gets one anyway).
  *User sees:* the Reviewer's notes are about the user's code only; no rounds lost to Tvashtr's files.
- **L3 — A finished GitHub run's Changes tab reads the branch from GitHub.** When the run's clone is
  gone, `GET /api/runs/{id}/diff` for a run on a GitHub repo asks GitHub for the comparison of the
  run's base and ship branch through the GitHub App (`control_plane/github_app.py`) — the same files
  GitHub's "Files changed" shows — in the same response shape. While the clone exists, local-folder
  runs and greenfield runs: today's path. If GitHub can't answer (branch deleted, app removed,
  offline), the response says so and the tab shows **"Couldn't load the changes from GitHub."** with
  **"Open the pull request →"** when the run has a PR — in the tab's existing empty-state style.
  Owner-scoped as today. Website and Desktop.
  *User sees:* after a run ships, the Changes tab still lists the PR's files with their diffs.
- **L4 — A skill the import dialog listed loads in the run, at the pinned commit.** Find why the
  run-time load returns nothing (the SDK's cache, a commit SHA used where it expects a branch, the
  repo layout, the filter) and fix it in our code. Don't edit the installed SDK; an SDK version
  change only with the operator's OK (stop and ask).
  *User sees:* no "repo produced no skills" line; the Engineer's run carries mcp-builder. (The tools
  line — "tools aren't used by Desktop subscription agents yet" — is by design and stays.)
- **Claude Design first (L3's new state):** before code, draw the Changes tab's "couldn't load from
  GitHub" state as a board beside the run view's existing Changes board, on the canvas where that
  screen was designed (find it with your Artifact tool; never the main canvas), website and Desktop.
  Publish, then build from it. L1's words are already on M-desk-4's boards — the app must now match
  them with real data.

## Invariants (prove each as evidence)

1. `team_run.py` blob still `94eda1bb9fbb`; no `@DBOS.workflow` / `@DBOS.step` function changed; the
   DBOS application version unchanged (local `3011d7ac…`, fly-mode `c7320dd5…`), so production's
   queued work survives the next deploy.
2. No migration (`backend/alembic` diff empty; head `0053`).
3. `runner.cjs` blob `15e977ad71f2` unless L2 is proven to live there.
4. The one-job-per-provider rule untouched (`claim_next` unchanged).
5. No assertion or `expect` line removed (grep the diff against `1bf725be`).
6. Every website string byte-identical except L3's new state: the design-parity harness's website
   renders at 0 px diff against `1bf725be`.
7. Only product paths change in Part A — nothing under `video/`.

## Proof

- **Reproduce-first, each shown failing on `1bf725be`, then passing**, with real Postgres rows
  shaped exactly as `team_run` and the Desktop adapter write them (not hand-made fixtures):
  L1 (a Desktop job + its $0 usage row → `all: true`; plus a keyed row from non-Desktop work →
  `all: false`; the Done line; the run read's `ran_on`; a test before its first job); L2 (what the
  reviewing agent is given contains none of the four files); L3 (clone gone → the GitHub
  comparison, mocked at the HTTP boundary; GitHub failing → the "couldn't load" answer); L4 (a
  local git repo shaped like `anthropics/skills`, pinned by full SHA, filtered to one skill → it
  loads; then the real `anthropics/skills` at `dbd4588f…` once).
- **Gates:** `make test` on its own database (never `tvashtr_film`, never next to a running stack),
  vitest, the frontend build, `make lint` with no new errors (38 pre-existing in 12 untouched files),
  the owner sweep, desktop tests if `desktop/` changed, the design-parity harness (M-desk-4's Desktop
  boards for D1–D5 still match; L3's new board matches; website 0 px).
- **One live proof — the lesson of M-desk-4.** On a throwaway database `tvashtr_desk5` (create,
  migrate, seed; drop it afterwards), the real dev Desktop, a team PM (Claude) → Engineer (Claude,
  mcp-builder from `anthropics/skills`, Remember on) ⇄ Reviewer (Grok) → Ship, one tiny real run on
  trade_mcp: "Add one line to README.md: Indicators live in core/indicators.py. Change nothing
  else." Screenshots (opened by you, in chat): the toolbar + banner while running, the Done line,
  the Done summary, the Reviewer's verdict text, the Changes tab after Done (README.md listed), the
  run view with no skill-failure line. At most 2 real runs for Part A.
- Then `READY_TO_MERGE feat/m-desk-5 <sha>` and go straight on to Part B (don't wait).

If one of L2–L4 can't be fixed inside the invariants after three distinct attempts (each with its
output in chat), record it with the evidence, keep the others, and go on to Part B, which films with
that limitation and lists it. L1 must pass before Part B starts: if it can't, stop NEEDS_HUMAN.

---

# Part B — Video V2, the real runs

V1's brief (`prompts/video-v1.md`) still governs the film: honesty rules, the camera (record,
replay, sample mode, cursor, pre-roll, takes), the storyboard. V1's `video/SCENES.md` has every
scene's script and the "Before V2" list; this part settles that list.

## Decisions (final)

- **G1 — Real numbers, real outcomes.** Film what the runs really do: rounds, times, version numbers,
  PR numbers. Where reality bends the storyboard (round 1 approved, so no rejection in 3.4; the
  version numbers), film reality and record the bend in `SCENES.md` for V3's script. Never steer an
  agent's verdict to fit the script. A gate on camera is clicked on camera; off-camera setup may use
  the app's API.
- **G2 — Versions are real.** Chapter 2's team ends at v1. 6.2 edits the Reviewer and saves the next
  real version ("Save as v2" if nothing else was saved); 6.3 compares those two. Update
  `story.json`'s versions to what the app really shows. 6.2 becomes LIVE (its history is real now);
  retire the v7/v8 sample in `fixtures/history.mjs` or rewrite it to the real numbers.
- **G3 — The Query domain step.** `READING_KEY = none` (the operator may change this one word before
  launch to the name of a `.env` variable holding a working OpenAI, OpenRouter or Hugging Face key).
  With `none`: the hero team (and every later team) has no Query domain step; 1.5 stays SAMPLE; mark
  2.3 in `SCENES.md` for V4 ("an example step — cut or caption"). With a variable named: let
  `video/stack/up` seed that one key into the film account, prove it through the app (one embedding),
  upload `video/fixtures/files/domains-exchange-api-*.pdf` to "Exchange API docs", film 1.5 LIVE
  (re-take) and keep the step in the hero team.
- **G4 — No team-instruction workarounds.** L2 and L4 are fixed in Part A: keep mcp-builder on the
  Engineer and the Reviewer's instructions as chapter 2 set them.
- **G5 — The record take opens every view its replays need** (V1's "Before V2" item 7): the hero
  record take (3.1) opens the spec gate's spec, the Engineer's drawer (3.4), the Reviewer's drawer
  and Changes, so 3.2–3.6 replays can show them.
- **G6 — Notifications:** 4.1's take answers the notifications ask "Not now". MAC-3 (the macOS
  banner) stays the operator's shot; never click a macOS permission.
- **G7 — AI checks (6.1) need a server checks model.** Probe it through the app (one AI check run);
  if it doesn't answer, film the AI-check moments from sample data inside the take, label them
  `sample` in `take.json`, and list them in `SCENES.md`.
- **G8 — 0.1 uses the operator's GitHub session** saved by `node video/camera/github-login.mjs`
  (`video/out/github-session.json`). If the file is missing, 0.1 stays blocked (no stand-in). Film
  0.1 on the hero run's PR, then **delete `video/out/github-session.json`** (it holds the operator's
  GitHub cookies) and say so.
- **G9 — The Engines "N to fix" badge** counts team × surface pairs that can't run (Claude/Grok teams
  can't run on the website without keys). It is by design: don't hide it; note it in `SCENES.md`.

## The sittings (in order; each ends with a checkpoint commit)

1. **Chapter 3 + the live smoke.** `video/stack/reset`; check Engines shows Claude and Grok
   "Connected". 3.1 records the hero run ("Add a Hull moving average indicator", trade_mcp, `main`,
   scope `core/`, budget $5.00) live from Launch to Done; 3.2, 3.3, 3.4, 3.6 are replays of that
   recording; 3.7 LIVE on the hero run (Changes; one Ask of the Reviewer — about round 1's
   rejection if there was one, else what it checked; cost per round; Memory: keep one, discard
   one); 0.1 on the hero PR (G8). At most 1 re-run of the hero if the first run fails for a reason
   that isn't the product's (a usage cap, a dropped connection).
2. **Chapter 4.** Stack with `QUIET=20 STALLED=60 FAIL=180`; 4.1 "Add a TRIX indicator" with the
   Engineer's CLI paused through the Electron PID tree you launched → Quiet → Stalled → Failed;
   4.2 Resume from here on that run → it ships. Stack back to normal timers.
3. **Chapters 5–6 (tests and history).** 5.1 "Add a DEMA indicator" started from the hero run (carry
   spec, decisions, memories, summaries; start from the hero PR's branch) + `5.1-recent`; 6.1 (make
   a test from a Reviewer round, tests from `fixtures/files/reviewer-tests.csv`, Run all, the AI
   check per G7); 6.2 LIVE (edit the Reviewer, "N changes since v1", Save as v2, save and run the
   tests, results in History, What changed).
4. **6.3 (long, unattended).** Compare v1 and v2 on one task; the task set "Indicators" ("Add a
   Vortex indicator", "Add a Chande momentum oscillator") with hidden checks, both versions; lanes
   take turns on the subscriptions; Restore. Expect 2–3 hours.
5. **Re-takes and review files.** Re-take any V1 scene whose screen Part A changed (at least 2.7's
   test line — L1's first second); a new contact sheet with the newest take of every scene
   (`video/out/v2/contact-sheet.png`); chapter previews `video/out/v2/ch3-preview.mp4` …
   `ch6-preview.mp4` (1920×1080, no narration).

## The live smoke (M-desk-4 + M-desk-5) — acceptance, each with a screenshot you open

Echo one `SMOKE:` line per check, PASS or FAIL, with the screenshot path. On a FAIL, keep filming
the other scenes (never change product code in Part B), and end the session with NEEDS_HUMAN listing
every FAIL — a fix comes before the ship.

- **3.6 / hero run (L1, H1):** the toolbar chip, the banner, the Done summary and the Activity's
  last line name the subscriptions ("on your Claude and Grok subscriptions"; the Done line "Done in
  … · on your Claude and Grok subscriptions") — no "$0.00 +", no "$0.0000".
- **Hero run (L2):** no Reviewer verdict mentions `REPORT.md`, `REVIEW_VERDICT.json`, `SPEC.md` or
  `TVASHTR_REMEMBER.jsonl`.
- **3.7 (L3):** after Done (Tvashtr's copy of the repo gone), the Changes tab lists the same files
  as the PR's "Files changed" on GitHub.
- **Hero run (L4):** no "repo produced no skills" line.
- **4.1 (H1, H2):** the Activity's failure line ends "· on your Claude subscription" (no dollars);
  the "Next: resume from …" line says Tvashtr skips the work that is done.
- **4.2 (H2):** the confirm reads "Skips N min of finished work." and "Only the steps that run again
  use your Claude subscription." (or the mixed form); the picker shows no dollar per step.
- **6.3 (H4, H5, H1):** a queued set cell reads "Waiting for your Claude subscription — one job at a
  time."; the estimate's minutes add up the turns; the compare header, lanes, results table and set
  cards name the subscriptions, not "$0.00".
- **6.1/6.2 (L1, D8):** a running test's line names its subscription from its first second.

## Real-work budget for this session

| | Part A | Part B |
|---|---|---|
| real Desktop runs | ≤ 2 | ≤ 12 (hero 1 + 1 retry, 4.1 1 + 1 retry, 4.2 1, 5.1 1, 6.3: 2 compare + 4 set) |
| test replays | 0 | ≤ 12 |
| Asks | 0 | ≤ 2 |

Keep a spend ledger (V1's `budget.json` style) and echo it at each checkpoint. A usage cap → write
NEEDS_HUMAN with the reset time if one is shown, leave the safe state; on resume, continue from
`STATE.md`. Before every real run: no stale runs or PENDING `run_team` workflows on the DB you use
(CLI-RULES §4.5); after it, delete a stray `REPORT.md`/`DEMO_PROOF.md` only once
`git ls-files --error-unmatch` proves it untracked.

## Outputs of Part B

- Takes in `video/takes/v2/<scene>/` (`take.mp4`, `take.json`, `poster.png`), recordings in
  `video/recordings/<name>/` — both ignored, never committed.
- `video/SCENES.md`: the status table with a V2 column; every scene's real numbers and bends (G1),
  every SMOKE line, the remaining operator items; **"What V3 needs"** — per scene the real story as
  filmed (what happened, the on-screen words, durations) for the script and voice.
- `video/README.md`: a V2 section (what changed in the camera, what didn't work).
- Every trade_mcp PR opened, with its URL (don't close or merge any).

## Rules (both parts)

1. **Branches:** Part A commits only on `feat/m-desk-5`; Part B only on `video/v2-runs` (from
   `feat/m-desk-5`'s tip). Conventional commits, your own paths by name (never `-A`), a checkpoint
   per finding / sitting. Never commit `prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`,
   `design/`. Prove scope: `git diff --stat main...feat/m-desk-5` (no `video/`) and
   `git diff --stat feat/m-desk-5...video/v2-runs` (only `video/**` and `.gitignore`).
2. **No push.** `git config --get remote.origin.pushurl` must print
   `DISABLED-no-push-during-video-work` and `git push --dry-run origin HEAD` must fail; if the guard
   is off, stop NEEDS_HUMAN. Never force, never `reset --hard`, never merge into `main`.
3. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print
   or edit it.
4. **Secrets:** never print, log, screenshot or record a key, token, password, cookie or CLI
   credential file; never open the `claude`/`grok` credential files or `github-session.json`'s
   contents. Scan what you stage for key/token patterns before each commit.
5. **Subscriptions:** before the first real run of each part, Engines shows Claude and Grok
   "Connected" and the first run's log shows Claude `apiKeySource: none`. An expired CLI sign-in →
   NEEDS_HUMAN (the operator runs `claude auth login` in a plain Terminal).
6. **The Mac:** record under `caffeinate -dimsu`, Tvashtr frontmost; pause or stop only processes
   in the Electron PID tree you launched, never by name; never touch
   `~/Library/Application Support/tvashtr-desktop/` outside a throwaway profile.
7. **One stack, one Desktop:** you own :8000, :5173 and the Desktop. Never run tests next to a live
   stack from this checkout; never `make test` against `tvashtr_film` or `tvashtr_desk5`.
8. **Three-attempt rule:** a problem that survives three distinct fixes (each with output in chat)
   is recorded with its evidence; move on.
9. **Time box:** 16 hours of work (waiting on a cap doesn't count; a running real run does).
10. **Safe state at any stop:** nothing running (servers, Vite, Electron, Playwright, background
    tasks), every branch committed, the checkout on `main`, clean apart from the operator's
    untracked files.
11. **After a compaction:** re-read this brief and the end of `STATE.md`.

## Evidence lines (echo each as it completes)

Part A: `NO_PUSH_GUARD: ON` · `PREFLIGHT_A: main=<sha> branch=feat/m-desk-5` · `L1_RED/L1_GREEN`,
`L2_RED/L2_GREEN`, `L3_RED/L3_GREEN`, `L4_RED/L4_GREEN` (test names, output) · `CAUSE: L2 <where>`,
`CAUSE: L4 <what>` · `BOARD: <canvas> <board> v<n>` · `GATES: make test <n>/<n>, vitest <n>,
build ok, lint +0, owner sweep <n>, desktop <n|unchanged>, parity <boards> 0 drift, website <n>/<n>
0 px` · `INVARIANTS: team_run 94eda1bb9fbb, app versions 3011d7ac/c7320dd5, alembic empty,
runner <blob>, claim_next unchanged, asserts removed 0` · `LIVE_A: run=<id> PR=<url> <screenshots>`
· `READY_TO_MERGE feat/m-desk-5 <sha>`.

Part B: `PREFLIGHT_B: branch=video/v2-runs base=<feat/m-desk-5 sha> READING_KEY=<value>` ·
`FILM_STACK: tvashtr_film reset, Claude+Grok Connected` · `HERO: run=<id> rounds=<n> time=<t>
PR=<url> recording=<path>` · `SMOKE: <check> PASS|FAIL <screenshot>` (every check above) ·
`TAKES_V2: <list> clips, <list> re-takes, blocked=<list>` · `CONTACT_SHEET: <path>` ·
`PREVIEWS: <paths and seconds>` · `GITHUB_SESSION: deleted` · `RUNS_USED: A runs=<n>/2; B runs=<n>/12
tests=<n>/12 asks=<n>/2` · `DIFF_A: …` · `DIFF_B: …` · `PRS: <urls>` ·
`READY_TO_MERGE video/v2-runs <sha>`, then the eight-section FINAL REPORT (CLI-RULES §4.7)
covering both parts.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off;
- Claude or Grok isn't "Connected", a CLI sign-in has expired, or a usage cap is hit;
- macOS asks for a permission only a human can grant;
- L1 can't be fixed inside the invariants;
- a fix would need `team_run.py`, a DBOS workflow/step change, a migration or an SDK version change;
- a second, unknown problem needs a broad or unproven change;
- any `SMOKE:` line is FAIL (at the end of Part B, after filming everything else).

A contained, code-proven, regression-guarded fix inside Part A's scope may proceed.
