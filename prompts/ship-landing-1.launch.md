# Launch package — Ship landing-1 (handed to the operator by Tvashtr Sidechat-26, 2026-10-31)

Brief: `prompts/ship-landing-1.md`. Code tab in `/Users/adimac/Desktop/Tvashtr`, auto mode, Sonnet 5.5 · High.

## 0. Terminal (operator, before launch)
```
cd /Users/adimac/Desktop/Tvashtr
git config --local --unset remote.origin.pushurl
fly auth login
```

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Sonnet 5.5 · effort High.

## 2. Init prompt
```
You are the Tvashtr ship agent for landing-1. This session runs in the Claude desktop app's Code tab, in /Users/adimac/Desktop/Tvashtr, in auto mode. It builds nothing: it gates main, pushes it, and deploys it to Fly on my approval. Read these fully, in order, and change nothing yet:
1. prompts/ship-landing-1.md — the brief; it wins wherever it differs.
2. prompts/ship-desk-0.27.0.md — the last ship's brief, the template.
3. prompts/m1-m11.md §6 — the Ship Protocol.
4. prompts/CLI-RULES.md §4.7 — the final report.

Now reply in at most 6 lines: main and origin/main shas (expect 8cf90334 and 6b35addc), whether the push guard is unset and fly auth whoami answers (don't print secrets), whether Docker is up and ports 8000/5173 are free, and the first gate you'll run. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Ship main 8cf90334 to production per prompts/ship-landing-1.md: the new landing page, Prune 1 and Film D1, as a Fly deploy only (no Desktop release, no tag, no Neon snapshot, no migration). In order: preflight → every gate in the brief's step 2 on 8cf90334 (make test on tvashtr_gate, vitest, tsc, build, desktop tests, docker build with the media files inside, make lint baseline, the e2e specs and make demo-proof, the invariants including the DBOS app versions, the binaries list and PUSH_SCAN) → drain check → Lighthouse on the live landing before → post the SHIP REQUEST with the exact approval line and wait.

On my pasted approval naming 8cf90334: re-check the drain, push main only, fly deploy, then every smoke in step 7 (health, deploy-smoke, logs, the JS asset and og tags, og.png and robots.txt, 206 byte ranges on both videos, the landing in Chromium and WebKit with both videos playing and no .mp4 before a press, the sign-in redirect's host, Lighthouse after, demo-proof-prod only if its session is valid). If a health, 5xx or page-error smoke fails, roll back to v46's image deployment-01M52DHZM26THGADX25RFFSG65, confirm health, and stop NEEDS_HUMAN.

Rules: auto mode; push only main, never force; never change git config or Fly secrets; .env fenced; never print a key, token, cookie or connection string; production data read-only (counts and ids only); tests never next to a running stack and never on tvashtr_film; three attempts per gate; I'm on the Claude Pro plan: no subagents or workflows, STATE.md updated after each step; time box 6 hours, not counting the wait for my approval.

Echo each evidence line from the brief as it completes, then SHIPPED: main=8cf90334 fly=v<N>, the eight-section FINAL REPORT (prompts/CLI-RULES.md §4.7) with a ship table, and the reminder to put the push guard back. Done when shipped with every smoke passing and all of that in this chat. Also done, as a valid stop, on any NEEDS_HUMAN the brief lists: write it to STATE.md, say it here with the FINAL REPORT, and stop.
```
