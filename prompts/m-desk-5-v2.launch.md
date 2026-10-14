# Launch package — M-desk-5 + video V2 (handed to the operator by Tvashtr Sidechat-22, 2026-10-11)

Brief: `prompts/m-desk-5-v2.md`. One session, main checkout, two branches (`feat/m-desk-5` from
`main` `1bf725be`, then `video/v2-runs` from `feat/m-desk-5`'s tip).

## 0. Before you start (plain Terminal, not inside the Claude app)

1. `claude auth status` → `"loggedIn": true` (else `claude auth login`).
2. `cd /Users/adimac/Desktop/Tvashtr && node video/camera/github-login.mjs` → sign in to GitHub in
   the window that opens, close it; it prints `saved video/out/github-session.json` (for scene 0.1;
   the session deletes the file after filming 0.1).
3. Docker Desktop open; Mac on power; Tvashtr Desktop closed; nothing on :8000 / :5173.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout. It does two things in order: a product fix (M-desk-5), then the demo film's real runs (video V2). Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-5-v2.md — the brief for this session. It wins wherever it differs from CLI-RULES or the V1 brief.
2. prompts/video-v1.md — the film's rules, camera and storyboard (its budget and F10 table are replaced by the new brief).
3. video/SCENES.md and video/README.md — every scene's script and status, and how the camera works.
4. prompts/CLI-RULES.md — the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
5. prompts/m-desk-4.md — the money and time rulings (H1–H8) that Part A's L1 and Part B's live smoke check.
6. The end of STATE.md.
7. backend/tvashtr/control_plane/desktop_jobs.py (ran_on and the helpers after it), backend/tvashtr/engines/desktop_runner_adapter.py, backend/tvashtr/control_plane/node_skills.py (_resolve_repo), and get_run_diff in backend/tvashtr/routers.py.

Then reply in at most 6 lines: main's sha and the current branch; the push guard (git config --get remote.origin.pushurl); whether Docker is running and whether anything listens on :8000 or :5173; whether video/out/github-session.json exists (yes or no only — never open it); and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, systematic-debugging, test-driven-development, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/m-desk-5-v2.md exactly, in its order: Part A (M-desk-5) on feat/m-desk-5 from main 1bf725be, then Part B (video V2) on video/v2-runs from feat/m-desk-5's tip. Read the brief fully first; re-read it and the end of STATE.md after any compaction or resume. READING_KEY = none.

Part A: fix L1–L4 per the rulings — each reproduced failing on 1bf725be first, then passing, with real rows; the Claude Design board for L3's new state before code; all gates green; invariants proven (team_run.py 94eda1bb9fbb, DBOS app versions 3011d7ac/c7320dd5 unchanged, no migration, claim_next unchanged, no asserts removed, website 0 px); one live Desktop run on tvashtr_desk5 proving L1–L4 with screenshots you open; echo READY_TO_MERGE feat/m-desk-5 <sha>, then go straight to Part B. L1 must pass before Part B starts.

Part B: the four sittings and the re-takes on tvashtr_film after video/stack/reset — the hero run recorded live and replayed for 3.2–3.6, then 3.7, 0.1 (then delete video/out/github-session.json), 4.1/4.2, 5.1, 6.1, 6.2 live with real version numbers, 6.3 compare + task set + Restore; every SMOKE line of the live smoke with a screenshot you open; the v2 contact sheet and the chapter 3–6 previews; video/SCENES.md (V2 status, real numbers and bends, What V3 needs) and video/README.md updated. Only video/** and .gitignore change in Part B; no product code.

Rules: no push (the guard must be on), never force or reset --hard, never merge into main, .env fenced, no secret printed, recorded or committed, one stack and one Desktop. Budget: Part A ≤ 2 real runs; Part B ≤ 12 real runs, ≤ 12 test replays, ≤ 2 Asks; keep a ledger.

Echo every evidence line the brief lists as it completes, then RUNS_USED, DIFF_A, DIFF_B, PRS, READY_TO_MERGE video/v2-runs <sha>, and the eight-section FINAL REPORT (CLI-RULES §4.7) covering both parts. Leave the safe state: nothing running, branches committed, checkout on main.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (a usage cap, an expired sign-in, L1 unfixable, a needed team_run.py/DBOS/migration/SDK change, any SMOKE FAIL at the end): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
