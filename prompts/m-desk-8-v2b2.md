# Brief — M-desk-8 (Grok's own folder locked + six on-camera fixes) + Video V2b, second sitting (the rest of the film on Claude), one session

Architect: Tvashtr Sidechat-23, 2026-10-15. Path: `/Users/adimac/Desktop/Tvashtr/prompts/m-desk-8-v2b2.md`.
`prompts/`, `HANDOVER.md`, `PROJECTPLAN.md`, `STATE.md`, `design/` belong to the architect: never stage
or commit them. Where this brief and `prompts/CLI-RULES.md` differ, this brief wins. Also read
`prompts/m-desk-7-v2b.md` (S4 and V2b's decisions K1–K7, which carry over unless changed here),
`prompts/m-desk-5-v2.md` Part B (G1–G9), `prompts/video-v1.md`, `video/SCENES.md` and
`video/README.md` **on `video/v2b-refilm`** (V2b's status, bends, product notes and what's owed).

## The shape of this session

- **Part A — M-desk-8, a product change** on `feat/m-desk-8` from `main` (`938dbde6`): **S4b** (a Grok
  job can't change or read Grok's own folder `~/.grok` beyond what it needs) and **P1–P6** (six
  strings and states V2b's footage showed wrong, fixed before chapters 2, 6 and 7 are filmed).
- **Part B — V2b, second sitting** on the existing `video/v2b-refilm` (`98a7f295`): first
  `git merge --no-ff feat/m-desk-8` into it (so the film shows Part A), then film everything still
  owed, **with the Reviewer on Claude** (operator ruling below). Only `video/**` and video ignore rules
  change in Part B's own commits.
- The operator merges after the architect's audit: `feat/m-desk-8` (fast-forward), then
  `video/v2b-refilm` (`--no-ff`). You never merge into `main`.

## Where things are (checked by the architect on disk, 2026-10-15)

- `main` = `origin/main` = **`938dbde6`** = production: Fly **v45**, Desktop **`desktop-v0.26.0`**,
  alembic head **`0053`** (freeze hook 0001–0053). `team_run.py` `9a22d313d5c9`; DBOS application
  versions `3011d7ac…` / `c7320dd5…`. `desktop/electron/runner/grokLock.cjs` `18fd231559de`. Push guard
  ON (`DISABLED-no-push-during-video-work`).
- **S4 (shipped in 0.26.0):** each Grok job runs under its own Seatbelt profile (`extends =
  "workspace"` + a deny list, ≤ 90 globs — Seatbelt refuses ~120); job folders in `<tmp>/tvg-<tag>/`;
  the repo's `.grok/` set aside; a lock check before the CLI (a refused read of a sentinel, no model
  call); the Grok binary must carry xAI's Developer ID signature; `GROK_JOB_ENV` turns off Claude's
  and Cursor's MCP servers and hooks. **Still open:** `~/.grok` stays readable and writable to the job
  (only other sessions' folders are denied). The xAI draft in the M-desk-7 report: denying the
  sessions folder whole gives "Couldn't create session: Permission denied"; a profile's `read_only`
  doesn't narrow `workspace`'s `~/.grok` write grant.
- **The film (`tvashtr_film`):** runs #1–#4 (hero PR #57, TRIX failed → resumed PR #58, DEMA PR #59);
  the film team ("Indicator sprint team") is at **v2** (6.2 saved it), Reviewer on Grok; 6.1/6.2's
  8 test replays all failed on Grok's free usage limit. Ledger `video/out/v2b/budget.json`. Grok's
  limit has reset (the operator's `grok -p` answered "ok", 10-15).
- 0.1 needs `video/out/github-session.json` (the operator runs `node video/camera/github-login.mjs`
  before launch; you delete the file after filming 0.1 — never open it).

---

# Part A — M-desk-8

## S4b — Grok's own folder (operator ruling, 2026-10-15: "proceed on s4b")

**Why.** A hostile repo can still (1) have a Grok job change Grok's settings, hooks, skills or
plugins in `~/.grok`, which the user's next ordinary Grok session runs with no sandbox at all — code
running on the user's Mac; (2) have it read Grok's sign-in or the user's MCP settings (which can hold
keys) and write them into the repo copy, which Tvashtr pushes as a PR.

**Rulings (final):**
1. **What a job may write in `~/.grok`:** only its own session folder, plus anything else your probes
   prove Grok must write during a job (each listed with its proof). Everything else in `~/.grok` is
   denied (the `everythingBut` pattern, inside the glob budget). **Must hold** — never writable by a
   job: Grok's settings files (`config.toml` and any other settings), sandbox profiles, hooks,
   skills, plugins, MCP settings, and its program folder.
2. **If Grok can't start with one must-hold file denied** (it reads it after the lock applies): the
   runner keeps a byte copy before the CLI starts (reading it only to copy and compare — never
   printed, logged or sent), and if the job changed it, puts it back and fails the step with exactly:
   **"This Grok step tried to change Grok's own settings on your Mac. Tvashtr put them back and
   stopped the step."** No other path may leave a must-hold file changed.
3. **Reads:** deny Grok's sign-in files and the user's settings files wherever Grok still starts and
   signs in with them denied. What must stay readable is reported with proof; if Grok's sign-in must
   stay readable, the Grok run-log line becomes **"Grok Build can open this job's copy of the repo and
   its own sign-in — nothing else of yours."** (otherwise it stays as shipped).
4. **Probe safely.** Never open, edit or delete an existing `~/.grok` file; never print a file's
   contents. You may list `~/.grok`'s entry **names**. Write probes only create new files named
   `tvashtr-s4b-probe*` (delete any that get created, and say so). Prove "still starts" with the lock
   check (no model call) and "still signs in and works" with one tiny real job.
5. Grok trying to update itself during a job is refused by the lock; the job still finishes.

*User sees:* nothing new when every part closes; otherwise the honest log line (3) or, for a job that
tampered, the stop message (2). Ships as Desktop 0.27.0.

## P1–P6 — on-camera fixes (from V2b's product notes; final wording)

- **P1** Guardrail cards never show raw kind ids (`secret_leak_scan`, `diff_touches_forbidden_paths`,
  `output_schema_check`): they read the gate's title, and where a type name shows, "Secret leak scan",
  "Forbidden paths", "Output schema" (`gateLabel` in `frontend/src/lib/nodeNames.ts` names only PRD
  approval, Escalation and Tests pass today).
- **P2** The Tests check's loop arc back to the Engineer reads **"tests failed"**, not "changes
  requested" (the Reviewer's arc keeps "changes requested").
- **P3** The Activity verdict line shows the Reviewer's reasons when its verdict has a reasons string
  ("Approved — <reasons>", trimmed to one line with the full text on expand), as it does for a list.
- **P4** The agent drawer's per-round cost row follows L1: a round done on a subscription reads "on
  your <Claude|Grok> subscription", never "$0.0000"; a keyed round keeps its dollars.
- **P5** Ask answers render markdown (bold, lists, inline code, code blocks) instead of raw `**…**`.
- **P6** The resume confirm never lists a check as "when you approve" (a Tests check reads "Tests
  pass — Tvashtr runs the tests"), and its subscription line names every subscription the steps that
  run again use ("Only the steps that run again use your Claude and Grok subscriptions.").

Boards: P1–P6 change existing screens' words or states only; update the boards that show them on the
Runs (`https://claude.ai/artifact/A5nA1F7fAMcLCqLQ1sxQn2`) and Team Setup
(`https://claude.ai/artifact/Uzz8uBWdY9jv5teJcLwvBX`) canvases first, then build to match.

## Invariants (prove each)

1. No migration (head `0053`). 2. `team_run.py` `9a22d313d5c9`; app versions `3011d7ac…`/`c7320dd5…`.
3. `claim_next` unchanged. 4. Claude's CLI arguments byte-identical. 5. No assertion or `expect`
line removed (vs `938dbde6`). 6. Website renders at 0 px vs `938dbde6` except the P1–P6 screens
(list each). 7. Nothing under `video/`. 8. No existing `~/.grok` file opened (apart from rule 2's
copy-and-compare), edited or deleted; no credential printed.

## Proof

- **S4b reproduce-first:** with 0.26.0's profile, a probe job creates `~/.grok/hooks/tvashtr-s4b-probe`
  (or the nearest must-hold folder that exists) → `S4B_RED` = created (then delete it). With the new
  profile → refused. The lock check passes with the full deny list (Grok starts); one tiny real job
  signs in and finishes. Each must-hold item: denied, or copy-and-restore proven by a desktop test and
  one live tamper probe on a `tvashtr-s4b-probe` copy. At most **8** Grok CLI probes.
- **P1–P6:** each reproduced failing on `938dbde6` (vitest / backend test / parity), then passing.
- **Gates:** `make test` on `tvashtr_gate`, vitest, tsc, build, desktop tests, `make lint` (38
  baseline), owner sweep, parity (changed boards 0 drift; website per invariant 6).
- **Live proof** (throwaway DB `tvashtr_desk8`, real dev Desktop, docker sandbox): the M-desk-7 probe
  repo pattern (`~/tvashtr-s4-probe-repo/`, recreated, deleted after) with one Grok job and one Claude
  job, each asked to create a `tvashtr-s4b-probe` file in `~/.grok/hooks` and `~/.grok/skills`, to
  report OPENED/REFUSED (never contents) for Grok's sign-in and settings files, and to add one line to
  `README.md`. Expect: every `~/.grok` write refused; the reads as rule 3 found; the job finishes;
  Changes = `README.md` only. Screenshots you open. At most **2** real runs.
- `READY_TO_MERGE feat/m-desk-8 <sha>`, then straight to Part B.

S4b's must-hold writes must be closed (denied or copy-and-restore) before Part B; if not after three
attempts, stop NEEDS_HUMAN at the end of Part A. A P-item that survives three attempts is recorded;
Part B films with it and lists it.

---

# Part B — V2b, second sitting

## Decisions (final)

- **K8 — The Reviewer moves to Claude for the rest of the film** (operator, 10-15: "use a different
  claude model"; the continuity break with chapters 3–5's Grok Reviewer is accepted). The Reviewer
  runs the **strongest Claude model the app's picker offers that differs from the Engineer's**
  (prefer an Opus model; prove once with a tiny `claude -p --model <id>` that the Claude CLI on the
  operator's subscription accepts it — else the next one). `story.json`: `agents.reviewer.model` and
  `runs_on: "claude"`; 2.5 now ends Reviewer → claude-sonnet-5 → the same-model advisory → the chosen
  Claude model (the advisory clears). No Grok job runs in Part B.
- **K9 — Chapter 6 on a fresh film team.** The existing team's History carries two capped versions;
  instead `buildFilmTeam` builds "Indicator sprint team" anew (final, no Query domain step, the Tests
  check, the Claude Reviewer) — the hero team is renamed "… (earlier)" by the builder (its runs stay;
  replays of chapter 3 come from recordings). One **seed run off camera** on it gives 6.1 a Reviewer
  round: a task trade_mcp `main` doesn't have yet (check; e.g. "Add a KAMA indicator"; add it to
  `story.json` `runs`). Then 6.1 (v1) → 6.2 (Save as v2) → 6.3 (v1 vs v2) with clean numbers;
  `story.json` versions 1 → 2.
- **K10 — Re-take 6.1 and 6.2 whole** on the fresh team (their V2b takes show the Grok cap).

## The sittings (in order; a checkpoint commit after each)

1. `git merge --no-ff feat/m-desk-8` into `video/v2b-refilm`; the K8 probe; `story.json` (K8, K9).
2. **Chapter 6:** the fresh team; the seed run (off camera); 6.1; 6.2; **6.3 + 6.3-set** (unattended;
   every lane on Claude, so lanes take turns one job at a time).
3. **3.5** (sample: `take.mjs video/fixtures/capture-live.mjs`, `node video/fixtures/export-live.mjs`,
   `take.mjs 3.5`).
4. **Chapters 2 and 7:** 2.4, 2.5, 2.6, 2.7 (its test line names the subscription from its first
   second), 7.1, 7.2.
5. **0.1** on PR #57 (the hero's), then delete `video/out/github-session.json`; if the file is missing,
   0.1 stays blocked.
6. **Review files:** the contact sheet (newest take per scene) and ch2–ch7 previews; `video/SCENES.md`
   (V2b status, real numbers, bends incl. K8's break, every SMOKE line, "What V3 needs") and
   `video/README.md`.

## The live smoke (each with a screenshot you open; a FAIL → keep filming, NEEDS_HUMAN at the end)

- **6.1/6.2 (L1, D8):** a running test's line names "your Claude subscription" from its first second;
  results show real pass counts (not a usage-limit error).
- **6.3 (H4, H5, H1):** a queued set cell reads "Waiting for your Claude subscription — one job at a
  time."; the estimate's minutes add up the turns; header, lanes, results and set cards name the
  subscription, not "$0.00"; every lane runs the Tests check.
- **P1–P6** each on the screen it changed (2.4's gate cards, a run view's loop arcs, a verdict line, a
  drawer's round row, an Ask answer if one is filmed — else a no-spend evidence shot, the resume
  confirm in an evidence shot).
- **2.5:** the same-model advisory appears with both on claude-sonnet-5 and clears on the chosen model.
- **2.7 (L1, D8)** as 6.1.
- **S4 (Claude jobs):** every Claude job's log carries its lock line.

## Real-work budget (new)

| | Part A | Part B |
|---|---|---|
| Grok CLI probes | ≤ 8 | 0 |
| Claude CLI probes | 0 | ≤ 2 (K8) |
| real Desktop runs | ≤ 2 | ≤ 10 (seed 1 + 1 retry, 6.3: 2 compare + 4 set, + 2 spare) |
| test replays | 0 | ≤ 12 (6.1: 4, 6.2: 4, 2.7: 1, + 3 spare) |
| Asks | 0 | ≤ 1 |

## Rules (both parts)

1. Part A commits only on `feat/m-desk-8`; Part B on `video/v2b-refilm` (its merge of `feat/m-desk-8`
   + `video/**` commits). Your own paths by name (never `-A`). Prove scope: `git diff --stat
   main...feat/m-desk-8` (no `video/`); `git diff --stat feat/m-desk-8...video/v2b-refilm` (only
   `video/**`, `.gitignore`).
2. No push (guard ON, dry-run fails), never force, never `reset --hard`, never merge into `main`.
3. `.env` fenced; secrets never printed, logged, screenshotted or committed; never open the
   claude/grok credential files or `github-session.json`.
4. Subscriptions: Engines shows Claude (and, for Part A, Grok) "Connected" before the first real run;
   Claude jobs log `apiKeySource: none`. An expired sign-in or a usage cap → NEEDS_HUMAN.
5. The Mac: `caffeinate -dimsu`; pause/stop only processes you launched, by PID; the operator's
   installed Tvashtr.app may be open — leave it (`VIDEO_OTHER_DESKTOP_OK`); delete only what you
   created (probe files, probe repo, `tvashtr_desk8`).
6. One stack, one Desktop; never `make test` next to a running stack or on `tvashtr_film`.
7. Three-attempt rule; time box Part A 8 h, Part B 14 h (waiting on a cap doesn't count).
8. Safe state at any stop: nothing running, branches committed, checkout on `main`.
9. After a compaction: re-read this brief and the end of `STATE.md`.

## Evidence lines

Part A: `NO_PUSH_GUARD: ON` · `PREFLIGHT_A: main=<sha> grok=<version>` · `S4B_GROK_DIR: <entry names
and what each is>` · `S4B_RED` / `S4B_GREEN` · `S4B_WRITES: <allowed list and proof>` ·
`S4B_MUST_HOLD: <each: denied | copy-and-restore>` · `S4B_READS: <denied | must stay readable + why>`
· `S4B_LOG_LINE: <shipped | honest variant>` · `P1_RED/P1_GREEN` … `P6_RED/P6_GREEN` · `BOARDS: …` ·
`GATES: …` · `INVARIANTS: …` · `LIVE_A: run=<id> grok_dir_writes=refused reads=<…> <screenshots>` ·
`CLEANUP_A: …` · `READY_TO_MERGE feat/m-desk-8 <sha>`.

Part B: `PREFLIGHT_B: branch=video/v2b-refilm merged=<feat/m-desk-8 sha>` · `K8: reviewer=<model>
probe ok` · `FILM_TEAM: <nodes> reviewer=<model> validate ok` · `SEED: run=<id> task=<…> PR=<url>` ·
`SMOKE: <check> PASS|FAIL <screenshot>` (each) · `TAKES_V2B2: <list> clips, blocked=<list>` ·
`CONTACT_SHEET: …` · `PREVIEWS: …` · `GITHUB_SESSION: deleted | missing` · `RUNS_USED: A
grok_probes=<n>/8 runs=<n>/2; B claude_probes=<n>/2 runs=<n>/10 tests=<n>/12 asks=<n>/1` ·
`DIFF_A` · `DIFF_B` · `PRS` · `READY_TO_MERGE video/v2b-refilm <sha>`, then the eight-section FINAL
REPORT (CLI-RULES §4.7) covering both parts.

## Stop with NEEDS_HUMAN (written to STATE.md and echoed, with the FINAL REPORT) when

- the push guard is off; a sign-in expired or a usage cap is hit; macOS asks for a permission;
- S4b's must-hold writes can't be closed (end of Part A);
- a fix needs `team_run.py`, a DBOS workflow/step change, a migration or an SDK version change;
- a board can't be published; a second, unknown problem needs a broad or unproven change;
- any `SMOKE:` line is FAIL (at the end of Part B, after filming everything else).

A contained, code-proven, regression-guarded fix inside Part A's scope may proceed.
