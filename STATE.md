# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend (Tvashtr-43) — the premium reskin of the warm cream-paper FE, decomposed F0→F4.
This slice: **Canvas Fidelity Pass 1 — the canvas SCREEN SHELL (header + toolbar + remove the author
team-rail) + the config DRAWER collision fix**, reconciled to `design/Tvashtr Frontend Overhaul/Canvas.dc.html`.

## OUTCOME — Canvas Fidelity Pass 1 SHIPPED (READY_TO_MERGE; clean SUCCESS)
The canvas screen SHELL now matches the design. **Part A:** the author-mode "Your teams" left rail is
GONE — the canvas is full-width while authoring (the team library lives on the Dashboard); the tasks
drawer still appears during a run. **Part B:** the header's right side is a single **avatar button**
(the email's initial) opening a **profile menu** (the email + a Log out row → `onLogout`), replacing the
raw email + Log out text; the green backend dot moved OUT of the header. **Part C:** the toolbar is
`[back-arrow] [Run this team] [Single | A/B toggle]` (Run BEFORE the toggle) + a right cluster with the
**spend** (`$0.00` idle) + the green **BackendDot**; the design's non-functional grid icon is omitted and
the always-on hint line removed (the validity warning kept, compact). **Part D:** the drawer's Model-row
class collision is fixed — `.tv-picker*` → **`.tv-modelrow*`** in `panel.css` + `TeamNodePanel.tsx` (the
canvas popover's `.tv-picker` in the frozen `canvas.css` was floating the row out of the drawer); the
prompt heading is now **"System prompt"** with the design's hint. FRONTEND-ONLY; the backend contract is
the wall (`api.ts` + `backend/` + `canvas.css` + `Dashboard.tsx` byte-untouched, NO migration, head
`0018`). All gates green; invariant proofs empty/clean; Playwright self-sign-off captured live; the
independent review = 0 blocking.

## Last Completed Step
Canvas Fidelity Pass 1 — 2026-07-03 — branch: feat/canvas-fidelity-1 — commit: (the tip of
feat/canvas-fidelity-1; exact sha in the FINAL REPORT)

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/canvas-fidelity-1, frontend=183 passing, backend=328 passing

## ⚠️ BASE-BRANCH NOTE (operator merge sequencing — read before merging)
This branch is based on **`e060eb9` (the F1c tip)**, NOT bare `main` (`e7e0c89`). The brief said "off
main", but it targets F1c artifacts that do NOT exist on bare main (the drawer's `.tv-picker`, the
`TeamNodePanel` model picker, the vitest floor 179) — so its true base is the shipped-but-un-merged F1c
tip (a clean fast-forward exactly one commit above main: `e060eb9^ == e7e0c89 == main`). The WALL vs main
holds regardless (F1c touched none of `api.ts`/`backend/`/`canvas.css`/`Dashboard.tsx`). **Merge order:
FF-merge `feat/f1c-config-drawer` FIRST, THEN `feat/canvas-fidelity-1`** (main → F1c → canvas-fidelity-1,
a clean linear FF). This is a reversible two-way-door choice; flagged loudly in the FINAL REPORT.

## Completed Steps (append-only, newest last)
- [x] F0 — extend-tokens + shared-primitive lift — b43a0d0 (STATE docs f0aabfd) — 2026-07-02
- [x] F1a — canvas node cards + deriveNodeStatus never-reached fix — e861b4c — 2026-07-02
- [x] F1b — canvas chrome + edges/handles + inline authoring affordances — 937d27d — 2026-07-02
- [x] F1c — config drawer + dock⇄pop-up toggle + model picker + run-view — e060eb9 (feat/f1c-config-drawer, un-merged) — 2026-07-02
- [x] Canvas Fidelity Pass 1 — screen shell (header/toolbar/rail) + drawer collision fix — feat/canvas-fidelity-1 — 2026-07-03

## The change (8 files, FE-only)
- **`frontend/src/App.tsx`** — Part A: stopped rendering `<TeamsRail>` (author canvas full-width); the
  tasks drawer is now `{!authoring && <TasksDrawer/>}`; removed the dead rail imports/state/handlers
  (`TeamsRail`, `createTeam`/`deleteTeam`/`getTemplates`, `TeamSummary`/`Template`, `teams`/`templates`/
  `teamBusy`, `handleSelectTeam`/`handleCreateTeam`/`handleDeleteTeam`); slimmed `loadTeams` to seed the
  default `currentTeamId`. Part B: rewrote the header to the `.tv-topbar` + avatar/profile-menu (new
  `profileOpen` state); removed the raw email + Log out + `<BackendDot/>` + the header "← Dashboard"
  button. Part C: rewrote the toolbar to `.tv-toolbar` (back-arrow, Run + play glyph, the extracted
  `viewToggle` [reachable in author AND A/B mode], right-cluster spend + moved `<BackendDot/>`); removed
  the hint line; added `spendLabel` (`run?.cost_total_usd ?? Σcosts.cost_usd`, `$0.00` idle) + `avatarInitial`.
- **`frontend/src/components/BackendDot.tsx`** — the design's bare 8px status dot + tonal halo (sage
  connected) — the visible label dropped, kept as `title`/`aria-label` (`role="img"`).
