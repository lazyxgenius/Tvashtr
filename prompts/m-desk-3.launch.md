# Launch package — M-desk-3 (as handed to the operator by Tvashtr Sidechat-21, 2026-10-03)

Brief: `prompts/m-desk-3.md`. Runs in its own worktree, in parallel with video V1 (it never uses
:8000, :5173 or the Desktop app).

## 1. Start the session (Claude desktop app → Code tab)

- **+ New session** → **Local** → folder `/Users/adimac/Desktop/Tvashtr`
- Branch: `main` · worktree: **on**
- Mode: **Auto** (if Auto isn't listed: **Bypass permissions**)
- Model: **Opus**

## 2. Init prompt

```
You are the implementation agent for Tvashtr (/Users/adimac/Desktop/Tvashtr), working in your own git worktree. Read these fully, in order, and change nothing yet:
1. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-3.md — the brief for this session. It wins wherever it differs from CLI-RULES.
2. /Users/adimac/Desktop/Tvashtr/prompts/m-desk-2.md and /Users/adimac/Desktop/Tvashtr/prompts/m-desk-routes.md — the rulings and rules this step builds on.
3. /Users/adimac/Desktop/Tvashtr/prompts/CLI-RULES.md — for the working discipline and the §4.7 final report (its numbers and milestone list are out of date).
4. In your worktree: frontend/src/canvas/SaveNudgeDialog.tsx, frontend/src/pages/compare/CompareView.tsx (SetResults), backend/tvashtr/control_plane/task_sets.py (check_sets), and scripts/design-parity/README.md with scenarios/task-sets.mjs.

Another session (the video filming) owns :8000, :5173 and the Tvashtr Desktop app: never start anything on those ports and never launch Electron.

Then reply in at most 5 lines: your worktree path and branch; main's sha (it must contain 2b4b87fb); the push guard (git config --get remote.origin.pushurl); whether node_modules and the backend venv exist in your worktree; and the first thing you'll do. Then STOP and wait for my /goal.

When the /goal arrives, use the superpowers skills where they help (writing-plans, test-driven-development, systematic-debugging, verification-before-completion). The brief's order, rules and gates always win over any skill's own workflow.
```

## 3. /goal

```
/goal Deliver M-desk-3 exactly as /Users/adimac/Desktop/Tvashtr/prompts/m-desk-3.md says, on branch feat/m-desk-3 from 2b4b87fb in your own worktree. Read the brief fully first and re-read it after any compaction or resume. Additive only; no push (the guard must already be on); never force; .env fenced (load per command, DATABASE_URL overridden to tvashtr_gate_desk3); no live stack, no Electron, nothing on :8000 or :5173 — the video session owns them.

Deliver and echo, in order: (1) the two boards of G3 published on the Quality canvas, with canvas and version; (2) reproduce-first (k)–(m) shown failing on 2b4b87fb, then passing; (3) the gates: make test ≥ 3480 passed / 1 xfailed, vitest ≥ 266 files / 2717, tsc -b, the build, desktop 143/0, make lint clean on every changed file, the owner sweep; (4) the visible proof through the design-parity harness on its own port, with zero size/type drift against the boards and one screenshot per string; (5) the G4 sweep table; (6) each invariant with its proof.

Then echo DIFF (git diff --stat 2b4b87fb...feat/m-desk-3), READY_TO_MERGE feat/m-desk-3 <sha>, and the eight-section FINAL REPORT of CLI-RULES §4.7. Leave the safe state: nothing running, everything committed, the worktree clean apart from STATE.md and artifacts.

Done when all of that is in this chat. Also done, as a valid stop, on a blocker the brief names: write NEEDS_HUMAN: <reason> to STATE.md, echo it here with the FINAL REPORT, and leave the safe state. Never call anything done without its evidence in this chat.
```
