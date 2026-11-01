# Launch package — Models 1: Model tests (handed to the operator by Tvashtr Sidechat-28, 2026-11-01; re-pointed to main 97aadec0 after Google Cloud 1)

Brief: `prompts/models-1.md`. Design: `prompts/models-1-design/`. Main checkout, auto mode, one session (Claude Pro plan).
Builds on a new branch `feat/models-1` — nothing ships.

## 0. Before you start
- Terminal: `cd /Users/adimac/Desktop/Tvashtr && git config --get remote.origin.pushurl && git rev-parse --short HEAD`
  → `DISABLED-no-push-during-video-work` and `97aadec0`.
- Docker Desktop open; Mac on power; no other Code-tab session working in this folder (close finished ones — keepwarm keeps them
  warm for hours).

## 1. Code tab
+ New session → Local → `/Users/adimac/Desktop/Tvashtr` · branch `main` · worktree off · Auto · Opus 5.5 · effort High.

## 2. Init prompt
```
You are the Models 1 agent for Tvashtr (/Users/adimac/Desktop/Tvashtr). This session runs in the Claude desktop app's Code tab, in the main checkout, in auto mode, on the Claude Pro plan (Opus 5.5, high effort). It builds milestone 1 of Tvashtr's new direction — Model tests: a Models area where a customer describes one job, writes versioned tests, runs them on the models they hold keys for with the cost shown first, and compares the results — on a new branch feat/models-1, with one new migration (0054). No push, no deploy. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/models-1.md — the brief; it wins wherever it differs from the others.
2. prompts/models-1-design/README.md, then each *.dc.html there with its *.png (open the pictures) — the approved design.
3. prompts/CLI-RULES.md — the working discipline, the stop conditions and the §4.7 final report.
4. backend/tvashtr/control_plane/domain_eval.py (the durable one-step-per-case runner to copy), control_plane/credentials.py, gateway/gateway.py, gateway/types.py, backend/tvashtr/google_cloud.py (Google Cloud 1's translation — model tests must price and run vertex_ai/ models through it), routes/domains.py, and backend/tests/test_owner_scope_guard.py.
5. frontend/src/pages/domains/ (DomainsListPage, DomainDetailPage, QualityTab, TestQuestionSheet, AnswerModelPicker, domainKeys), frontend/src/pages/shell/Shell.tsx, frontend/src/lib/nav.ts, frontend/src/pages/home/paletteItems.ts.
6. scripts/agent_tests_e2e.sh and frontend/e2e/_keys.ts — the live e2e pattern.
7. The top of STATE.md (SHIP LANDING-1) — the floors, how the DBOS application versions were computed, and how the gates were run.

Claude Pro: run one thing at a time, no ultracode or dynamic workflows, at most one subagent at a time. Use the superpowers skills where they fit (test-driven-development for the scorer, estimate and CSV parser; systematic-debugging when a gate fails; verification-before-completion before any "done"). Write STATE.md after every step, so a usage-limit pause resumes cleanly.

Now reply in at most 5 lines: main's sha and the push guard's value; whether the tracked tree is clean; whether Docker runs and :8000/:5173/:8024/:5197 are free; whether .env has GOOGLE_CLOUD_API_KEY and DEEPSEEK_API_KEY (present/absent only — never a value); the team_run.py blob and the @DBOS. count; and the first thing you'll do. Then STOP and wait for my /goal.
```

## 3. /goal
```
/goal Deliver /Users/adimac/Desktop/Tvashtr/prompts/models-1.md: milestone 1 of "build and improve your own models" — a Models area where a customer describes one job, writes versioned tests (exact match / must contain / AI judge), runs them on any model they hold a key for with the estimated cost shown first, and compares the results — built to the approved design in prompts/models-1-design/, on a new branch feat/models-1 from main 97aadec0, with one new migration 0054_model_tests. No push, deploy, Desktop release or Neon.

In order, echoing each evidence line the brief lists as it completes and writing it to STATE.md: PREFLIGHT → BASELINE → MIGRATION → SCORER-RED then SCORER-GREEN → PRICES → API + OWNER-SCOPE → WORKFLOW → FRONTEND + VITEST → SIGNOFF S1–S12 (S1–S7 compared side by side with the design PNGs; differences fixed or listed with the reason) → LIVE (make model-tests-e2e with real Google Cloud + DeepSeek calls; real scores, costs and estimate-vs-real echoed) → FREEZE (the hook bump to 0054, its own last commit) → GATES on the final head → INVARIANTS → DBOS-VERSIONS → NET.

Invariants, each with its proof: additive only — existing files change only from the brief's list, with no removed line except re-pointed menu assertions (listed); team_run.py 9a22d313d5c9; domain_eval.py and every file with @DBOS. on main byte-identical, the count 75 + only the new ones; gateway.py complete()/embed() byte-identical and no other module imports litellm; alembic adds only 0054; no package or lock file change; no key in any table, DBOS argument or result, or log (tested); untracked files and prompts/, design/, HANDOVER.md, PROJECTPLAN.md, STATE.md never staged.

Gates: make test on tvashtr_gate 0 failed, ≥ 3591 + new; vitest ≥ 2757 + new (the CompareView.tsx:96 unhandled error may remain, no new one); tsc; build; desktop 161; make lint: no new finding, the exit code may stay non-zero (ruff baseline 38); revamp-shell and domains e2e pass.

Rules: Claude Pro — Opus high, no ultracode or workflows, at most one subagent; STATE.md after every step so a usage pause resumes cleanly; auto mode; no push, deploy, tag, force, reset --hard, stash, rebase, amend or git-config change; .env fenced, never print secrets; tests never on tvashtr_film or next to a live stack; one stack at a time; caffeinate -dimsu; three-attempt rule; time box 12 working hours.

Done when every evidence line is in this chat, then READY_TO_MERGE feat/models-1 <sha> and the eight-section FINAL REPORT (CLI-RULES §4.7), section 7 listing what needs a ruling and that the ship must drain live runs (new DBOS app version). Also done, as a valid stop, on a blocker the brief names (main not 97aadec0, push guard not the dummy, tracked changes at start, a port held, an existing file outside the list must change, an unknown problem needing a broad change, a failing existing test not caused by this branch, a safeguards notice, GOOGLE_CLOUD_API_KEY or DEEPSEEK_API_KEY absent at LIVE): write NEEDS_HUMAN: <reason> to STATE.md, echo it with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
