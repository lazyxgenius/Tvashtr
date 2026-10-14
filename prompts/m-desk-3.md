# Brief — M-desk-3: the last three Desktop strings on the save-and-check and task-set screens

Architect: Tvashtr Sidechat-21, 2026-10-03 (operator: "Proceed"). Path:
`/Users/adimac/Desktop/Tvashtr/prompts/m-desk-3.md`. `prompts/` is untracked: never commit it. Where
this brief and `prompts/CLI-RULES.md` differ, this brief wins (CLI-RULES' numbers are out of date).
Read `prompts/m-desk-2.md` too: its rulings E1–E4 and rules still hold unless this brief says
otherwise. This step finishes the Desktop copy; it ships together with M-desk-routes and M-desk-2.

## Why

M-desk-2 (merged on `main`) made the Tests, Save and Compare copy name the subscription on the
Desktop. Its report found three more Desktop strings that still say dollars or "side by side" where
the work runs on the owner's subscriptions and the lanes take turns. All three are on screens the
demo film shows (scenes 6.2 and 6.3):

1. `frontend/src/canvas/SaveNudgeDialog.tsx` — the footnote "About $X for both checks" (shown when
   both the tests and the set check are ticked);
2. the same dialog's set checkbox description "5 tasks · about 25 min · about $X · nothing ships";
3. `frontend/src/pages/compare/CompareView.tsx` (`SetResults`) — the task-set results subtitle
   "5 tasks · run side by side · finished … · $0.00 in all".

**What the user gets:** in the Desktop app, the save dialog's set check and its footnote say the
checks run on their Claude/Grok subscriptions instead of quoting a dollar price, and a task set's
results say the versions took turns on the Desktop. The website is unchanged.

## Where things are

- Branch `feat/m-desk-3` from `main` @ **`2b4b87fb`** (V0 + gate fix + M-desk-routes + M-desk-2
  merged). Create it in your worktree with `git switch -c feat/m-desk-3 2b4b87fb` and confirm the
  sha. (A separate DBOS cron fix may land on `main` while you work; it shares no files with you.)
  Alembic head `0053`; the freeze hook covers `0001`–`0053`.
- Floors: `make test` 3480 passed / 1 xfailed (M-desk-2); vitest 266 files / 2717; desktop 143/0.
- Pieces to reuse: `credential_gate.desktop_routes(models, fresh_subscriptions=…)`,
  `desktop_jobs.fresh_subscription_ids(owner)`, the versions read's `?desktop_target=1` (M-desk-2
  already adds `tests.desktop` there), `desktopRepos.ts` (`desktopQuery`, `onSubscriptions`,
  `subscriptionsText`), and M-desk-2's `shared` rule for compares whose Desktop lanes shared a
  subscription (`compare._results`; check whether the task-set results path carries it — it may
  not).
- The save dialog's set offer comes from `versions.listing` → `task_sets.check_sets(...)`.

## Rulings (final)

