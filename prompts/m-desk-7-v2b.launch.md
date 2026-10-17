# Launch package — M-desk-7 + video V2b (handed to the operator by Tvashtr Sidechat-23, 2026-10-14)

Brief: `prompts/m-desk-7-v2b.md`. One session, main checkout, two branches (`feat/m-desk-7` from
`main` `69d5a5b9`, then `video/v2b-refilm` from `feat/m-desk-7`'s tip).

## 0. Before you start (plain Terminal, not inside the Claude app)

1. `claude auth status` → `"loggedIn": true` (else `claude auth login`).
2. `grok models | head -3` → a list of models (not a sign-in error; else `grok login`).
3. `cd /Users/adimac/Desktop/Tvashtr && node video/camera/github-login.mjs` → sign in to GitHub in the
   window that opens, close it; it prints `saved video/out/github-session.json` (for 0.1; the session
   deletes it after filming 0.1).
4. Docker Desktop open; Mac on power; Tvashtr Desktop closed;
   `lsof -nP -iTCP:8000 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN` prints nothing.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout. It does two things in order: a product change (M-desk-7: lock the Grok CLI to its job's copy, plus two on-camera fixes), then the demo film's re-film with the Tests check (video V2b). Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-7-v2b.md — the brief for this session. It wins wherever it differs from CLI-RULES or the older briefs.
2. prompts/m-desk-6.md — the Tests check (T1), T2, S1–S4.
3. prompts/m-desk-5-v2.md — Part B only: V2's film decisions G1–G9, its sittings and its live smoke (they carry over).
4. prompts/video-v1.md — the film's rules, camera and storyboard.
5. video/SCENES.md and video/README.md — every scene's script and status, and how the camera works.
6. prompts/CLI-RULES.md — the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
7. The end of STATE.md.
8. desktop/electron/runner/cliCommand.cjs, runner.cjs and workspace.cjs; desktop/electron/main.cjs (workRoot); frontend/src/panel/legacy/GateBody.tsx; video/camera/film.mjs (buildFilmTeam) and video/camera/scenes/2.4.mjs.

Then reply in at most 6 lines: main's sha and the current branch; the push guard (git config --get remote.origin.pushurl); grok --version; whether Docker is running and whether anything listens on :8000 or :5173; whether video/out/github-session.json exists (yes or no only — never open it); and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, test-driven-development, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/m-desk-7-v2b.md exactly, in its order: Part A (M-desk-7: S4, F1, F2) on feat/m-desk-7 from main 69d5a5b9, then Part B (video V2b, the re-film with the Tests check) on video/v2b-refilm from feat/m-desk-7's tip. Read the brief fully first; re-read it and the end of STATE.md after any compaction or resume. READING_KEY = none.

Part A: S4 — Grok locked to its job's copy by its own kernel sandbox, through a profile Tvashtr writes per job (extends workspace + a deny list; never the user's ~/.grok files); the repo's own .grok/ neutralised and restored byte-identical; fail closed with the brief's exact message; the two run-log lines. Reproduce first against the installed CLI with today's arguments (S4_RED), then S4_GREEN — probes record OPENED/REFUSED only, never contents. F1 and F2 reproduced failing on 69d5a5b9, then passing. Boards before code; all gates green; invariants proven (team_run 9a22d313d5c9, app versions 3011d7ac/c7320dd5, no migration, claim_next and Claude's arguments unchanged, no asserts removed, website 0 px outside F1/F2); one live proof on tvashtr_desk7 with the hostile probe repo and screenshots you open; canary, probe repo and tvashtr_desk7 removed; echo READY_TO_MERGE feat/m-desk-7 <sha>, then go straight to Part B. S4 must pass before Part B starts.

Part B: video/stack/reset; the film team with the Tests check (K1); the sittings in order — chapter 3 + 0.1 (the hero recorded and replayed; delete video/out/github-session.json after 0.1), chapter 4 (4.2 from Needs you), 5.1, 6.1, 6.2 (v2), 6.3 unattended, then the chapter 2 and 7 re-takes; every SMOKE line with a screenshot you open; the v2b contact sheet and the ch2–ch7 previews; video/SCENES.md (V2b status, real numbers, bends, What V3 needs) and video/README.md. Only video/** and .gitignore change in Part B; no product code.

Rules: no push (the guard must be on), never force or reset --hard, never merge into main, .env fenced, no secret printed, recorded or committed, never open CLI credential files or ~/.grok config, one stack and one Desktop, delete only what you created. Budget: Part A ≤ 6 Grok CLI probes and ≤ 2 real runs; Part B ≤ 14 real runs, ≤ 12 test replays, ≤ 2 Asks; keep a ledger.

Echo every evidence line the brief lists as it completes, then RUNS_USED, DIFF_A, DIFF_B, PRS, READY_TO_MERGE video/v2b-refilm <sha>, and the eight-section FINAL REPORT (CLI-RULES §4.7) covering both parts, with the xAI report draft. Leave the safe state: nothing running, branches committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (a usage cap, an expired sign-in, S4 not workable, a needed team_run.py/DBOS/migration/SDK change, an unpublishable board, any SMOKE FAIL at the end): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
