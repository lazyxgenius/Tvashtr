# Launch package — M-desk-6 (handed to the operator by Tvashtr Sidechat-22, 2026-10-12)

Brief: `prompts/m-desk-6.md`. Main checkout, branch `feat/m-desk-6` from `main` `dac9afc4`.

## 0. Before you start (plain Terminal)
1. `claude auth status` → `"loggedIn": true` (else `claude auth login`).
2. Docker Desktop open; Mac on power; Tvashtr Desktop closed; nothing on :8000 / :5173; the
   M-desk-5 + V2 Code-tab session closed (it's finished).

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr), running in the Claude desktop app's Code tab in the main checkout. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-6.md — the brief for this session. It wins wherever it differs from CLI-RULES.
2. prompts/CLI-RULES.md — the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
3. The end of STATE.md.
4. backend/tvashtr/control_plane/guardrails.py, backend/tvashtr/control_plane/hidden_checks.py, the gate arm of backend/tvashtr/control_plane/team_run.py (search "elif kind == \"gate\""), backend/tvashtr/engines/desktop_runner_adapter.py, desktop/electron/runner/cliCommand.cjs, frontend/src/panel/legacy/GateBody.tsx and frontend/src/panel/RunDiff.tsx.

Then reply in at most 6 lines: main's sha and the current branch; the push guard (git config --get remote.origin.pushurl); whether Docker is running and whether anything listens on :8000 or :5173; the agent sandbox mode the local stack uses by default; and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, test-driven-development, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal
```
/goal Deliver M-desk-6 exactly as /Users/adimac/Desktop/Tvashtr/prompts/m-desk-6.md says, on branch feat/m-desk-6 from main dac9afc4. Read the brief fully first; re-read it and the end of STATE.md after any compaction or resume.

Claude Design boards first (the Gate type picker with "Tests pass" + Command, the check's canvas card, the run view's Tests states on Desktop and website, S3's never-pushed state, S1's Done screen at 1440×900), published before code. Then T1 (the tests_pass guardrail run by Tvashtr's own sandbox through the hidden-check runner; rejected lines become the next agent's rework feedback, a passed or couldn't-run line reaches its context; team_run.py only in its gate arm if at all, with the DBOS app versions reported), T2 (the Desktop file-tools-only line in every Desktop job), S1, S2, S3 reproduce-first, and S4 (confine the Grok CLI's reads if Grok Build documents a way; else report). All gates green; invariants proven; one live Desktop run on tvashtr_desk6 in the docker sandbox (PM → Engineer → Tests pass → Reviewer on Grok → Ship, "Add a TEMA indicator" on trade_mcp, scope core/) showing the Tests result in the run view, the Reviewer using it and no Escalation, with screenshots you open; at most 3 real runs.

Rules: no push (the guard must be on), never force or reset --hard, never merge into main, .env fenced, no secret printed, recorded or committed, one stack and one Desktop.

Echo every evidence line the brief lists as it completes, then RUNS_USED, DIFF, PRS, READY_TO_MERGE feat/m-desk-6 <sha>, and the eight-section FINAL REPORT (CLI-RULES §4.7). Leave the safe state: nothing running, the branch committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
