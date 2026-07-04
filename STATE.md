# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend — **F2c: the dashboard reskin** (frontend-only) — ONE unified teams table with per-team
status + spend, the New-team template picker, delete-confirm, the stat strip, reskinned providers,
the canvas status-pill overflow rider, and TeamsRail removal. Brief: `prompts/F2c-dashboard.md`.
Branch: `feat/f2c-dashboard` (off `main` @ `825adea`, i.e. after F2-delete merged).

## OUTCOME — F2c SHIPPED (READY_TO_MERGE; clean SUCCESS)
`Dashboard.tsx` is reskinned to `design/Tvashtr Frontend Overhaul/Dashboard.dc.html` with the
operator's model ("a run is a team that ran"):
- A greeting header (wordmark + the account avatar/menu), a **real stat strip** — Teams in your
  library / Active runs (teams whose `last_run` is non-terminal) / Total spend (Σ `spend_usd`).
- **ONE unified teams table**: Team (row → `onOpenTeam`) · Nodes · **Status** (a `last_run`→pill map:
  Running / Awaiting you / Completed / Failed / Stopped / Over budget, or a muted **Not run yet**) ·
  **Spend** (`$` + `spend_usd`) · Created · a row **delete**.
- The **New-team template picker** (new `NewTeamDialog.tsx`) — a warm centered pop-up over the dimmed
  dashboard: a name field + a Blank card + one card per `getTemplates()` (the four F2a templates) →
  `createTeam(key, name)` → `onOpenTeam(new id)` lands on the canvas.
- The **delete confirm** — names the team, adds "A run is in progress — deleting will stop it." when
  the latest run is non-terminal → `deleteTeam(id)` → reload `getTeams`.
- The **providers** section reskinned (behavior unchanged).
- **RIDER**: `flex-wrap: wrap` on the ONE `.rf-node__meta` rule in `canvas.css` — the worker card's
  capability + engine + status pill now wrap instead of clipping the pill at the fixed 216px width.
- The orphaned **`TeamsRail.tsx` + `TeamsRail.test.tsx` deleted** (grep-confirmed nothing imports it).

## Last Completed Step
F2c — dashboard reskin — 2026-07-04 — branch: feat/f2c-dashboard — commit: (tip; exact sha in the
FINAL REPORT).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f2c-dashboard, frontend=191 vitest passing

## The change (frontend-only)
- **`frontend/src/lib/api.ts`** — ADDITIVE only: `+ last_run: {status, at, run_id} | null` +
  `+ spend_usd: number` on `TeamSummary`. Diff vs main = EXACTLY those two lines.
- **`frontend/src/lib/status.ts`** — `+ runStatusPill(status)` (+ `RunPillTone`): the run-status→pill
  {tone,label} map (extend the single status source of truth, per the hard rail; not inline).
- **`frontend/src/components/Dashboard.tsx`** — the reskin (stat strip + unified table + avatar menu +
  reskinned providers; wires the picker + the delete confirm; drops the "Previous runs" section +
  its `listRuns`/`RunSummary` imports).
- **`frontend/src/components/NewTeamDialog.tsx`** (NEW) — the template picker pop-up.
- **`frontend/src/index.css`** — the `.tv-dash__*` reskin recipes (stat strip / unified table / row
  open-behind-cells + delete-in-front / providers shelf / dialog + template cards), `+
  .tv-pill--overbudget` (amber), `+ .tv-avatarmenu__name`. Token-driven; base tokens untouched.
- **`frontend/src/canvas.css`** — the single-line rider (`flex-wrap: wrap` on `.rf-node__meta`).
- **`frontend/src/components/Dashboard.test.tsx`** — re-pointed to the new DOM + added picker / delete
  (incl. the in-progress warning) / render (status→pill + spend + stat totals) tests (5 → 8 tests).
- **Deleted:** `frontend/src/components/TeamsRail.tsx` + `TeamsRail.test.tsx`.

## Acceptance evidence (all green this session)
- `make build-frontend` → `tsc --noEmit` strict clean + `vite build` ✓ (`built in 1.20s`).
- `make test-frontend` → **191 passed (25 files)**. F2c-start baseline was **193** (26 files); −5
  (TeamsRail's 5 tests, file 26→25) + 3 net-new Dashboard tests (5 → 8) = **191**.
- `make lint` → ruff clean + eslint (`--max-warnings 0`) clean + prettier clean.
- **Playwright self-sign-off on :5173** (operator account, real backend; targeted `browser_evaluate`
  + screenshots, no whole-tree snapshot). Functional facts verified + a screenshot each (in the
  session scratchpad, NOT committed):
  - Dashboard: greeting "Good to see you, Operator.", stat strip **5 teams / 2 active / $2.51**, all
    five status pills mapped (Completed/Awaiting you/Running/Failed/Not run yet) + spends + providers.
  - Picker: New team → the dialog with **Blank + the four templates** → pick + Create → lands on the
    canvas (a review_loop clone rendered).
  - Delete: row delete → the confirm naming the team ("Delete PRD to prototype?") + the in-progress
    warning band.
  - Rider: the canvas Thinker + BOTH Worker nodes with the widest labels (Done / Working… / Over
    budget) — measured `pillClipped: false` + `metaOverflowsHoriz: false` on every node
    (`.rf-node__meta` computed `flex-wrap: wrap`).
- Diffs: `api.ts` = exactly the 2 fields; `canvas.css` = the single `flex-wrap: wrap` line; TeamsRail
  files deleted; nothing under `backend/`, `frontend/src/design-system/tokens/`, `LandingPage.tsx`, or
  `landing.css`.
- Independent review (fresh subagent over the FE diff) → (result in the FINAL REPORT).

## Invariants held
- `api.ts` diff vs `main` is EXACTLY the two `TeamSummary` fields — nothing else.
- `canvas.css` diff is the single `.rf-node__meta` `flex-wrap: wrap` line — no other canvas recipe, no
  canvas `.tsx`.
- NO change under `backend/`; NO migration (alembic head stays `0018`).
- Base design tokens byte-untouched (`git diff main -- frontend/src/design-system/` EMPTY) — the
  reskin only ADDS `.tv-*` recipes to `index.css` + reuses existing tokens.
- `LandingPage.tsx` + `landing.css` UNTOUCHED (the parallel session owns them).
- Commit stages ONLY the 8 frontend paths + `STATE.md` — no living docs, no `prompts/*.md`, no
  side-chat files, no browser/demo artifacts, never `.tvashtr/loop-state.md`.

## Deviations from the brief
- `status.ts` extended with `runStatusPill` (the run-status→pill map). The brief said "reuse the
  existing StatusPill"; StatusPill is typed to the canvas `NodeStatus` vocab (idle/running/done/…),
  so a literal reuse can't produce the dashboard's labels ("Awaiting you", "Over budget", "Not run
  yet"). Per the standing hard rail ("`status.ts` is the single source of truth for derived status —
  extend it there, not in components"), the mapping lives in `status.ts` and the dashboard renders the
  same `.tv-pill` design vocabulary StatusPill uses. Net: the DS pill is reused; the derivation is
  centralized. Also added two small additive `.tv-*` recipes to `index.css`: `.tv-pill--overbudget`
  (amber — a status the base pill set lacked) and `.tv-avatarmenu__name`. Both extend, none edit.

## Test Count
**191 vitest** (F2c baseline 193 → 191; −5 TeamsRail + 3 net-new Dashboard tests) — 2026-07-04.
Backend untouched (340 backend pytest unchanged).

## Blocked
None — clean SUCCESS. Next: **F3** (the auth wizard) per the M-frontend roadmap, then any F4-polish.