- **G1 — Where a set check would run.** With `?desktop_target=1`, each `check_sets` entry gains
  `desktop: {subscriptions, all}`, routed over the models of BOTH versions the check would compare
  (the current version and the new one = the team's graph now), exactly as a Desktop compare's
  launch routes them. Additive; the website's read is unchanged.
- **G2 — The strings.** The E2 rule: on the Desktop, when every model the action would run is on a
  fresh subscription, name the subscription; mixed, not fresh, or the website: today's text.
  - Set checkbox → "5 tasks · about 25 min · on your Claude and Grok subscriptions · nothing ships".
  - Footnote, when both checks are ticked and both are fully routed → "Both checks run on your
    Claude and Grok subscriptions" (the names are the union of both checks' subscriptions). If
    either check is not fully routed: today's text.
  - Task-set results subtitle, for a Desktop set compare whose lanes shared a subscription →
    "5 tasks · taking turns on your Desktop · finished … · $0.00 in all" (only the "run side by
    side" part changes; carry `shared` on the set results if it isn't there).
- **G3 — Claude Design first.** Before code, on the Quality canvas
  (https://claude.ai/artifact/SnnUUrHn3oPKgn11YJfcmz; read it with your Artifact tool first and
  follow the Design type's instructions; never the main canvas): add `Set-SaveCheckDesktop` (from
  `Set-SaveCheck`, both checks ticked: the set checkbox + the footnote) and `Set-ResultsDesktop`
  (from `Set-Results`: the subtitle), each at the end of its original's row. Publish, then build
  from them.
- **G4 — A sweep, report only.** List every other string the Desktop can show that claims keys,
  quotes a dollar price for work that runs on subscriptions, or says "at the same time" / "side by
  side" / "in parallel" for Desktop lanes: file, line, screen, and whether the film shows it
  (scenes in `prompts/video-v1.md`). Don't change them; they are findings for the architect.
- **G5 — Out of scope.** Domains, memory notes and AI checks stay on keys. No ship. No migration
  (if one is truly needed: `0054` + the freeze bump as the last commit, and say why).

## Rules

1. Everything in `prompts/m-desk-routes.md` "Rules" 1–12 holds (additive only, invariants, security,
   reproduce-first, tests, no push, commits by name, helpers ≤ 2, safe state), with these changes:
   your branch is `feat/m-desk-3`; your test database is **`tvashtr_gate_desk3`** (created on the
   Postgres server in `.env`'s `DATABASE_URL`, migrated to `0053`); time box **3 hours**.
2. **No live stack, no Desktop app, no subscription use.** The video filming session (V1) holds
   :8000, :5173 and the one Tvashtr Desktop, with its window recording on screen. Never start
   anything on those ports, never launch Electron, never touch `~/Library/Application Support/
   tvashtr-desktop/`. Your visible proof is the design-parity harness (see Acceptance 4), on its
   own Vite port (5199 or any free port above 5190) — check the port is free first.
3. **Invariants (prove each):** `team_run.py` byte-identical to `e30b8bd9` (blob `94eda1bb9fbb`) and the
   DBOS application version unchanged (`3011d7ac…`); `desktop/electron/runner/runner.cjs` unchanged
   (`15e977ad71f2`); `EngineAdapter.run()` unchanged; `desktop/` diff 0 lines; migrations
   `0001`–`0053` untouched; no assertion or expect line removed (grep against `2b4b87fb`).
4. **Reproduce-first**, shown failing on `2b4b87fb`, then passing: (k) the versions read with
   `?desktop_target=1` gives each `check_sets` entry `desktop` over both versions' models (all
   routed / mixed), and the website read has none; (l) a Desktop set compare whose lanes shared a
   subscription carries `shared` in its results, and a website one doesn't; (m) FE: each G2 string
   shows its Desktop variant only when every model is routed, and the website text is
   byte-identical.
5. **Parallel rules:** work only in your worktree; never edit, run or stop anything in the main
   checkout (you may read this brief, `m-desk-2.md`, `m-desk-routes.md`, `video-v1.md` and
   CLI-RULES there, and load its `.env` per command with `DATABASE_URL` overridden to your
   database; never copy, print or edit `.env`). Your ledger is `STATE.md` in YOUR worktree (never
   commit it).

## Acceptance (echo each as it completes)

1. The boards of G3 published (canvas + version for each).
2. Reproduce-first (k)–(m) failing on `2b4b87fb`, then passing.
3. Gates: `make test` on `tvashtr_gate_desk3` ≥ 3480 passed / 1 xfailed; vitest ≥ 266 files / 2717;
   `tsc -b`; the build; desktop tests 143/0; `make lint` clean on every changed file; the owner
   sweep.
4. **Visible proof** with the design-parity harness (`scripts/design-parity/`, the real frontend
   answering `/api` from fixtures, `desktop: true`): add Desktop scenarios beside the existing
   task-set ones for the save dialog with both checks ticked and for the task-set results; shoot
   them and the two new boards; `parity.py` reports **zero size/type drift** on matched items; one
   screenshot per string (Desktop variant) plus one of the website variant unchanged.
5. The G4 sweep table.
6. Invariants: each item of rule 3 with its proof.
7. Then `DIFF:` `git diff --stat 2b4b87fb...feat/m-desk-3`; `READY_TO_MERGE feat/m-desk-3 <sha>`; the
   eight-section FINAL REPORT (CLI-RULES §4.7), listing every board added or changed.

## Stop with NEEDS_HUMAN (in STATE.md and echoed in chat, with the FINAL REPORT) when

- a fix would need `team_run.py` changed, the Desktop runner changed, or a live stack/Desktop run;
- a board can't be published;
- a second, unknown problem needs a broad or unproven change.

A contained, proven fix with a regression test may proceed.
