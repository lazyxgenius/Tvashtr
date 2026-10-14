# Launch package — M-desk-4 (as handed to the operator by Tvashtr Sidechat-21, 2026-10-10)

Brief: `prompts/m-desk-4.md` (work list `prompts/m-desk-4-sweep.md`). Runs in its own worktree, in
parallel with video V1 (it never uses :8000, :5173 or the Desktop app).

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `main` · worktree: **on**
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr), working in your own git worktree. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-4.md — the brief for this session. It wins wherever it differs from CLI-RULES.
2. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-4-sweep.md — your work list (rows S1–S3, D1–D23, K1–K8).
3. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-3.md, m-desk-2.md and m-desk-routes.md in the same folder — the rulings and rules this step builds on.
4. /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
5. In your worktree: scripts/design-parity/README.md and scenarios/task-sets.mjs (your visible-proof harness).

Another session (the video filming) owns :8000, :5173 and the Tvashtr Desktop app: never start anything on those ports and never launch Electron.

Then reply in at most 5 lines: your worktree path and branch; main's sha (it must contain 02488987); the push guard (git config --get remote.origin.pushurl); whether node_modules and the backend venv exist in your worktree; and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, test-driven-development, systematic-debugging, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Deliver M-desk-4 exactly as /Users/adimac/Desktop/Tvashtr/prompts/m-desk-4.md says, on branch feat/m-desk-4 from 02488987 in your own worktree, working through every row of prompts/m-desk-4-sweep.md. Read the brief fully first and re-read it after any compaction or resume. Additive only; website strings byte-identical; no push (the guard must already be on); never force; .env fenced (load per command, DATABASE_URL overridden to tvashtr_gate_desk4); no live stack, no Electron, nothing on :8000 or :5173 — the video session owns them.

Deliver and echo, in order: (1) the boards of H7 published, with canvas and version for each; (2) reproduce-first (n)–(q) shown failing on 02488987, then passing; (3) the gates: make test ≥ 3485 passed / 1 xfailed, vitest ≥ 268 files / 2732, tsc -b, the build, desktop 143/0, make lint clean on every changed file, the owner sweep ≥ 201; (4) the visible proof through the design-parity harness on its own port: zero size/type drift against the boards, one screenshot per changed string, website renders at 0 px diff; (5) the sweep table, one line per row: fixed or left true, and why; (6) each invariant with its proof.

Then echo DIFF (git diff --stat 02488987...feat/m-desk-4), READY_TO_MERGE feat/m-desk-4 <sha>, and the eight-section FINAL REPORT of CLI-RULES §4.7. Leave the safe state: nothing running, everything committed, the worktree clean apart from STATE.md and artifacts.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
