# Launch package — M-desk-8 + V2b second sitting (handed to the operator by Tvashtr Sidechat-23, 2026-10-15)

Brief: `prompts/m-desk-8-v2b2.md`. Main checkout; `feat/m-desk-8` from `main` `938dbde6`, then the
existing `video/v2b-refilm`.

## 0. Before you start (plain Terminal)
1. `claude auth status` → `"loggedIn": true`.
2. `grok -p "reply with ok"` → `ok`.
3. `cd /Users/adimac/Desktop/Tvashtr && node video/camera/github-login.mjs` → sign in to GitHub in the window, close it; it prints `saved video/out/github-session.json`.
4. Docker Desktop open; Mac on power; `lsof -nP -iTCP:8000 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN` prints nothing. (Your installed Tvashtr app may stay open.)

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout. It does two things in order: a product change (M-desk-8: lock Grok's own ~/.grok folder for Desktop jobs, plus six on-camera fixes), then the demo film's second V2b sitting (the rest of the film, with the Reviewer on Claude). Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-8-v2b2.md — the brief for this session. It wins wherever it differs from CLI-RULES or the older briefs.
2. prompts/m-desk-7-v2b.md — S4 and V2b's decisions K1–K7 (they carry over unless the new brief changes them).
3. prompts/m-desk-5-v2.md — Part B only: the film decisions G1–G9 and the live smoke.
4. prompts/video-v1.md — the film's rules, camera and storyboard.
5. video/SCENES.md and video/README.md as they are on video/v2b-refilm (read them with git show video/v2b-refilm:<path>; the checkout is on main).
6. prompts/CLI-RULES.md — the working discipline and the §4.7 final report.
7. The end of STATE.md.
8. desktop/electron/runner/grokLock.cjs and runner.cjs; frontend/src/lib/nodeNames.ts.

Then reply in at most 6 lines: main's sha and the current branch; the push guard (git config --get remote.origin.pushurl); grok --version and claude --version; whether Docker is running and whether anything listens on :8000 or :5173; whether video/out/github-session.json exists (yes or no only — never open it); and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, test-driven-development, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/m-desk-8-v2b2.md exactly, in its order: Part A (M-desk-8: S4b and P1–P6) on feat/m-desk-8 from main 938dbde6, then Part B (V2b's second sitting) on the existing video/v2b-refilm after merging feat/m-desk-8 into it with --no-ff. Read the brief fully first; re-read it and the end of STATE.md after any compaction or resume.

Part A: S4b — a Grok job may write only its own session folder (and what probes prove it must) inside ~/.grok; the must-hold items (settings, sandbox profiles, hooks, skills, plugins, MCP settings, the program folder) are denied, or copied and restored with the brief's exact stop message; sign-in and settings reads denied where Grok still starts and signs in, else reported with the honest log line. Reproduce first (S4B_RED), then S4B_GREEN; never open, edit or delete an existing ~/.grok file, never print contents, create only tvashtr-s4b-probe* files and delete them. P1–P6 each reproduced failing on 938dbde6, then passing; boards before code. All gates green; invariants proven (team_run 9a22d313d5c9, app versions 3011d7ac/c7320dd5, no migration, claim_next and Claude's arguments unchanged, no asserts removed, website 0 px outside P1–P6); one live proof on tvashtr_desk8 with screenshots you open; clean up what you created; echo READY_TO_MERGE feat/m-desk-8 <sha>, then go straight to Part B. S4b's must-hold writes must be closed before Part B starts.

Part B: the Reviewer on the strongest Claude model the picker offers that differs from the Engineer's (K8, probed once); chapter 6 on a fresh film team with an off-camera seed run (K9), then 6.1, 6.2 (v2), 6.3 + 6.3-set unattended; 3.5; chapters 2 and 7; 0.1 on PR #57, then delete video/out/github-session.json; every SMOKE line with a screenshot you open; the contact sheet and ch2–ch7 previews; video/SCENES.md and video/README.md. No Grok job in Part B; no product code in Part B's own commits.

Rules: no push (the guard must be on), never force or reset --hard, never merge into main, .env fenced, no secret printed, recorded or committed, one stack and one Desktop, delete only what you created. Budget: Part A ≤ 8 Grok CLI probes and ≤ 2 real runs; Part B ≤ 2 Claude CLI probes, ≤ 10 real runs, ≤ 12 test replays, ≤ 1 Ask; keep the ledger.

Echo every evidence line the brief lists as it completes, then RUNS_USED, DIFF_A, DIFF_B, PRS, READY_TO_MERGE video/v2b-refilm <sha>, and the eight-section FINAL REPORT (CLI-RULES §4.7) covering both parts. Leave the safe state: nothing running, branches committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (a usage cap, an expired sign-in, S4b's must-hold writes not closable, a needed team_run.py/DBOS/migration/SDK change, an unpublishable board, any SMOKE FAIL at the end): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
