# Launch package — Prune 1 (handed to the operator by Tvashtr Sidechat-25, 2026-10-20)

Brief: `prompts/prune-1.md`. Main checkout, auto mode. Code edits only — nothing ships.

## 0. Before you start
- Terminal: `cd /Users/adimac/Desktop/Tvashtr && git config --get remote.origin.pushurl && git rev-parse --short HEAD` → `DISABLED-no-push-during-video-work` and `65d4b194`.
- Docker Desktop open; Mac on power; no other Code-tab session working in this folder.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the Prune 1 agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode. It deletes dead code, zombie routes and duplicated logic on a new branch chore/prune-1 — code edits only: no push, no deploy, no migration, and nothing a user sees changes. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/prune-1.md — the brief; it wins wherever it differs from the others.
2. prompts/CLI-RULES.md — the working discipline, the stop conditions and the §4.7 final report.
3. prompts/ship-desk-0.27.0.md, "Steps" item 3 only — how the last session ran the gates, the e2e specs and make demo-proof (this session ships nothing).
4. The end of STATE.md — how recent sessions computed the DBOS application versions and ran the gates.
5. backend/tests/test_owner_scope_guard.py and desktop/electron/runner/api.cjs — how routes are guarded, and which routes the Desktop's main process calls.

When you execute: use parallel subagents for the searches, and the superpowers skills where they fit (verification-before-completion before any "done", systematic-debugging when a gate fails).

Now reply in at most 6 lines: main's sha and the push guard's value; whether the tracked tree is clean; whether Docker runs and :8000/:5173 are free; the blobs of team_run.py, grokLock.cjs and spawnEnv.cjs; the @DBOS. decorator count under backend/tvashtr; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/prune-1.md: delete dead code, zombie routes and duplicates on a new branch chore/prune-1 from main 65d4b194 — code edits only, and nothing a user sees changes. In order: the baseline (every gate, the visible-text snapshot, the @DBOS. count, the DBOS app versions, the untracked-file list) → KEEP-LIST posted → Pass 1 dead code, in rounds until a round finds nothing new (max 4) → Pass 2 every route with its callers, old desktop-v* tags checked → Pass 3 duplicates merged (drifted copies listed, or fixed only with a regression test shown failing first) → Pass 4 the bundled /simplify on the branch diff (or its four-angle review by four subagents) → the gates on the final head → make demo-proof C1–C12 with a real PR, plus the Desktop live gate if any route or Desktop code changed.

No proof, no deletion: each deletion has a recorded zero-reference proof (git grep -nw across all tracked files, including out-of-scope folders and non-code files), no dynamic use, and is not on the keep list; anything unproven stays and is listed. One kind of change per area per commit, so each one reverts cleanly with git revert. Tests go only with the code they test.

Invariants, each with its proof: no change under backend/alembic, video, scripts/design-parity, docs, design, prompts, .claude, .github, fly.toml or Dockerfile; no package.json, lockfile, pyproject.toml or uv.lock change; team_run.py 9a22d313d5c9, grokLock.cjs 18fd231559de, spawnEnv.cjs 7834802de55f, build_two_node_team identical; the @DBOS. count equal and the app versions 3011d7ac…/c7320dd5… unchanged; no untracked file touched; the visible-text diff over every frontend route empty; asserts removed only with deleted code (listed).

Gates: make test on tvashtr_gate 0 failed (≥ 3555 minus listed removals); vitest ≥ 2776 minus listed; tsc; build; desktop ≥ 161 minus listed; make lint ≤ 38; e2e the same passes as the baseline (the 3 known fails unchanged, or deleted with proof).

Rules: auto mode; no push, deploy, tag, migration, force, reset --hard, stash, rebase or amend; never change git config; .env fenced; never open credential files or print secrets; tests never on tvashtr_film or next to a live stack; one stack, one Desktop; caffeinate -dimsu; three-attempt rule; time box 8 hours.

Echo every evidence line the brief lists as it completes (PREFLIGHT, BASELINE, KEEP-LIST, each DEAD-CODE round with its ledger, ROUTES with the table, DUPLICATES, SIMPLIFY, GATES, VISIBLE-TEXT, LIVE, INVARIANTS, NET), then READY_TO_MERGE chore/prune-1 <sha> and the eight-section FINAL REPORT (CLI-RULES §4.7), with section 7 listing what needs a ruling: OLD-CLIENT-ONLY routes, DRIFT groups, UNCALLED-SCRIPTs, unproven candidates, unused dependencies, and /simplify suggestions not applied. Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (main not 65d4b194, the push guard not the dummy, tracked changes at start, ports held, a failing gate that git revert of the responsible prune commit doesn't fix, an app-version change you can't trace, demo-proof or the Desktop gate failing for a product reason, an expired sign-in, a safeguards notice): write NEEDS_HUMAN: <reason> to STATE.md, echo it with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
