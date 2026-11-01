# Launch package — Ship Google Cloud 1 + Models 1 (handed to the operator by Tvashtr Sidechat-28, 2026-11-01)

Brief: `prompts/ship-models-1.md`. Main checkout, auto mode, one session (Claude Pro plan, Sonnet 5.5 high).

## 0. Before you start (Terminal, one at a time)
1. Commit the Sidechat-28 docs (HANDOVER.md, PROJECTPLAN.md, prompts/) — the exact commands are in HANDOVER.md §1.
2. `fly auth whoami` answers with your account (else `fly auth login`).
3. Unset the push guard: `git config --local --unset remote.origin.pushurl` — then `git config --get remote.origin.pushurl` prints nothing.
4. Docker Desktop open; Mac on power; no other Code-tab session in this folder.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Sonnet 5.5 · effort High.

## 2. Init prompt
```
You are the ship agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode, on the Claude Pro plan (Sonnet 5.5, high effort). It ships Google Cloud 1 + Models 1 to production: gates on main, a Neon snapshot, a drain, git push of main, fly deploy (with migration 0054) and the smoke — the production steps only after the operator's approval. It builds nothing. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/ship-models-1.md — the brief; it wins wherever it differs from the others.
2. prompts/CLI-RULES.md — the working discipline, the stop conditions and the §4.7 final report.
3. prompts/ship-landing-1.md and prompts/ship-desk-bundle.md (steps 1 and 7) — the last ship, and the last ship with a migration and a Neon snapshot.
4. The top of STATE.md — Models 1's and Google Cloud 1's entries and SHIP LANDING-1's (how the gates, the DBOS application versions and the drain were run).

Pro plan: one thing at a time, no subagents or workflows. Use the superpowers skills where they fit (systematic-debugging when a gate fails; verification-before-completion before any "done"). Write STATE.md after every step.

Now reply in at most 5 lines: main's and origin/main's shas and the docs commit's file list; whether the push guard is unset; fly whoami and the current release; the Neon branch count; whether .env has GOOGLE_CLOUD_API_KEY and DEEPSEEK_API_KEY (present/absent only — never a value). Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/ship-models-1.md: ship main (db8ab37f + the one docs commit) — Google Cloud 1 and Models 1 — to production: Fly app tvashtr, alembic 0053 → 0054, a new DBOS application version (drain first), no Desktop release.

In order, echoing each evidence line as it completes and writing it to STATE.md: PREFLIGHT → GATES on main (make test, vitest, tsc, build, desktop, docker, lint, the five e2e specs, make model-tests-e2e, the vertex_ai live run, make demo-proof C1–C12) → INVARIANTS → PUSH_SCAN → DRAIN → TOKEN-TIMING → SHIP REQUEST with the exact approval line, then WAIT. Act only on an approval naming this sha: NEON snapshot → DRAIN again → PUSH main → DEPLOY (alembic upgrade head to 0054) → SMOKE (health, deploy-smoke, every new /api/models route 401 without a session, logs clean 5 minutes, a DBOS sweep on the new fly version, the live JS asset = the local build, #/welcome #/signin and #/models with 0 page errors) → SHIPPED line.

Rules: auto mode; push only main — no other branch or tag, never force, reset --hard, rebase or amend, never change git config; .env fenced, never print a secret; production data read-only, counts and ids only; never delete a Neon branch; tests on tvashtr_gate only, never next to a running stack; one stack; three-attempt rule; time box 6 hours (the wait for approval doesn't count). If the smoke fails: deploy v47's image deployment-01M69AGBH5GE81KC66970B4GM4, confirm health, stop.

Done when SHIPPED: main=<sha> fly=v<N> alembic=0054 neon=<snapshot> and the eight-section FINAL REPORT (CLI-RULES §4.7) are in this chat, section 7 with the push-guard line and the operator's first-look script for production. Waiting for the approval is a valid pause: if re-prompted, say in one line that you're waiting for it. Also done, as a valid stop, on a blocker the brief names (shas not as stated, push guard set, Fly or Neon signed out, Neon at 9+ branches, a gate failing for a product reason after three attempts, a PUSH_SCAN hit outside the known list, an unlisted binary, runs still live after 30 minutes, a failed smoke after the rollback, a blocked production step): write NEEDS_HUMAN: <reason> to STATE.md, echo it with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
