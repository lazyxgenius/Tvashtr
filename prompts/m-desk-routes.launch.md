# Launch package — M-desk-routes (as handed to the operator by Tvashtr Sidechat-19, 2026-10-03)

Brief: `prompts/m-desk-routes.md` (rulings D1–D7; D3 operator-approved). Runs IN PARALLEL with video
V0, in its own Code-tab worktree; its live proof waits until V0 has finished.

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `main` · worktree: **on** (V0 is using the main checkout)
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr. This session runs in the Claude desktop app's Code tab, in its OWN git worktree, in parallel with another session (video step V0) that is using the main checkout at /Users/adimac/Desktop/Tvashtr — never touch that checkout, its processes, ports 8000/5173 or its database. Read these fully, in order, and change no files yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-routes.md — the brief for this session, including its "Parallel rules". It wins wherever it differs from CLI-RULES.
2. /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
3. In your worktree: backend/tvashtr/engines/desktop_runner_adapter.py, backend/tvashtr/control_plane/desktop_jobs.py, backend/tvashtr/control_plane/compare.py, backend/tvashtr/control_plane/agent_test_runner.py, the ask_node route in backend/tvashtr/routers.py, desktop/electron/runner/runner.cjs and desktop/scripts/live-subscription-gate.mjs.

Then create your branch with `git switch -c feat/m-desk-routes main` and reply in at most 5 lines: your worktree path; your branch and its HEAD sha (it must be e30b8bd9); whether the push guard is on (git config --get remote.origin.pushurl); whether the Postgres server in .env's DATABASE_URL is reachable (host and port only, never the URL); and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Build milestone M-desk-routes exactly as /Users/adimac/Desktop/Tvashtr/prompts/m-desk-routes.md says: in Tvashtr Desktop, Compare, task sets, agent tests (incl. Test this agent) and Ask run on the owner's Claude and Grok subscriptions through the Desktop runner, while the website keeps API keys. Read the brief fully first and re-read it after any compaction or resume. Rulings D1–D7 are final.

You work IN PARALLEL with another session (video V0) that owns the main checkout. Follow the brief's parallel rules: your own worktree and branch feat/m-desk-routes from main (e30b8bd9); your own databases (tvashtr_gate_desk for make test, tvashtr_desk for your live stack); never touch the main checkout, V0's processes, ports 8000/5173 or the tvashtr database; run the live proof only after V0 has finished. No push (check the push guard is on), never force, .env read-only, no deploy, no Neon, no Fly secrets.

Hard rules: additive only (the website path of all five features unchanged); Claude Design first for D3's Work time label (board Cmp-ResultsDesktop on the Quality canvas); team_run.py byte-identical and the DBOS application version unchanged; EngineAdapter.run() unchanged; one new migration 0053, then bump the freeze hook; reproduce-first for every gap; owner scope and the owner sweep for every new route; never weaken an assertion; commit your own paths by name.

Echo as each completes: the reproduce-first tests (a)–(f) failing then passing; the website-unchanged tests; make test on tvashtr_gate_desk ≥ 3445 passed / 1 xfailed, vitest ≥ 258 files / 2669, tsc -b, the build, desktop tests, make lint, the owner sweep, alembic 0053 up/down/up; each invariant's proof; LIVE_PROOF_WAITING if V0 is still running; then the live Desktop proof (Ask, a test from a round, a compare showing Work time) with a screenshot per check and no anthropic/xai key held; DIFF (git diff --stat main...feat/m-desk-routes); READY_TO_MERGE feat/m-desk-routes <sha>; and the eight-section FINAL REPORT of CLI-RULES §4.7 (every board added, every trade_mcp PR opened). Leave the safe state: nothing running from your worktree, branch committed.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to your worktree's STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