- **`frontend/src/index.css`** — new shell CSS family (append-only): `.tv-topbar`, `.tv-avatar(-wrap)`,
  `.tv-avatarmenu(__catch/__id/__avatar/__email/__divider/__logout)`, `.tv-toolbar(__back/__right/__spend/
  __divider)` + a reduced-motion guard. Tokens only. New names verified collision-free.
- **`frontend/src/panel.css`** — Part D: `.tv-picker*` → `.tv-modelrow*` (the drawer Model row) so it no
  longer collides with `canvas.css`'s floating `.tv-picker` popover. (canvas.css untouched.)
- **`frontend/src/panel/TeamNodePanel.tsx`** — Part D: `.tv-picker*` → `.tv-modelrow*` (3 className sites);
  prompt heading "Prompt" → **"System prompt"** + hint → "Its whole identity. The run appends the idea and
  the live PRD on top."
- **`frontend/src/App.test.tsx`** — re-pointed to the new shell; ADD: Part A (no rail while authoring; the
  tasks drawer renders once a run starts — seeded via a module-level `extraTasks`), Part B (avatar hides
  email + Log out until clicked; Log out calls `onLogout`), Part C (back-arrow + Run-before-toggle order +
  `$0.00` + status dot + no hint). All 4 existing describes kept green.
- **`frontend/src/panel/TeamNodePanel.test.tsx`** — ADD: the Model row is `.tv-modelrow` (never `.tv-picker`),
  provider select + model input inside `.tv-panel__body`. The Slice-C compose-on-Save test stays green.
- **`STATE.md`** — this file.

## Acceptance evidence (all run to green this session)
- `make test` (backend offline) → **328 passed, 1 warning in 15.62s** (floor 328; FE-only, no regression).
- `make test-frontend` (vitest) → **Tests 183 passed (183)** across 24 files (floor 179 → **183**, +4 new).
- `make build-frontend` → tsc --noEmit clean + **vite ✓ built in 1.20s**.
- `make lint` → ruff **All checks passed! 126 files already formatted** + eslint (`--max-warnings 0`) clean
  + prettier **All matched files use Prettier code style!**.
- Playwright self-sign-off (live stack, seeded operator `operator@tvashtr.local`, real team; targeted
  `browser_evaluate` + screenshots, NO whole-canvas a11y snapshot): (1) author canvas — full-width, NO
  `.tv-rail`, `.tv-topbar` avatar "O" (no raw email/Log out in header), `.tv-toolbar` = [Back to dashboard,
  Run this team, Single run, A/B compare] (Run before toggle) + spend "$0.00" + BackendDot, no hint line;
  (2) profile menu open — `operator@tvashtr.local` + a Log out row; (3)/(3b) the Engineer author drawer —
  labels [Capability, "System prompt", Model], the Model row is `.tv-modelrow` INSIDE `.tv-panel__body`
  (`rowWithinPanelBounds: true`), provider `<select>` + model `<input>` inline, **NO `.tv-picker` anywhere**,
  no floating box. Compared vs `Canvas.dc.html` — faithful.
- Screenshots (OUTSIDE the repo): `…/scratchpad/canvas-fidelity-1/cf1-01-author-canvas.png`,
  `cf1-02-profile-menu.png`, `cf1-03-drawer-inline-modelrow.png`, `cf1-03b-drawer-modelrow.png`.
- Independent review (fresh subagent over the working-tree diff) → **0 blocking findings** (WALL intact,
  A/B toggle reachable, spend uses `??`, rename complete, the 4 new tests revert-sensitive).

## Invariants held (proofs run on disk this session)
- THE WALL — `git diff main --` EMPTY for: `frontend/src/lib/api.ts`, `backend/`, `frontend/src/canvas.css`,
  `frontend/src/components/Dashboard.tsx`. Alembic head **`0018_run_subpath (head)`** (NO migration).
- DS tokens frozen — `git diff main -- frontend/src/design-system/` EMPTY.
- Collision sweep (CSS comments stripped) — `panel.css ∩ canvas.css` .tv-* = **EMPTY** (was `{.tv-picker}`).
  `panel.css ∩ index.css` = EMPTY. `canvas.css ∩ index.css` = `{.tv-pill}` (the pre-existing intentional
  shared StatusPill primitive; canvas.css frozen — not a regression).
- My commit stages ONLY the 8 files above — nothing under `backend/`, no `alembic/versions/*`, no `design/`,
  no `prompts/*.md`, no side-chat `.md` files (untracked, left alone), never `.tvashtr/loop-state.md`.

## Deviations from the brief
- **Base = the F1c tip `e060eb9`, not bare main** (see the BASE-BRANCH NOTE) — the brief is un-executable
  off bare main (its Part D target + floor 179 are F1c artifacts). Reversible two-way-door; WALL vs main holds.
- **Playwright ran against the LIVE stack** (make backend + make frontend + the seeded operator), per the
  brief — functional facts verified via `browser_evaluate`; the aesthetic sign-off stays a human gate.
- **`BackendDot` restyled to the design's bare dot** (label → tooltip/aria) so it fits the clean toolbar
  right-cluster — the brief said "move `<BackendDot/>` here" + gave the design's dot recipe.

## Test Count
**183 vitest** (floor 179 → 183; +4 new) · **328 backend pytest** (unchanged, FE-only) — 2026-07-03.

## Blocked
None — clean SUCCESS. Next in M-frontend after this + F1c merge: F2 (dashboard), F3 (auth wizard),
F4 (landing). The revamp is NOT "done" until F4 (operator's all-caps announcement gate).
