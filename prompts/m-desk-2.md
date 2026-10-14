# Brief — M-desk-2: the last Desktop key paths, and copy that tells the truth on the Desktop

Architect: Tvashtr Sidechat-20, 2026-10-03 (operator: "Proceed"). Path:
`/Users/adimac/Desktop/Tvashtr/prompts/m-desk-2.md`. `prompts/` is untracked: never commit it. Where
this brief and `prompts/CLI-RULES.md` differ, this brief wins (CLI-RULES' numbers are out of date).
Read `prompts/m-desk-routes.md` too: its rulings D1–D7, rules and parallel rules still hold unless
this brief says otherwise. This step finishes M-desk-routes; the two ship together afterwards.

## Why

M-desk-routes (`feat/m-desk-routes` @ `6bc7720a`, audited: pass) made Compare, task sets, agent tests
and Ask run on the owner's Claude and Grok sign-ins in Tvashtr Desktop. The audit found two gaps,
both on screens the demo film will show on the Desktop:

1. **Saving a version still uses API keys on the Desktop.** `POST /api/teams/{team_id}/versions`
   (`routers.save_team_version`) can start agent tests (`run_tests` → `agent_test_runner.start`) and
   a task-set check (`check_set` → `compare.create`). Neither carries `desktop_target`, so a
   keyless Desktop user gets refusals there.
2. **The copy still says "on your keys" and "at the same time" on the Desktop**, where the work
   runs on the owner's subscriptions and Desktop compare lanes take turns:
   - `frontend/src/lib/agentTestsFormat.ts` — the Tests estimate box ("Replays only the Reviewer, on
     saved inputs. About $0.40 on your keys · 4 min.") and the New test footer ("Replaying costs
     about $0.07 on your keys");
   - `frontend/src/canvas/SaveNudgeDialog.tsx` — the save dialog ("About 4 min · about $0.40 on
     your keys. …");
   - `frontend/src/pages/compare/ComparePage.tsx` — both start estimates ("About $X on your keys ·
     about N min") and the start line "Both run at the same time on separate copies of the repo.";
   - `frontend/src/pages/compare/CompareView.tsx` — the results subtitle "Same task, same repo, at
     the same time" (it sits right above D3's "take turns" line).

**What the user gets:** in the Desktop app, saving a version with "Run tests" or "Save and check"
runs those agents on their Claude and Grok sign-ins, and every estimate and subtitle says what
really happens. The website is unchanged.

## Where things are

- Your branch `feat/m-desk-2` starts from **`feat/m-desk-routes` @ `6bc7720a`** (not `main`): create it
  in your worktree with `git switch -c feat/m-desk-2 feat/m-desk-routes` and confirm the sha. Alembic
  head `0053`; the freeze hook covers `0001`–`0053`. Floors (M-desk-routes' report): `make test`
  3470 passed / 1 xfailed; vitest 262 files / 2686; desktop 143/0.
- Push guard: `git config --get remote.origin.pushurl` must print
  `DISABLED-no-push-during-video-work`. Never unset it.
- M-desk-routes' pieces to reuse: `credential_gate.desktop_routed_subscriptions(...)` with
  `desktop_jobs.fresh_subscription_ids(owner)` (the routing decision), `agent_test_runner.start(...,
  desktop_target=True)`, `compare.create(..., desktop_target=True)`, the subscription display names
  in `engines/desktop_runner_adapter._DISPLAY` ("Claude", "Grok"), `isDesktopApp()` in the FE, and its
  live gate `desktop/scripts/live-desk-routes-gate.mjs`.

## Rulings (final)

- **E1 — Save paths.** `SaveVersionRequest` gains `desktop_target: bool = False` (additive). When true,
  `run_tests` starts each agent's tests with `desktop_target=True` and `check_set` starts the set
  compare with `desktop_target=True`. The FE sends it from the Desktop only (`isDesktopApp()`), from
  the save dialog's "Save" with tests ticked and from "Save and check". Everything else about saving
  (409s, the nudge, R6 "a test run never fails the save") is unchanged.
- **E2 — Copy that tells the truth on the Desktop.** The server decides routing exactly as runs do;
  the FE tells the server it is the Desktop (e.g. a `desktop_target=1` query parameter on the
  estimate reads, or the fields below computed only when the request says so — your choice, additive
  fields only). The rule: **on the Desktop, when every model an action would run is on a fresh
  subscription, the copy names the subscription instead of keys. Mixed, not fresh, or the website:
  today's text, unchanged.** Subscription names: "your Claude subscription", "your Grok
  subscription", "your Claude and Grok subscriptions". Exact strings:
  - Tests estimate box → "Replays only the Reviewer, on saved inputs, on your Claude subscription ·
    about 4 min." (the role, minutes and "AI checks are included." tail as today; no dollar figure).
  - New test footer → "Replaying runs on your Claude subscription".
  - Save dialog → "About 4 min on your Claude subscription. …" (the results tail as today).
  - Compare start estimates (both) → "On your Claude and Grok subscriptions · about N min".
  - Compare start line, **when the two versions share a subscription** → "Both run on separate copies
    of the repo, taking turns on your Claude subscription." (the sentence after it unchanged).
  - Compare results subtitle, **when the lanes shared a subscription** (M-desk-routes' `shared` rule)
    → "Same task, same repo, taking turns on your Desktop · …" (the rest of the line unchanged).
  This is an operator-approved correction of Desktop copy, not a removal: the website keeps every
  string, and no element is removed or moved.
- **E3 — Claude Design first.** Before code, draw each Desktop variant on the canvas where its screen
  was designed (read the canvas with your Artifact tool first and follow the Design type's
  instructions; never the main canvas): update `Cmp-ResultsDesktop` (Quality canvas
  https://claude.ai/artifact/SnnUUrHn3oPKgn11YJfcmz, the subtitle) and add, beside each original
  board, `Cmp-StartDesktop` (start line + estimate), `Test-EstimateDesktop` (estimate box + New test
  footer) and `Save-NudgeDesktop` (the save dialog — find the board the dialog was drawn on). Publish,
  then implement from the boards.
- **E4 — Out of scope.** Domains, memory notes and AI checks stay on keys (D7). No ship: no push, no
  deploy, no Neon, no Desktop tag. No migration expected; if one is truly needed it is `0054` plus the
  freeze bump as the last commit, and the FINAL REPORT says why.

## Rules

1. Everything in `prompts/m-desk-routes.md` "Rules" 1–12 holds (additive only, invariants, security,
   reproduce-first, tests, no push, commits by name, helpers ≤ 2, safe state), with these changes:
   your branch is `feat/m-desk-2`; your databases are **`tvashtr_gate_desk2`** (make test) and
   **`tvashtr_desk2`** (live stack), created on the Postgres server in `.env`'s `DATABASE_URL` and
   migrated to `0053`; time box **4 hours**.
2. **Invariants (prove each):** `team_run.py` byte-identical to `e30b8bd9` (blob `94eda1bb9fbb`) and the
   DBOS application version unchanged (`3011d7ac…`); `desktop/electron/runner/runner.cjs` unchanged
   (`15e977ad71f2`); `EngineAdapter.run()` unchanged; the one-job-per-provider rule unchanged (desktop
   runner tests unmodified); migrations `0001`–`0053` untouched; no assertion weakened (the same grep,
   against `feat/m-desk-routes`).
3. **Reproduce-first**, shown failing on `6bc7720a`, then passing: (g) a Desktop save with
   `run_tests` for a keyless account starts a `desktop_target` test run whose replay queues a
   `test_replay` job and resolves no key; (h) a Desktop "Save and check" creates a compare with a
   `compare_desktop_targets` row whose runs carry `desktop_target` + `desktop_subscriptions`; (i) the
   same two saves from the website keep the key path (no flag); (j) FE: each E2 string renders its
   Desktop variant only when every model is routed, and the website text is byte-identical.

## Parallel rules

Other sessions may be running on this Mac: the DBOS stall-sweep session in the main checkout
(`/Users/adimac/Desktop/Tvashtr`), and soon a video filming session. Work only in your worktree;
never edit, run or stop anything in the main checkout (you may read this brief, `m-desk-routes.md`
and CLI-RULES there, and load its `.env` per command with `DATABASE_URL` overridden to your own
database; never copy, print or edit `.env`). Before you start a stack or the Desktop app — and
before you drive anything — check who listens on :8000 and :5173 and that each listener's cwd is
YOUR worktree, and that no Tvashtr Electron runs from another folder. If anything else is there:
echo `LIVE_PROOF_WAITING`, re-check every 5 minutes (waiting doesn't count against your time box),
and never drive or stop it; after 6 hours of waiting, stop with NEEDS_HUMAN. Never touch
`~/Library/Application Support/tvashtr-desktop/` outside a throwaway Electron profile. Your ledger is
`STATE.md` in YOUR worktree (never commit it); ignore the main checkout's STATE.md.

## Acceptance (echo each as it completes)

1. The boards of E3 published (canvas + version for each).
2. Reproduce-first (g)–(j) failing on `6bc7720a`, then passing.
3. Gates: `make test` on `tvashtr_gate_desk2` ≥ 3470 passed / 1 xfailed; vitest ≥ 262 files / 2686;
   `tsc -b`; the build; desktop tests 143/0 (or more); `make lint` clean on every changed file; the
   owner sweep.
4. **Live proof** on your stack (`tvashtr_desk2`, seeded, NO anthropic/xai key on the account) with the
   real Desktop app — extend `live-desk-routes-gate.mjs` with new phases or add a sibling — one
   screenshot per check: (a) save v2 with "Run tests" ticked → the replay passes through a Desktop
   job; (b) "Save and check" on a one-task set → both lanes finish through the Desktop; (c) one
   screenshot of each E2 Desktop string as drawn on its board (Tests estimate box, New test footer,
   save dialog, Compare start line + estimate, Compare results subtitle). Budget: at most one setup
   run, one save with tests (one replay) and one save-and-check (two runs).
5. Invariants: each item of rule 2 with its proof.
6. Then `DIFF:` `git diff --stat feat/m-desk-routes...feat/m-desk-2`; `READY_TO_MERGE feat/m-desk-2
   <sha>`; the eight-section FINAL REPORT (CLI-RULES §4.7), listing every board added or changed and
   every PR opened on `trade_mcp`.

## Stop with NEEDS_HUMAN (in STATE.md and echoed in chat, with the FINAL REPORT) when

- a fix would need `team_run.py` changed or the one-job-per-provider rule relaxed;
- Claude or Grok isn't "Connected" on the Engines page, or a subscription usage cap is hit;
- a board can't be published;
- another session has held the stack or the Desktop for 6 hours while you wait;
- a second, unknown problem needs a broad or unproven change.

A contained, proven fix with a regression test may proceed.
