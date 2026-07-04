# Tvashtr — Autonomous Execution State

## Current Milestone
M-frontend prerequisite — **F2-delete: deleting a team stops its run + removes the team AND its runs**
(backend-only). Brief: `prompts/F2-delete-teardown.md`. Branch: `feat/f2-delete-teardown` (off `main`
@ `3949e26`, i.e. after F2b merged).

## OUTCOME — F2-delete SHIPPED (READY_TO_MERGE; clean SUCCESS)
`DELETE /api/teams/{team_id}` now FIRST stops any in-flight run of the team, THEN hard-deletes the
team AND all of its runs — closing the zombie-run bug (a run used to keep executing + spending on its
immutable clone after its team was deleted). Behavior:
1. **Enumerate** the team's runs (+ their clone-graph ids) via the EXISTING `cloned_from_node_id`
   clone→origin link (same join F2b / `_latest_invocation_by_origin` use; a `DISTINCT` collapses the
   clone's node fan-out to one row per run).
2. **Stop** every non-terminal run through the **SHARED** `cancel_run_core` — `DBOS.cancel_workflow`
   + `Run.status="cancelled"` + close its pending `HumanTask`s. This core is EXTRACTED from the old
   `cancel_run`; the `/cancel` endpoint now delegates to it (one implementation, not two).
3. **Tear down** each run in FK-safe order: its run-scoped rows (`cost_records` by `workflow_id`;
   `run_events` / `agent_invocations` / `human_tasks` / `engineer_run_attempts` by `run_id`), the
   `Run` row, THEN its clone `TeamGraph` (nodes/edges cascade) — Run before its clone so
   `runs.team_graph_id` (no `ondelete`) never dangles.
4. **Delete** the library team (its nodes/edges cascade).

Cancels run BEFORE the delete transaction (each in its own txn — no nested `session_scope`, no
DBOS-in-app-txn race); the deletes are ONE transaction (a failure can't half-delete). Owner-scoped
throughout (the team is `_require_library_team`-checked; its runs are found only via its own clones).
Keeps 400-on-malformed-id + 404-on-non-library/non-owned. NO migration (head `0018`), NO frontend.

## Last Completed Step
F2-delete — team teardown on DELETE — 2026-07-04 — branch: feat/f2-delete-teardown — commit: (tip;
exact sha in the FINAL REPORT).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/f2-delete-teardown, backend=340 passing

## The change (teams.py + routers.py + 1 new test; backend-only)
- **`backend/tvashtr/control_plane/teams.py`** (+~99, additive only — the only deletions are the 2 old
  import lines): `+ from dbos import DBOS`, `+ delete, update` on the sqlalchemy import, `+` the five
  run-scoped models on the models import; `+ _TERMINAL_RUN_STATUSES` (moved here from routers);
  `+ cancel_run_core(run_id)` (the shared cancel core); `+ _team_run_teardown_targets(...)` (the
  clone→origin run enumerator); `+ delete_library_team_and_runs(...)` (the ordered teardown).
- **`backend/tvashtr/routers.py`** (net −11): `delete_team` now calls `delete_library_team_and_runs`
  (+ rewritten docstring; the old "no run is orphaned" line was obsolete); `cancel_run` now delegates
  to `cancel_run_core` (its duplicated inline cancel block removed); `_TERMINAL_RUN_STATUSES` removed
  (only `cancel_run` used it; now in teams.py).
- **`backend/tests/test_f2_delete_teardown.py`** (NEW) — 4 tests, runs built via the REAL clone path
  (`clone_team_graph` + a Run at the clone + a row in EACH of the five run-scoped tables), cancel core
  spied: reproduce-first (running run → after DELETE the run is cancelled + run + all 5 tables + clone
  + team all GONE — RED on pre-fix code); completed-run purge (cancel NOT invoked); never-run team;
  isolation (sibling team + second-owner team intact; ZERO orphans across all 5 tables).

## Acceptance evidence (all green this session)
- `make test` → **340 passed, 1 warning in 16.75s** (floor 336 → **340**, +4).
- `make lint` → ruff clean + eslint (`--max-warnings 0`) clean + prettier clean.
- Reproduce-first: the 3 desired-state tests FAILED on pre-fix code (`_run_exists(rid)=True` — the run
  survived deleting its team), PASS after the fix. The never-run test passed on pre-fix code too
  (regression guard).
- Evidence echo (create → run + 5 record types → DELETE → re-query): team A → `team_exists=False`,
  `run_exists=False`, `clone_exists=False`, all 5 run-scoped counts `0`, cancel-core invoked `True`;
  sibling team B → team/run/clone present, all 5 counts `1`. DELETE returned `200 {deleted: True}`.
- Read-only-to-others proof: `git diff main --` EMPTY for `team_run.py` + `graph_validity.py`; nothing
  under `frontend/` or `backend/alembic/`; alembic head `0018`; the only real `DBOS.cancel_workflow`
  CALL is `teams.py` (the shared core) — routers.py no longer calls it (delegates).
- Independent review (fresh subagent over the diff) → (result in the FINAL REPORT).

## Invariants held
- Executor `team_run.py` + `graph_validity.py` EMPTY diff vs `main`; alembic head `0018` (NO
  migration); nothing under `frontend/` or `backend/alembic/`.
- Cancel logic is SHARED, not duplicated: `cancel_run` (endpoint) + `delete_library_team_and_runs`
  both call `cancel_run_core`; only one `DBOS.cancel_workflow(run_id)` call site in the codebase.
- `cancel_run`'s external behavior preserved (404 non-owned; no-op on already-terminal; else
  cancel + status + close tasks; same JSON shape).
- teams.py diff is additive (only the 2 import lines changed); the F2a builders/catalog + the F2b
  summary path are untouched (the teardown only CALLS the clone→origin linkage pattern).
- Commit stages ONLY `teams.py` + `routers.py` + `test_f2_delete_teardown.py` + `STATE.md` — no living
  docs, no `prompts/*.md`, no side-chat files, never `.tvashtr/loop-state.md`.

## Deviations from the brief
None. The brief's expected shape (extract the cancel core; ordered multi-table teardown; no migration)
held exactly. The two existing delete tests in `test_team_library.py` did NOT need re-pointing (their
400/404 + cascade expectations are unchanged) — verified still green.

## Test Count
**340 backend pytest** (floor 336 → 340; +4) — 2026-07-04. FE untouched.

## Blocked
None — clean SUCCESS. Next: **F2c** (the FE — delete button + confirm dialog wired to this endpoint,
plus the `TeamSummary` status/spend render F2b feeds).
