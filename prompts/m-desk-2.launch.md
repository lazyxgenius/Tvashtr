# Launch package — M-desk-2 (as handed to the operator by Tvashtr Sidechat-20, 2026-10-03)

Brief: `prompts/m-desk-2.md` (rulings E1–E4; builds on `feat/m-desk-routes` @ `6bc7720a`). Runs in its
own Code-tab worktree, in parallel with whatever holds the main checkout; its live proof waits while
any other stack or Desktop app runs.

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `feat/m-desk-routes` · worktree: **on**
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr. This session runs in the Claude desktop app's Code tab, in its OWN git worktree. Other sessions may be running on this Mac — one in the main checkout at /Users/adimac/Desktop/Tvashtr, and possibly a video filming session — never touch the main checkout, other sessions' processes, their stacks on ports 8000/5173, their databases or their Desktop app. Read these fully, in order, and change no files yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-2.md — the brief for this session, including its "Parallel rules". It wins wherever it differs from the others.
2. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-routes.md — the step this one finishes; its rulings D1–D7 and rules still hold unless m-desk-2.md says otherwise.
3. /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
4. In your worktree: save_team_version in backend/tvashtr/routers.py, backend/tvashtr/control_plane/agent_tests.py (the nudge and estimates), frontend/src/lib/agentTestsFormat.ts, frontend/src/canvas/SaveNudgeDialog.tsx, frontend/src/pages/compare/ComparePage.tsx, frontend/src/pages/compare/CompareView.tsx and desktop/scripts/live-desk-routes-gate.mjs.

Then create your branch with `git switch -c feat/m-desk-2 feat/m-desk-routes` and reply in at most 5 lines: your worktree path; your branch and its HEAD sha (it must be 6bc7720a); whether the push guard is on (git config --get remote.origin.pushurl); whether the Postgres server in .env's DATABASE_URL is reachable (host and port only, never the URL); and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Build M-desk-2 exactly as /Users/adimac/Desktop/Tvashtr/prompts/m-desk-2.md says: in Tvashtr Desktop, saving a version with "Run tests" or "Save and check" runs those agents on the owner's Claude and Grok subscriptions, and the Tests, Save and Compare copy names the subscription instead of "on your keys" / "at the same time" when every model runs on one. The website stays exactly as it is. Read the brief (and m-desk-routes.md, which still holds) fully first, and re-read it after any compaction or resume. Rulings E1–E4 are final.

Work in your own worktree on branch feat/m-desk-2 from feat/m-desk-routes (6bc7720a), with your own databases (tvashtr_gate_desk2 for make test, tvashtr_desk2 for your live stack). Other sessions may run on this Mac: follow the brief's parallel rules — check every listener's cwd before starting or driving anything; if another stack or Desktop app is running, echo LIVE_PROOF_WAITING and re-check every 5 minutes; never drive or stop it. No push (check the push guard is on), never force, .env read-only (inline, with DATABASE_URL overridden), no deploy, no Neon, no Fly secrets.

Hard rules: additive only; Claude Design first (update Cmp-ResultsDesktop; add Cmp-StartDesktop, Test-EstimateDesktop, Save-NudgeDesktop beside their originals; never the main canvas); team_run.py byte-identical and the DBOS application version unchanged; runner.cjs and EngineAdapter.run() unchanged; the one-job-per-provider rule unchanged; no migration expected (if truly needed: 0054, then the freeze bump, and say why); reproduce-first for every gap; owner scope for anything new; never weaken an assertion; commit your own paths by name.

Echo as each completes: the boards published; reproduce-first (g)–(j) failing on 6bc7720a then passing; make test on tvashtr_gate_desk2 ≥ 3470 passed / 1 xfailed, vitest ≥ 262 files / 2686, tsc -b, the build, desktop tests, make lint on changed files, the owner sweep; each invariant's proof; LIVE_PROOF_WAITING if another session holds the stack; then the live Desktop proof with no anthropic/xai key held, a screenshot per check (save with tests → replay through the Desktop; Save and check on a one-task set → both lanes through the Desktop; each Desktop string as drawn); DIFF (git diff --stat feat/m-desk-routes...feat/m-desk-2); READY_TO_MERGE feat/m-desk-2 <sha>; and the eight-section FINAL REPORT of CLI-RULES §4.7 (every board added or changed, every trade_mcp PR opened). Leave the safe state: nothing running from your worktree, branch committed.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to your worktree's STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
