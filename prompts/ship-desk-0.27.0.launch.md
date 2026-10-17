# Launch package — ship M-desk-8 (Desktop 0.27.0 + Fly deploy), handed to the operator by Tvashtr Sidechat-24, 2026-10-16

Brief: `prompts/ship-desk-0.27.0.md`. Main checkout, auto mode.

## 0. Before you start (plain Terminal) — DO THIS FIRST, the last ship stopped on it

```
cd /Users/adimac/Desktop/Tvashtr
git config --local --unset remote.origin.pushurl; git config --get remote.origin.pushurl; echo "rc=$?"
fly auth login
fly auth whoami
lsof -nP -iTCP:8000 -sTCP:LISTEN; lsof -nP -iTCP:5173 -sTCP:LISTEN; echo ports-checked
```
Expect: `rc=1` (no guard), your Fly email, nothing before `ports-checked`. Docker Desktop open; Mac on
power; stay reachable for the approval line. After the ship: put the guard back —
`git config --local remote.origin.pushurl DISABLED-no-push-during-video-work`.

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus.

## 2. Init prompt
```
You are the ship agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode. It builds nothing: it bumps the Desktop version, runs the gates, pushes main, and ships to production only on my pasted approval. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/ship-desk-0.27.0.md — the brief for this session; it wins wherever it differs from the others.
2. prompts/ship-desk-bundle.md — the previous ship's brief (the template).
3. prompts/m1-m11.md §6 (Ship Protocol) and §7 (invariants).
4. prompts/CLI-RULES.md — the working discipline and the §4.7 final report.
5. The end of STATE.md.

Then reply in at most 6 lines: main's and origin/main's shas after git fetch origin; what git config --get remote.origin.pushurl prints (it should print nothing); whether fly auth whoami answers and fly status -a tvashtr's current release; whether Docker is running and :8000/:5173 are free; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/ship-desk-0.27.0.md exactly, step by step: preflight (origin/main 938dbde6, main c90e2e96, push guard unset, Fly signed in); bump the Desktop to 0.27.0 on ship/desktop-0.27.0; every gate and invariant green on that commit with its decisive line (no migration, team_run.py and grokLock.cjs unchanged, app versions 3011d7ac/c7320dd5); PUSH_SCAN 0 hits, video/fixtures/live-base.json included; fast-forward main and push only main; the drain check; then post the SHIP REQUEST with the filled approval line and wait for me to paste it back. On that approval only: the drain re-check, fly deploy (alembic stays at 0053; no Neon snapshot), the full smoke (roll back to v45's image if it fails), then tag and push desktop-v0.27.0 and verify the released DMG (0.27.0, the live JS asset, grokLock.cjs inside).

Rules: auto mode; production steps only on my approval naming this sha; push only main and the tag; never force, reset --hard or rebase; no Fly secrets changes; .env fenced; nothing secret printed; production read-only; never touch tvashtr_film.

Echo every evidence line the brief lists as it completes, then SHIPPED: …, and the eight-section FINAL REPORT (CLI-RULES §4.7) with the ship table, ending with the push-guard line for me. Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names (origin or main moved, the guard still set, Fly signed out, a gate failing for a product reason after three attempts, a PUSH_SCAN hit, runs still active after 30 minutes, a failed smoke after the rollback, a blocked production step): write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
