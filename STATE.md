# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend prerequisite — **F2b: enrich the teams list with per-team Status + Spend** (backend-only,
READ-ONLY). Brief: `prompts/F2b-teams-status-spend.md`. Branch: `feat/f2b-teams-status-spend` (off
`main` @ `34c2f59`, i.e. after F2a merged).

## OUTCOME — F2b SHIPPED (READY_TO_MERGE; clean SUCCESS)
Every library-team summary from `GET /api/teams` (and the create + seed paths) now ALSO carries:
- **`last_run`**: `{status, at, run_id}` of the most recent run (max `created_at`) across ALL clones
  of the team — or **`null`** if the team was never run.
- **`spend_usd`**: the SUM of `runs.cost_total_usd` (NULL treated as 0) across all its clones' runs —
  `0.0` when never run.

Computed via the EXISTING `cloned_from_node_id` clone→origin link (run → clone graph → clone node →
`cloned_from_node_id` → origin node → origin `team_graph_id`), mirroring `_latest_invocation_by_origin`.
**Read-only** (only SELECTs over `runs` + `agent_nodes` + `team_graphs`); **batched, no N+1** (one
rollup pass for all the owner's teams); the run-join fan-out over a clone's many nodes is **de-duped**
(a `DISTINCT` subquery → one row per (team, run)) BEFORE aggregating, so spend is never multiplied by
node count. **Owner-scoped + library-only** — a team's rollup reflects only its own clones' runs; no
other team's or account's runs leak in. NO migration (head `0018`), NO frontend change (the
`TeamSummary` TS type + render is F2c).

## Last Completed Step
F2b — teams-list status + spend — 2026-07-03 — branch: feat/f2b-teams-status-spend — commit: (tip;
exact sha in the FINAL REPORT).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f2b-teams-status-spend, backend=336 passing

## The change (teams.py + 1 new test; backend-only, read-only)
- **`backend/tvashtr/control_plane/teams.py`** (+76 / −4) — confined to the summary PATH:
  - imports: `+ from sqlalchemy.orm import aliased`, `+ Run` on the models import.
  - `+ _run_rollup_by_origin(session, library_team_ids)` (NEW private join helper) — batched
    `{origin_team_id: {last_run, spend_usd}}` via the clone→origin join; a `DISTINCT` subquery
    collapses the node-fan-out to one row per (team, run); Postgres `DISTINCT ON (team)` picks the
    latest by `created_at`; `SUM(COALESCE(cost, 0))` for spend.
  - `_team_summary(session, graph, rollup=None)` — enriched with `last_run` + `spend_usd` (uses the
    passed batch, else computes for the single team). Every summary path returns the enriched shape.
  - `list_library_teams` — computes the rollup ONCE for all the owner's teams, threads it in (no N+1).
- **`backend/tests/test_f2b_teams_status_spend.py`** (NEW) — 5 tests, runs built via the REAL clone
  path (`clone_team_graph` + a Run at the clone): never-run→null/0; one-run→status/run_id/cost;
  multi-run→latest + summed spend (NULL as 0, guards the de-dup: 2.25 not 11.25); isolation (a second
  team + a real second-owner `users` row excluded); `GET /api/teams` endpoint shape.

## Acceptance evidence (all green this session)
- `make test` → **336 passed, 1 warning in 16.80s** (floor 331 → **336**, +5).
- `make lint` → ruff clean + eslint (`--max-warnings 0`) clean + prettier clean.
- `GET /api/teams` payload (fresh account, one plan_review RUN team + one two_node never-run team):
  the run team → `last_run: {status: "completed", at: "2026-02-01T00:00:00+00:00", run_id: …}`,
  `spend_usd: 2.75`; the never-run team → `last_run: null`, `spend_usd: 0.0`.
- Read-only proof: `git diff main --` EMPTY for `team_run.py` + `graph_validity.py`; nothing under
  `frontend/` or `backend/alembic/`; alembic head `0018`; the `teams.py` diff hunks touch only the
  imports + the summary path (`_run_rollup_by_origin` / `_team_summary` / `list_library_teams`).
- Independent review (fresh subagent over the diff) → **0 blocking** (A–H all PASS; the fan-out
  de-dup, latest-by-created_at, NULL-as-0, owner isolation, no-N+1, and read-only all verified).

## Invariants held
- Executor `team_run.py` + `graph_validity.py` EMPTY diff vs `main`; alembic head `0018` (NO
  migration); nothing under `frontend/` or `backend/alembic/`; only SELECTs (no writes/new columns).
- `teams.py` diff confined to the summary path (imports + the new helper + `_team_summary` + the
  2-line `list_library_teams` rollup wiring) — no builder/clone/catalog function touched.
- Commit stages ONLY `teams.py` + `test_f2b_teams_status_spend.py` + `STATE.md` — no living docs, no
  `prompts/*.md`, no side-chat files, never `.tvashtr/loop-state.md`.

## Deviations from the brief
- The brief says "the teams.py diff is confined to `_team_summary` (+ a private join helper)", but the
  "batched, no N+1" mandate REQUIRES `list_library_teams` to compute the rollup once and pass it — so a
  minimal 2-line change there is included (it's part of the summary path). Flagged; nothing else touched.

## Test Count
**336 backend pytest** (floor 331 → 336; +5) — 2026-07-03. FE untouched.

## Blocked
None — clean SUCCESS. Next: **F2c** (the FE `TeamSummary` type + the dashboard table render of the
Status + Spend columns this endpoint now feeds).
