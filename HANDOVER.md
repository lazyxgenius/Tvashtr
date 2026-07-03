# HANDOVER — Tvashtr-44 → Tvashtr-45

> Read this FIRST, then the named `PROJECTPLAN.md` sections, then the relevant source on disk — evidence before design. You are the **architect/planner**; all implementation goes through Claude Code.

---

## 0. First message for the next chat
> You are Tvashtr-45. Read `HANDOVER.md` and `PROJECTPLAN.md` at the project root first (HANDOVER first). Then pick up at **F2 (the dashboard)** — the next M-frontend slice — folding in the deferred **status-pill overflow** fix as a rider. Don't start work until you've read both.

---

## 1. Where we are RIGHT NOW
- **`main` @ `49735de`.** Alembic head **`0018`** (NO migration added this session — the freeze at `0001–0018` still holds). Test floors on merged `main`: **328 backend / 193 vitest** (the vitest floor rose 172 → 193 from the canvas stack + F4; note F2 will DELETE `TeamsRail.test.tsx`'s 5 tests and add its own, so the number will move — set the F2 floor from a fresh `make test-frontend` at F2 start).
- **The whole M-frontend canvas overhaul is SHIPPED to `main`**: F1c + Canvas Fidelity Pass 1 + Pass 2, all three FF-merged in one go (`e7e0c89` → `3f18054`), after the operator's live canvas eyeball PASSED.
- **F4 (the premium landing page) is SHIPPED to `main`** too — cherry-picked (`147a59f` → new SHA `49735de`), audited clean. The OLD landing page is fully replaced.
- **Working tree is CLEAN except the two living docs**: `PROJECTPLAN.md` + `HANDOVER.md` are modified-uncommitted (this docs closeout — including the carried-forward Sidechat-4 edits in PROJECTPLAN). **They need one commit** (command in §6). Nothing else is dirty; all branches for this session's work are deleted.

## 2. What Tvashtr-44 did (full detail in PROJECTPLAN §17, 2026-07-03 Tvashtr-44 entry)
1. **Merged the canvas stack (FF).** Verified the 3-commit chain was linear+FF-able from the per-branch reflogs, eyeballed it live (arrowheads on every edge incl. the Reviewer→Engineer rework arc; the +/trash 450ms hover-grace; the shell = no left rail + header avatar menu + toolbar `[back][Run][Single|A/B]` + always-on `$0.00` + status dot; the config-drawer Model row inline). `git merge --ff-only` → `3f18054`; deleted the 3 branches.
2. **Audited + integrated F4.** F4 ran in parallel in a worktree off `e7e0c89`; `main` diverged to `3f18054` mid-run, so a literal FF was impossible. **Cherry-picked** the code commit `147a59f` onto `main` (dropped the STATE.md-only `d8b9edf`); the 5 landing files are disjoint from the canvas work → zero conflict. Removed the worktree + branch (`git worktree remove` + `git branch -D`).
3. **Proved composition on merged `main`** (the two halves, each built in total isolation, run together for the first time): `make build-frontend` tsc-strict clean + vite ✓; `make test-frontend` **193 pass (26 files)**; `make lint` clean.
4. **Disk content-audit of F4** (read on `main`): file set = ONLY the 6 landing files (no backend/App.tsx/canvas/migration); `landing.css` 888L, zero ad-hoc hex, zero global selectors, fully `.tv-lp`-scoped; the scroll-container deviation is sound (own named `scroll-timeline --tvlp-scroll` + `view-timeline --hiw` + reduced-motion reset, because index.css locks the root height so `scroll(root)` is inert); `LandingPage.tsx` 723L data-less, prop `onGetStarted(mode: AuthMode)` using the SHARED `AuthMode` type (type-safe seam); tests mutation-real.
5. **Docs closeout** (this file + PROJECTPLAN §17/§15/header).

## 3. IMMEDIATE NEXT STEP — F2 (the dashboard)
The active M-frontend ordering is **F1a✅ → F1b✅ → F1c✅ → (canvas fidelity 1–2✅) → F2 → F3 → F4-polish**. F4 (landing) is already done and merged, so after F2 the remaining M-frontend work is **F3 (the auth wizard — role/use-case collected-NOT-persisted)** and any final landing polish.

**F2 scope** (reskin onto the live/tested app; backend contract is the wall except the one new delete endpoint):
- Reskin the current dashboard to the design target **`design/Tvashtr Frontend Overhaul/Dashboard.dc.html`** (verify the exact filename in `design/` at session start).
- **List / open / create teams** + **the template-picker-on-create** (deferred here at Slice C — a create flow that offers the library templates from `list_templates()` / `_TEMPLATE_CATALOG` in `backend/tvashtr/control_plane/teams.py`: `two_node`, `review_loop`, `thinker_chain`, plus a blank team → name it → land on its canvas).
- **Team DELETE** (needs a backend DELETE endpoint — check `backend/tvashtr/routers.py` for whether one exists; likely new. Confirm cascade behavior for the team's run-snapshot graphs before designing the UX).
- **Delete the now-orphaned `frontend/src/components/TeamsRail.tsx` + `TeamsRail.test.tsx`** (team management moved off the canvas rail in Pass 1; confirm nothing still imports TeamsRail before deleting).
- **RIDER — the status-pill overflow fix** (see §4): fold it into the same F2 `/goal`.

**First design decision to surface (one at a time, paired with its UX consequence):** the **create-team-with-template-picker flow** — what the user sees/clicks when making a new team (pick a template card or "blank" → name → open on canvas). Ground it by reading, at F2 start: the current `Dashboard.tsx` (in `frontend/src/components/`), how `App.tsx`/`AuthGate` route dashboard↔canvas (canvas Pass 1 rewrote App.tsx — 370 lines changed), the team endpoints in `routers.py`, and the `Dashboard.dc.html` target. Evidence before design.

## 4. The status-pill overflow fix (F2 RIDER — registered in §15)
- **Bug (operator caught it live):** on WORKER node cards the tag row `.rf-node__meta` (a fixed **216px**, `flex-wrap`-unset flex row in `frontend/src/canvas.css`) holds capability + engine (`OpenHands`) + the status pill (`margin-left:auto`). The three exceed the card width, so the pill's label ("Waiting"/"Working…") is clipped by the card's right edge. Thinker cards have no engine chip, so they fit — only workers overflow.
- **Fix:** add `flex-wrap: wrap` to `.rf-node__meta` so the pill drops onto its own right-aligned line when the three don't fit — **every tag on every node fully visible**.
- **Acceptance (broadened per the operator "in every node"):** Playwright screenshot a thinker + BOTH worker nodes, cycling the status set (Waiting / Working… / Done / Failed / Stopped), proving no tag clips anywhere. (Note: the greyed model line at the bottom, e.g. `nvidia_nim/meta/llama-3…`, is MEANT to ellipsize — that's by design, not part of this fix.)
- Operator was explicit: **no dedicated Claude Code session for this — fold it into the next `/goal`.**

## 5. Standing operator directives (CARRY FORWARD — inherited every session)
- **Role = architect/planner ONLY.** All implementation (product code, diagnostic/throwaway scripts, build/Makefile/config) goes through a Claude Code `/goal`. Architect-direct edits are ONLY: the two living docs, `prompts/*.md` briefs, and trivial doc/typo fixes. When tempted to write code, write a `/goal` instead.
- **The disk audit is the main control point.** Never trust Claude Code's self-report — read the changed files, diff "untouched" claims against pre-images stashed to `/tmp/pre/`, read test bodies to confirm they're mutation-real.
- **No `git` CLI in the MCP** — reconstruct git state from `.git` plumbing: `.git/refs/heads/<branch>` (tip SHA), `.git/logs/refs/heads/<branch>` (reflog → parent chain + FF-ability + nothing-pushed). The operator is your git-CLI proxy: when you need a diff you can't compute (e.g. a worktree outside the sandbox, or a name-status), have them paste a read-only `git` command.
- **Merges: operator FF-merges (`git merge --ff-only`).** When a branch has diverged from `main` (parallel work landed first), FF is impossible — **cherry-pick the code commit onto `main`** (drop transient STATE.md commits), or rebase-then-FF; keep history linear. ALWAYS give ALL merge commands as copyable text (cd, checkout, merge/cherry-pick, verify line + expected SHA, what-if-it-fails, branch cleanup). Note that a cherry-picked branch needs `git branch -D` (force) since it isn't an ancestor.
- **Every Claude Code handoff = the COMPLETE copyable launch package, every time** (even if unchanged): (1) the shell launch command `cd /Users/adimac/Desktop/Tvashtr && claude --dangerously-skip-permissions`, (2) the FULL init prompt verbatim, (3) the FULL `/goal` verbatim. NEVER "same as before", never point them at a `prompts/` file for the init/`/goal` text. The detailed brief MAY live in `prompts/<name>.md` (the `/goal` references it) — the init + `/goal` text are always inline.
- **`/goal` = one bounded milestone**: outcome + invariants/do-not-touch (expressed AS on-disk-checkable evidence where possible) + the acceptance/evidence checklist Claude Code runs ITSELF to green (make test, lint, FE build+vitest, live smoke/e2e, Playwright self-sign-off with a screenshot per check) + reproduce-first for bug-fixes + stop conditions (NEEDS_HUMAN + turn cap; distinguish "unknown/broad → stop" from "code-proven contained fix → proceed"). `/goal` cap ≈ 4,000 chars → put the detailed brief in `prompts/*.md`.
- **Claude Code runs ALL verification itself** — never hand the operator commands to run manually; never defer a live target to a human gate.
- **Design decisions: from the vision (§1) + the Tvashtr-25 pivot, never from effort. One at a time, explicit sign-off before the next. No option menus for vision calls — decide. Pair EVERY decision with its concrete user-facing UX consequence on the canvas/UI.**
- **Deferred items → §15 register IMMEDIATELY** (with the decision that deferred them) so they can't vanish.
- **Visual sign-off = a concrete, NUMBERED, click-by-click script**: name the exact team (by rail label) + the exact node (by VISIBLE label, never "a thinker node") + the exact action + explicit pass/fail. Read FE source first to get real labels. (Default to Claude Code's Playwright self-sign-off with screenshots; the operator eyeball is the backstop — and it caught the status-pill bug this session, so it still matters.)
- **Bypass mode caveat** (`--dangerously-skip-permissions`): allow/deny rules go INERT — only PreToolUse hooks survive. The `protect-migrations.sh` (freeze) + `protect-no-push.sh` (no-push) guards are BOTH PreToolUse hooks, so they hold. The agent NEVER pushes; the agent commits only its OWN changed paths (leaves the living docs + `prompts/*.md` uncommitted for the architect).
- **Communication (operator preferences):** terse — "proceed"/"go"/"merged"/"done" = ratify + move on; a message starting **"By the way"** wants a short answer. **Procedures ONE step at a time** — give one step, they complete + report, then the next. **Analogies help.** **Simple, everyday language — avoid jargon.** Always hand over copyable artifacts; never make them scroll back or reconstruct.
- **Session hygiene:** watch context length; wrap up cleanly BEFORE running out (warn proactively); "handover" from the operator is an immediate trigger. Close out = PROJECTPLAN (§17 as-built + §15 register + header bump) then a full HANDOVER rewrite then the ready-to-paste opener.

## 6. Gotchas & tools
- **Commit the docs closeout** (this is the only dirty state):
  ```
  cd /Users/adimac/Desktop/Tvashtr
  git add PROJECTPLAN.md HANDOVER.md
  git commit -m "docs(tvashtr-44): canvas overhaul + F4 landing shipped to main; F2 next + status-pill rider registered"
  ```
  (The deep-dive `.md` files + `design/` stay untracked, as they were.)
- **PROJECTPLAN.md is ~220KB / 855 lines.** NEVER read it whole. Copy it (`copy_file_user_to_claude`) → `grep -nE '^#{1,3} '` for a header index → `sed -n 'A,Bp'` targeted reads. Key sections: §1 vision, §6.4 the human-authored-graph constitution, §14 features, **§15 roadmap + deferred register** (now incl. the C1–C9/X1–X13 deep-dive items + the F2 status-pill rider), §16 milestones, **§17 append-only as-built log**, §18 glossary.
- **`copy_file_user_to_claude` caches by basename** — a 2nd copy of the same filename may return the stale cached version. Stash to `/tmp/` with distinct names, or re-verify with `Filesystem:read_text_file`.
- **`Filesystem:read_multiple_files` can hang (~4 min).** Prefer individual reads / copies. (The Filesystem MCP hung once this session and needed an operator restart — if reads time out, ask them to restart local MCP servers.)
- **`create_file`/`bash_tool` write to Claude's CONTAINER only** (invisible to the operator). ALL operator-disk writes use `Filesystem:write_file` (overwrite) or `Filesystem:edit_file`. `edit_file`: run `dryRun:true` first with unique multi-line anchors; anchoring on a section-boundary block like `\n---\n\n## NN. Header` is robust (the numbered header makes it unique) and avoids tricky apostrophe/em-dash matching inside prose.
- **The seeded dev team is "My team"** = the `review_loop` template: visible node labels **Product manager** (entry — coral start-bar), **Engineer**, **Reviewer** (both workers, OpenHands), **PRD approval** + **Escalation** (gates), **Ship** + **Stop** (terminals). Bring-up: `make db-up && make migrate && make seed && make backend` (idempotent) + `make frontend` (Vite :5173); login `operator@tvashtr.local` / `tvashtr-dev`.
- **Parallel sessions:** two live coding sessions need separate worktrees + different Vite ports + (if backend-touching) a different backend port + a separate DB. F4 was a clean parallel candidate BECAUSE it was static/FE-only/no-backend — its files were disjoint, so the diverged-`main` integration was a trivial cherry-pick. A backend-touching slice (F2) is NOT as separable; prefer designing-ahead over a second live session unless truly independent.
- **Stale-branch clutter:** ~20 old merged milestone branches (`feat/p1.5*`, `feat/p1.8*`, `feat/m-accounts-slice-b`, `chore/cli-no-push-hook`, …) still exist. Harmless. A safe sweep whenever the operator wants: `git branch --merged main | grep -vE '^\*|  main$' | xargs -n1 git branch -d` (only deletes truly-merged ones; refuses the rest).
- **Deferred behind the frontend wall** (do NOT start until M-frontend is done): the Sidechat-4 deep-dive milestones **M-ctx0 → M-ctx1 → M-ledger → M-tools → M-rails** (schema deltas = new migrations `0019–0021`, freeze-bumped last), and the **brownfield stronger-worker thesis re-run** (DEFERRED, NOT queued; M-ctx0's condenser pairs with it when un-deferred). **Mv (a non-founder shipping real value on their own repo) remains the real demand gate.**
- **Tools available:** Filesystem MCP (operator disk), `bash_tool` (container-only, for files copied into `/mnt/user-data/uploads/`), Playwright MCP (automated UI/E2E inside a `/goal`), the `/tvashtr-loop` skill (mechanical steps). Living docs: `PROJECTPLAN.md` + `HANDOVER.md`. Briefs: `prompts/CLI-RULES.md` + `prompts/CLI-SETUP.md` (operating contracts).

## 7. Open questions / to-confirm at F2 start
- Does a **team-DELETE endpoint** already exist in `routers.py`? If not, F2 adds one — confirm the cascade for the team's run-snapshot (`is_library=false`) graphs first.
- Does the current create-team flow already have ANY template affordance, or is it a plain "new team"? (The template-picker-on-create was deferred at Slice C.)
- Confirm the exact `Dashboard.dc.html` path/name under `design/`.
- Confirm nothing still imports `TeamsRail` before deleting it.
