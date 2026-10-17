# Brief — M-desk-7 (Grok locked to its job's copy + two on-camera fixes) + Video V2b (the re-film with the Tests check), one session

Architect: Tvashtr Sidechat-23, 2026-10-14. Path: `/Users/adimac/Desktop/Tvashtr/prompts/m-desk-7-v2b.md`.
`prompts/` belongs to the architect: never stage or commit anything under it. Where this brief and
`prompts/CLI-RULES.md` differ, this brief wins (CLI-RULES' numbers and milestone list are out of
date). Also read: `prompts/m-desk-6.md` (the Tests check, T2, S1–S4), `prompts/m-desk-5-v2.md` Part B
(V2's film decisions G1–G9 and its live smoke — they carry over), `prompts/video-v1.md` (the film's
rules, camera, storyboard), `video/SCENES.md` and `video/README.md`.

## The shape of this session

Two parts, in order, on two branches, in the main checkout (worktree off):

- **Part A — M-desk-7, a product change** on `feat/m-desk-7` from `main` (`69d5a5b9`): **S4** (the
  Grok CLI is locked to its job's copy), **F1** (a gate's default title follows its type), **F2** (a
  running run's toolbar fits one row at 1440×900). Product code may change here, inside the
  invariants below.
- **Part B — Video V2b, the re-film** on `video/v2b-refilm`, branched from **`feat/m-desk-7`'s tip**.
  The film team gains the Tests check, and every scene that shows that team is filmed again, plus
  the scenes still owed (6.1–6.3, the 2.7 re-take). Only `video/**` and video ignore rules in
  `.gitignore` change in Part B — no product code.

Why this order: a replay plays back the server's exact words, and the camera freezes pixels. The
film must show a Desktop that locks Grok in (S4's run-log line), the Tests check under its own name
(F1), and a toolbar that fits (F2). The operator merges both branches after the architect's audit
(`feat/m-desk-7` first, then `video/v2b-refilm`); you never merge.

## Where things are (checked by the architect on disk, 2026-10-14)

- `main` = **`69d5a5b9`** = M-desk-6 (`77f4b4f7`) + one docs commit. `origin/main` is still
  `e30b8bd9`. Push guard ON. Alembic head `0053`; the freeze hook covers `0001`–`0053`.
  `backend/tvashtr/control_plane/team_run.py` blob **`9a22d313d5c9`**; DBOS application versions
  `3011d7ac…` (local) / `c7320dd5…` (fly-mode), unchanged by M-desk-6. `desktop/electron/runner/`:
  `runner.cjs` `15e977ad71f2`, `cliCommand.cjs` `adca23e63b0e`, `workspace.cjs` `13d5978279d5`.
  Desktop `0.25.0` (last tag `desktop-v0.25.0`).
- The Desktop runner (`runner.cjs`): each job gets `workRoot/<job>/` with the repo copy in `ws/` and
  the prompt in `prompt.txt` beside it; `workRoot` = Electron `userData/runner-jobs` (`main.cjs`),
  i.e. under the user's home. Grok runs as `grok --prompt-file <dir>/prompt.txt --output-format
  streaming-json -m <m> --cwd <ws> --tools read_file,search_replace,write,list_dir,grep,todo_write
  --allow Edit --allow Read --allow Grep --sandbox workspace`; Claude as `claude -p … --restricted
  --safe-mode --no-session-persistence` (prompt on stdin).
- **The Tests check (M-desk-6):** Gate type "Tests pass" + one Command field; runs in Tvashtr's own
  sandbox (docker locally, Fly in production); the canvas requires the check's reject loop to have
  a limit. The command that passed on trade_mcp `main` in the docker sandbox image:
  `pip install -q -e '.[dev]' 'mcp<2' -e servers/kline_cache && python -m pytest -q tests`
  (661 passed; trade_mcp `main` fails test collection with an unpinned `mcp` 2.x). Live proof run
  `9baa72b9`: Tests failed (two tests pin the indicator count) → rework with the lines → passed →
  the Grok Reviewer approved in round 1 → PR #56, "Done in 6m 50s".
- The film: `tvashtr_film` holds V2's runs (reset it in Part B). Account `lazyx@tvashtr.local`; its
  only API key is DeepSeek; no embeddings key works (`READING_KEY = none`); no AI-checks model on
  the local stack (G7). V2's takes: `video/takes/v2/`, ledger `video/out/v2/budget.json`.

---

# Part A — M-desk-7

## S4 — The Grok CLI is locked to its job's copy (operator ruling, 2026-10-14: "proceed")

**Why.** V2 saw Grok read Tvashtr's source, `~/Desktop/trade_mcp` and `~/.grok/sessions`. `--sandbox
workspace` confines writes, not reads; `--allow 'Read(<job>/**)'` doesn't gate reads; `--sandbox
strict` (reads: the working dir + system paths) refuses to start on a Mac with Docker Desktop
("could not resolve runtime-socket deny path /var/run/docker.sock: endpoint is a symlink … Refusing
to start"). Tvashtr runs agents on any repo, including hostile ones: whatever Grok opens can reach
the run log on Tvashtr's server, or be written into the repo copy and shipped in a PR. Claude is
already confined (`--restricted`, confirmed by M-desk-6). The guard must be the operating system's,
not the model's good behaviour.

**What Grok documents** (the architect read docs.x.ai `build/features/sandbox` and
`build/settings/reference` on 10-14 — confirm against `grok --help` and the installed version): the
sandbox uses Seatbelt on macOS; built-in profiles `off`, `workspace`, `devbox`, `read-only`,
`strict`; **custom profiles** in `~/.grok/sandbox.toml` (user) or `.grok/sandbox.toml` (project) with
fields `extends`, `restrict_network`, `read_only`, `read_write`, `deny` — **`deny` is a
kernel-enforced deny for read and write/rename**; an entry with `*`, `?` or `[` is a glob; select a
profile with `--sandbox <name>`, `[sandbox] profile` or `GROK_SANDBOX`; built-in names can't be
redefined. `~/.grok/` stays writable under sandboxed profiles so sessions persist.

**Rulings (final):**
1. **Reads are locked by Grok's own kernel sandbox, through a profile Tvashtr writes for each job.**
   One mechanism on every Mac: a custom profile that `extends = "workspace"` with a `deny` list built
   when the job starts (not `strict`, which refuses on Macs with Docker Desktop). Never create, edit
   or read the user's own `~/.grok` files (config, `sandbox.toml`, credentials): the profile lives
   with the job. Find the cleanest documented way to point Grok at it (a project `.grok/sandbox.toml`
   in the job's copy, or another documented route) — prove it with probes.
2. **What a Grok job may open:** the job's copy, and what Grok needs to run (system paths, its own
   install, its sign-in under `~/.grok`). **Must be refused** (the probe set): a canary file in the
   home folder, `~/Desktop/Tvashtr`, `~/Desktop/trade_mcp`, other jobs' folders under `runner-jobs`,
   `~/.ssh`, `/Volumes`, other users' folders. Report the exact list of what stays readable and why.
   If the deny list needs the job folders outside the home folder, move Grok jobs' folders (Claude
   jobs behave as today) and prove it.
3. **`~/.grok/sessions`** (the user's other Grok conversations) is denied too, if Grok still runs and
   signs in with it denied. If it can't, report it with the evidence — not a stop.
4. **A repo's own `.grok/` can't take effect in a job**: its `config.toml` (MCP servers, settings),
   its `sandbox.toml` (including a profile with the job profile's name), and hooks, skills or plugins
   if Grok reads them from there. The repo's `.grok/` comes back byte-identical after the job; the
   job's patch never carries Tvashtr's own files (the profile, the prompt file). If Grok documents a
   way to not load the **user's** MCP servers for a headless run (Claude's `--safe-mode` parity), use
   it; otherwise report it (they are already blocked from use by the allow rules).
5. **Fail closed.** If the profile can't be applied (Grok refuses it, an older Grok without custom
   profiles), Grok never runs unconfined: the job fails before any model call, with the step's
   reason reading exactly: **"Grok Build couldn't lock itself to this job's copy of the repo on this
   Mac, so Tvashtr didn't start it. Nothing on your Mac was opened, and nothing was used from your
   Grok plan. Update Grok Build, or switch this step to Claude."** Retry works as usual.
6. **The run log says it.** Each Grok job adds the line **"Grok Build is locked to this job's copy of
   the repo — it can't open your other files."**; each Claude job **"Claude Code is locked to this
   job's copy of the repo — it can't open your other files."** The existing "Running on this
   computer with your own …" line shows the new flags. Claude's CLI arguments stay byte-identical.
7. **Draft the report to xAI** (the `strict` profile refusing a symlinked `/var/run/docker.sock` on
   macOS with Docker Desktop: version, exact message, steps) in the FINAL REPORT; the operator files it.

*User sees:* nothing changes in the flow; one new run-log line per job; a Grok step that can't lock
itself in stops with the message above and costs nothing; it ships in the next Desktop release.

## F1 — A gate's default title follows its type

Seen in M-desk-6's live proof: a gate switched to "Tests pass" keeps the title "Approve before
continuing?" (the default a new gate gets, `routers.py` ~4322). **Ruling:** while a gate's title is
still the default, switching its type gives it the type's name ("Tests pass", "Secret leak scan",
"Forbidden paths", "Output schema"; back to "Approve before continuing?" for Human approval). A title
the user typed is never changed. *User sees:* a new gate switched to Tests pass reads "Tests pass"
on the canvas card, in the drawer, the run view and Activity.

## F2 — A running run's toolbar fits one row at 1440×900

Seen in M-desk-6's live proof: while a Desktop run runs, the run view's toolbar wraps onto three rows
at 1440×900 (the Desktop's default window). **Ruling:** one row at 1440×900, Desktop and website,
with nothing removed (the additive rule): fix the layout (spacing, sizing, truncation with the full
text on hover) — no item leaves the toolbar. *User sees:* the running toolbar in one tidy row, the
run card below it unobstructed (M-desk-6's S1 holds).

## Claude Design first

Before code, on the canvas where each screen was designed (find it with your Artifact tool; never
the main canvas): the run view's **running toolbar at 1440×900** (F2) and the **failed step with
S4's message** (Desktop), both on the Runs canvas (`https://claude.ai/artifact/A5nA1F7fAMcLCqLQ1sxQn2`,
v17 after M-desk-6); check Team Setup's Chk-TestsPass board
(`https://claude.ai/artifact/Uzz8uBWdY9jv5teJcLwvBX`, v23) shows the check titled "Tests pass" (F1)
and update it if not. Publish, then build from the boards. List every board added or changed.

## Out of scope (leave as they are; noted in PROJECTPLAN)

Resuming after a check doesn't re-seed its note; the Reviewer template's "Run the repository's tests"
line; the Desktop runner's env leak (`harness/spawnEnv.cjs`); anything about how Claude is invoked.

## Invariants (prove each as evidence)

1. No migration (`backend/alembic` diff empty; head `0053`).
2. `team_run.py` blob `9a22d313d5c9`; the DBOS application versions unchanged (`3011d7ac…` /
   `c7320dd5…`), so this part needs no drain of its own.
3. `claim_next` unchanged (one job per provider).
4. Claude's CLI arguments byte-identical (a desktop test pins them).
5. No assertion or `expect` line removed (grep the diff against `69d5a5b9`).
6. Website renders at 0 px against `69d5a5b9` except the screens F1/F2 change — list each with
   before/after.
7. Nothing under `video/` in Part A.
8. Nothing reads the user's Grok/Claude credential or config files, and nothing writes to `~/.grok`.

## Proof

- **S4 reproduce-first, straight against the installed Grok CLI (no stack needed).** Make a canary
  `~/tvashtr-s4-canary/secret.txt` holding a random made-up string (yours; delete the folder at the
  end and say so). In a throwaway temp dir as the working dir, run Grok with **today's exact
  arguments** (from `cliCommand.cjs` at `69d5a5b9`) and a prompt that, for each probe path, writes
  only `OPENED` or `REFUSED: <error>` into `PROBE.md` — **never any file's contents** (if something
  opens, never print or record what was in it). `S4_RED` = the canary `OPENED`. Then the new
  invocation: `S4_GREEN` = every probe path `REFUSED`, the job still writes its own file, Grok still
  signs in. At most **6** such CLI probes (they use the Grok plan; each is tiny).
- **F1, F2 reproduce-first** (failing on `69d5a5b9`, then passing): F1 a test of the type switch
  (default title follows; a typed title stays); F2 the design-parity harness at 1440×900 in the
  running state (Desktop and website).
- **Desktop tests:** the profile and its deny list (from a fake HOME); Claude's arguments unchanged;
  a repo's `.grok/` set aside and restored byte-identical; the patch never carries Tvashtr's files;
  the fail-closed path and its exact message; the two log lines.
- **Gates:** `make test` on its own database (never `tvashtr_film`, never next to a running stack),
  vitest, the frontend build, `make lint` with no new errors (38 pre-existing in 12 untouched
  files), the owner sweep, desktop tests, the design-parity harness (new/changed boards at 0 drift;
  website per invariant 6).
- **One live proof in the app.** A throwaway database `tvashtr_desk7` (create, migrate, seed; drop it
  afterwards), the real dev Desktop, the docker sandbox. A hostile local-folder repo you create at
  `~/tvashtr-s4-probe-repo/` (delete it afterwards): a `README.md`; a `.grok/config.toml` declaring an
  MCP server whose only command creates `~/tvashtr-s4-canary/MCP_STARTED`; a `.grok/sandbox.toml`
  defining a profile with the job profile's name and no deny. A small team with one Grok job and one
  Claude job, each told to report `OPENED`/`REFUSED` for the probe paths (never contents) and to add
  one line to `README.md`. Expect: every path refused by both; no `MCP_STARTED`; both lock lines in
  the run log; the repo's `.grok/` unchanged; Changes = `README.md` (+ any probe report file) only.
  Screenshots you open: the run log with both lines, the probe results, Changes. At most **2** real
  runs.
- Then `READY_TO_MERGE feat/m-desk-7 <sha>` and go straight on to Part B (don't wait).

**S4 must pass before Part B starts** (the film runs a Grok Reviewer: never film with Grok unlocked,
and a fail-closed Grok can't be filmed). If S4 can't be made to work after three distinct attempts
(each with its output in chat), stop NEEDS_HUMAN at the end of Part A. F1 or F2 that survives three
attempts is recorded with its evidence; Part B then films with it and lists it.

---

# Part B — Video V2b, the re-film

V1's brief still governs the film (honesty rules, camera, storyboard); V2's decisions **G1–G9** carry
over (`prompts/m-desk-5-v2.md` Part B and `video/SCENES.md`): real numbers and outcomes (G1), real
versions v1 → v2 (G2), `READING_KEY = none` (G3), no team-instruction workarounds (G4), the record
take opens every view its replays need (G5), notifications answered "Not now" (G6), AI checks from
sample when no checks model answers (G7), 0.1 on the operator's GitHub session, deleted after (G8),
the Engines badge by design (G9).

## Decisions (final)

- **K1 — The film team has the Tests check.** `story.json` gains `"tests": { "title": "Tests pass",
  "command": "<the command above, or the one that passes on trade_mcp main in the sandbox today>" }`.
  `buildFilmTeam`'s guardrail stage adds it: Engineer → **Tests pass** → (passed) Reviewer;
  (failed) back to the Engineer as a rework loop with a limit of 3 (the canvas's rule); the Fixer's
  path goes to Tests pass (every build is tested before review). 2.4 gets it bare (a plain gate
  with its real title) and sets "Tests pass" + the command **on camera**, like the guardrail gates.
  The final layout puts PM, PRD approval, Engineer, Tests pass, Reviewer, Secret scan, No edits to
  servers/, Ship in one row; the group "Review loop" holds the Engineer, Tests pass and the Reviewer.
- **K2 — What gets filmed.** Re-takes: **2.4, 2.5, 2.6, 2.7, 3.1–3.7, 0.1, 4.1, 4.2, 5.1,
  5.1-recent, 7.1, 7.2**. First time: **6.1, 6.2, 6.3**. Kept as shot: 1.2–1.5, 2.1–2.3, 8.1 (+ the
  MAC and MOTION items). If a kept scene turns out to show the film team without the Tests check,
  re-take it (free) and say so.
- **K3 — Fresh numbering.** `video/stack/reset` first: the hero is run #1; 4.1's failing run #2; 4.2
  opens on **Home's Needs you**, resumes run #2 as run #3 (the storyboard's opening, lost in V2); 5.1
  is run #4, started from the hero. 6.3's lanes after.
- **K4 — Real outcomes.** Whatever the Tests check and the Reviewer really do is filmed (G1): a
  rework round from failed tests is the story's round 1; a run that still escalates is filmed and the
  reason recorded (the smoke says when that is a FAIL).
- **K5 — Output folders.** Takes `video/takes/v2b/<take>/`, review files `video/out/v2b/`, ledger
  `video/out/v2b/budget.json`; V1's and V2's takes stay. The scenes table gains a V2b column.
- **K6 — MAC-3 stays the operator's**, outside this session: never turn on macOS notifications, never
  click a macOS permission.
- **K7 — 6.3 runs unattended:** compare runs approve their own gates; every lane runs the Tests check.

## The sittings (in order; each ends with a checkpoint commit)

1. **Chapter 3 + 0.1.** `video/stack/reset`; Engines shows Claude and Grok "Connected". 3.1 records
   the hero run ("Add a Hull moving average indicator", trade_mcp, `main`, scope `core/`, budget
   $5.00) live from Launch to Done, opening every view the replays need **including the Tests
   check's Activity row with its lines open**; 3.2, 3.3, 3.4, 3.6 replay it; 3.5 (sample) re-taken;
   3.7 LIVE (Changes; one Ask of the Reviewer — about the Tests failure or round 1 if there was one,
   else what it checked; cost per round; Memory: keep one, discard one); 0.1 on the hero PR, then
   delete `video/out/github-session.json` (never open it). At most 1 re-run of the hero for a reason
   that isn't the product's.
2. **Chapter 4.** Stack with `QUIET=20 STALLED=60 FAIL=180`; 4.1 "Add a TRIX indicator", the
   Engineer's CLI paused through the Electron PID tree you launched → Quiet → Stalled → Failed; 4.2
   from Home's **Needs you** → resume that run from the Engineer → it ships. Stack back to normal.
3. **Chapters 5–6.2.** 5.1 "Add a DEMA indicator" from the hero (carry spec, decisions, memories,
   summaries; start from the hero PR's branch) + 5.1-recent; 6.1 (a test from a Reviewer round,
   tests from `fixtures/files/reviewer-tests.csv`, Run all, the AI check per G7); 6.2 LIVE (edit the
   Reviewer, "N changes since v1", Save as **v2**, save and run the tests, History, What changed).
4. **6.3 (long, unattended).** Compare v1 and v2 on "Add a TEMA indicator"; the task set
   "Indicators" ("Add a Vortex indicator", "Add a Chande momentum oscillator") with hidden checks, on
   both versions; Restore.
5. **Chapters 2 and 7 last** (their scenes rebuild teams by name): 2.4, 2.5, 2.6, 2.7 (its test line
   names the subscription from its first second), 7.1, 7.2.
6. **Review files.** A contact sheet with the newest take of every scene (V1/V2/V2b)
   `video/out/v2b/contact-sheet.png`; chapter previews `video/out/v2b/ch2-preview.mp4` …
   `ch7-preview.mp4` (1920×1080, no narration); `video/SCENES.md` (V2b status, real numbers and bends,
   every SMOKE line, **"What V3 needs"** rewritten for the new story) and `video/README.md` (a V2b
   section).

## The live smoke — acceptance, each with a screenshot you open

Echo one `SMOKE:` line per check, PASS or FAIL, with the screenshot path. On a FAIL, keep filming the
other scenes (no product code in Part B) and end with NEEDS_HUMAN listing every FAIL.

- **Hero — the Tests check (M-desk-6 T1/T2):** the run view shows "Running the tests…" then "Tests
  passed · …" or "Tests failed — back to Engineer with the last 12 lines"; a failed check's lines
  reach the Engineer's next round; the Reviewer's verdict cites Tvashtr's result; **no verdict asks
  for command or test output** (FAIL if one does).
- **Hero — S2:** the Done line keeps its time after the post-ship memory save.
- **Hero — S1 + F2 at 1440×900:** the running toolbar is one row; the run card doesn't overlap it; the
  Done summary doesn't clip "total time".
- **F1:** the Tests check never reads "Approve before continuing?" (canvas, drawer, run view, Activity).
- **S4:** every Grok job's log has "Grok Build is locked to this job's copy of the repo — it can't
  open your other files." and its profile flag; every Claude job's log has its line; no Grok job's
  activity shows a file opened outside its copy.
- **L1/H1, L2, L3** (as V2): the subscriptions wording from launch to Done; no verdict names
  Tvashtr's own files; Changes after Done = the PR's "Files changed".
- **4.1/4.2 (H1, H2)** as V2, plus 4.2 opening from Needs you.
- **6.1/6.2 (L1, D8):** a running test's line names its subscription from its first second.
- **6.3 (H4, H5, H1):** a queued set cell reads "Waiting for your Claude subscription — one job at a
  time."; the estimate's minutes add up the turns; header, lanes, results and set cards name the
  subscriptions, not "$0.00".

## Real-work budget (new; nothing carries over from V2)

| | Part A | Part B |
|---|---|---|
| Grok CLI probes (outside the app) | ≤ 6 | 0 |
| real Desktop runs | ≤ 2 | ≤ 14 (hero 1 + 1 retry, 4.1 1 + 1 retry, 4.2 1, 5.1 1, 6.3: 2 compare + 4 set, + 2 spare) |
| test replays | 0 | ≤ 12 (2.7: 1, 6.1: 4, 6.2: 4, + 3 spare) |
| Asks | 0 | ≤ 2 |

Keep the ledger and echo it at each checkpoint. A usage cap → NEEDS_HUMAN with the reset time if
shown, leave the safe state; on resume, continue from `STATE.md`. Before every real run: no stale
runs or PENDING `run_team` workflows on the DB you use (CLI-RULES §4.5); after it, delete a stray
`REPORT.md`/`DEMO_PROOF.md` only once `git ls-files --error-unmatch` proves it untracked.

## Rules (both parts)

1. **Branches:** Part A commits only on `feat/m-desk-7`; Part B only on `video/v2b-refilm` (from
   `feat/m-desk-7`'s tip). Conventional commits, your own paths by name (never `-A`), a checkpoint
   per item / sitting. Never commit `prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`,
   `design/`. Prove scope: `git diff --stat main...feat/m-desk-7` (no `video/`) and
   `git diff --stat feat/m-desk-7...video/v2b-refilm` (only `video/**` and `.gitignore`).
2. **No push:** `git config --get remote.origin.pushurl` prints `DISABLED-no-push-during-video-work`
   and `git push --dry-run origin HEAD` fails; if not, stop NEEDS_HUMAN. Never force, never `reset
   --hard`, never merge into `main`.
3. **`.env` is fenced:** load it per command with `DATABASE_URL` overridden; never open, copy, print
   or edit it.
4. **Secrets:** never print, log, screenshot or record a key, token, password, cookie or CLI
   credential file; never open the `claude`/`grok` credential files, `~/.grok` config or
   `github-session.json`. A probe that opens something never records its contents. Scan what you
   stage for key/token patterns before each commit.
5. **Subscriptions:** before the first real run of each part, Engines shows Claude and Grok
   "Connected" and the first run's log shows Claude `apiKeySource: none`. An expired sign-in →
   NEEDS_HUMAN (the operator signs in from a plain Terminal).
6. **The Mac:** record under `caffeinate -dimsu`, Tvashtr frontmost; pause or stop only processes in
   the Electron PID tree you launched, by PID; never touch the real Desktop profile outside a
   throwaway one; delete only the files and folders you created (canary, probe repo, throwaway DBs).
7. **One stack, one Desktop:** you own :8000, :5173 and the Desktop. Never run tests next to a live
   stack from this checkout; never `make test` against `tvashtr_film` or `tvashtr_desk7`.
8. **Three-attempt rule:** a problem that survives three distinct fixes (each with output in chat) is
   recorded with its evidence; move on (S4 excepted, above).
9. **Time box:** Part A 8 hours, Part B 18 hours of work (waiting on a cap doesn't count; a running
   real run does).
10. **Safe state at any stop:** nothing running (servers, Vite, Electron, Playwright, background
    tasks), every branch committed, the checkout on `main`, clean apart from the operator's
    untracked files.
11. **After a compaction:** re-read this brief and the end of `STATE.md`.

## Evidence lines (echo each as it completes)

Part A: `NO_PUSH_GUARD: ON` · `PREFLIGHT_A: main=<sha> branch=feat/m-desk-7 grok=<version>` ·
`S4_DOCS: <what grok --help and the docs say; how the profile is selected>` · `S4_RED: <probe
results, today's args>` · `S4_GREEN: <probe results, new args>` · `S4_READABLE: <what stays
readable and why>` · `S4_SESSIONS: denied | not possible (<evidence>)` · `S4_USER_MCP: <what
changed or why not>` · `F1_RED/F1_GREEN`, `F2_RED/F2_GREEN` (test names, output) · `BOARDS: <canvas>
<board> v<n>` (each) · `GATES: make test <n>/<n>, vitest <n>, build ok, lint +0, sweep <n>, desktop
<n>, parity <boards> 0 drift, website <n>/<n>` · `INVARIANTS: team_run 9a22d313d5c9, app versions
3011d7ac/c7320dd5, alembic empty, claim_next unchanged, claude args identical, asserts removed 0` ·
`LIVE_A: run=<id> grok=<refused list> claude=<refused list> mcp_started=no <screenshots>` ·
`CLEANUP_A: canary, probe repo, tvashtr_desk7 removed` · `READY_TO_MERGE feat/m-desk-7 <sha>`.

Part B: `PREFLIGHT_B: branch=video/v2b-refilm base=<feat/m-desk-7 sha> READING_KEY=none` ·
`FILM_STACK: tvashtr_film reset, Claude+Grok Connected` · `FILM_TEAM: <nodes in order> validate ok`
· `HERO: run=<id> tests=<passed|failed→rework> rounds=<n> escalation=<no|yes: why> time=<t> PR=<url>
recording=<path>` · `SMOKE: <check> PASS|FAIL <screenshot>` (every check above) · `TAKES_V2B: <list>
clips, blocked=<list>` · `CONTACT_SHEET: <path>` · `PREVIEWS: <paths and seconds>` ·
`GITHUB_SESSION: deleted` · `RUNS_USED: A probes=<n>/6 runs=<n>/2; B runs=<n>/14 tests=<n>/12
asks=<n>/2` · `DIFF_A: …` · `DIFF_B: …` · `PRS: <urls>` · `READY_TO_MERGE video/v2b-refilm <sha>`,
then the eight-section FINAL REPORT (CLI-RULES §4.7) covering both parts, with the xAI report draft.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off;
- Claude or Grok isn't "Connected", a CLI sign-in has expired, or a usage cap is hit;
- macOS asks for a permission only a human can grant;
- S4 can't be made to work (end of Part A);
- a fix would need `team_run.py`, a DBOS workflow/step change, a migration or an SDK version change;
- a board can't be published;
- a second, unknown problem needs a broad or unproven change;
- any `SMOKE:` line is FAIL (at the end of Part B, after filming everything else).

A contained, code-proven, regression-guarded fix inside Part A's scope may proceed.
