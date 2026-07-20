# Brief — Parallel batch, Session B: ops hygiene + dashboard UX (3 features)

**Type:** one `/goal`, three additive features. **ZERO migration** (alembic head STAYS `0030`).
Runs in parallel with Session A — see "Parallel-batch rules" at the bottom.

## Feature 1 — Agent-workspace GC (`.tvashtr_workspaces/<run_id>`)

`.tvashtr_workspaces/<run_id>/` accumulates forever with no cleanup — the same unbounded-disk shape
the hosted-clone GC already fixed. **Mirror `control_plane/clone_reaper.py` EXACTLY** in a new
`control_plane/workspace_reaper.py`, targeting the workspace root instead of the clone root.

- **Find the root first:** grep for `.tvashtr_workspaces` to get its canonical definition (likely
  in `control_plane/worktree.py`); confirm it is keyed by `run_id`. Define the reaper's
  `WORKSPACE_ROOT` by importing/re-deriving that one canonical path — do not hardcode a second copy.
- **Mirror clone_reaper's structure verbatim in kind:** `LIVE_STATUSES` allow-list (spare
  `pending`/`running`/`awaiting_human` — a live run needs its workspace to RESUME, exactly the
  reason clone_reaper spares a live clone); `delete_run_workspace(run_id)` (run-end, status-gated,
  never-raises) + `sweep_orphaned_workspaces()` (boot + periodic reconcile against `runs`,
  never-raises); FENCE 1 = UUID-only candidate paths; FENCE 2 = `os.scandir` + non-symlink dirs +
  refuse if the root is itself a symlink; **openhands-free at import** (main.py imports it at startup).
- **Wire the run-end delete into the SAME teardown hook the clone delete rides** — grep
  `delete_run_clone` to find `_run_end_teardown` / `close_run_sandboxes`, and call
  `delete_run_workspace` right beside it.
- **Register the sweeps like clone_reaper:** the boot sweep in `main.py` (beside the clone sweep),
  and a `DBOS.scheduled("*/10 * * * *")` **gated on `agent_sandbox_mode == "fly"`** on the DECORATOR
  (copy clone_reaper's gate comment — an unconditional poller wedges the offline suite).
- **`run_diff` interaction (verify, don't guess):** `control_plane/run_diff.py` never raises → an
  empty list when the dir is gone, so GC'ing a TERMINAL run's workspace makes its greenfield diff
  empty, not a 500 — the same tradeoff clone-GC accepted. Confirm `run_diff` still returns `[]`/200
  for a GC'd terminal run; note it in the report.
- **Live gate:** add `make workspace-gc-check` mirroring `make clone-gc-check` (docker-free).
- **Reproduce-first test:** seed workspace dirs for a LIVE run + a TERMINAL run + an ABSENT run,
  sweep, assert the live one is spared and the other two reaped; assert `delete_run_workspace` spares
  a live run's dir and no-ops a greenfield/absent one (RED before the module exists).

## Feature 2 — Rename a team

No rename path exists today (teams are named at creation only). Add one.
- **BE (`control_plane/teams.py`):** `rename_library_team(team_id, name, owner_id)` — an
  owner-checked UPDATE of `TeamGraph.name`. Mirror the owner-scoping of `list_library_teams` /
  `delete_library_team_and_runs`. 404 on a foreign/absent team; 422 on an empty/whitespace name.
- **BE (`routers.py`):** `PATCH /api/teams/{team_id}` accepting `{name}` → calls it; owner-scoped
  like `DELETE /api/teams/{team_id}`. Return the updated team summary (`get_team_summary`).
- **FE (`api.ts`):** `renameTeam(teamId, name)` (PATCH). **FE (`components/Dashboard.tsx`):** an
  inline rename control on a team row (a small edit affordance / dialog), refetch teams after.
- **Tests:** BE — rename updates the name; a foreign team → 404; empty name → 422. FE — the control
  calls `renameTeam` + refetches.

## Feature 3 — Per-run history drill-down

`TeamSummary.last_run` shows only the LATEST run per team. Add the full per-run history behind a
team row, reusing the join that already exists.
- **BE (`control_plane/teams.py`):** `list_team_runs(team_id, owner_id)` returning ALL runs of a
  library team, newest first, each `{run_id, status, idea, created_at, cost_total_usd}`. Reuse the
  EXACT clone→origin link `_run_rollup_by_origin` / `_team_run_teardown_targets` use (the run's clone
  node `cloned_from_node_id` → the origin library-team node), with `DISTINCT` to collapse the
  node-count fan-out to one row per run. Owner-checked (404 on a foreign team; `[]` for a never-run
  team).
- **BE (`routers.py`):** `GET /api/teams/{team_id}/runs` → owner-scoped list.
- **FE (`api.ts`):** `getTeamRuns(teamId)` + a `TeamRunRow` type. **FE (`components/Dashboard.tsx`):**
  a drill-down from a team row (an expander / panel) listing its runs with status + spend + idea +
  time; each row can link to the run view by `run_id` (the existing run surface).
- **Tests:** BE — returns all the team's runs newest-first; owner-isolation (foreign → 404); a
  never-run team → `[]`. FE — the drill-down renders the run list.

## Files you will touch (expect overlap with A — see rules)
- NEW `backend/tvashtr/control_plane/workspace_reaper.py`; `backend/tvashtr/main.py` (boot sweep +
  the run-end teardown call site); `backend/tvashtr/control_plane/teams.py` (rename + history);
  `backend/tvashtr/routers.py` (PATCH team + GET team runs).
- `frontend/src/lib/api.ts` (`renameTeam`, `getTeamRuns` + type);
  `frontend/src/components/Dashboard.tsx` (+ its test) — rename control + drill-down.
- New backend tests under `backend/tests/`; `Makefile` (the `workspace-gc-check` target).

## Gates (run them ALL yourself to green before READY_TO_MERGE)
- `make test` backend floor **≥ 904**; vitest floor **≥ 379**; `make lint` fully clean.
- `make workspace-gc-check` green (docker-free).
- Reproduce-first tests as named (RED on pre-change code, GREEN after).
- Invariant-as-evidence: alembic head STAYS `0030` (NO migration); `workspace_reaper.py` is
  openhands-free at import + never-raises (state how you proved both — an import-time AST/`ast`
  check + the never-raises tests, like clone_reaper's); the periodic sweep is Fly-gated on the
  decorator (offline suite arms no poller).
- Optional: a Playwright screenshot of the dashboard rename + the drill-down.
- **No docker live gate is required** — the GC proof is the offline `workspace-gc-check` + the
  reproduce-first sweep test. (See the reaper caution below.)

## Parallel-batch rules (Session B)
- You run in your OWN worktree with your OWN DB + ports — do not touch another checkout.
- **Expect merge overlap** in `api.ts`, `routers.py`, `main.py`, and the `Makefile` with the other
  session. That is fine and planned — the operator resolves conflicts at merge time. Write the clean
  version in your files; do not contort your design to dodge overlap.
- **Do NOT run any docker-backed live gate.** A second session is running concurrently and the boot
  container-sweep can reap a live agent container across sessions (the M-reaper history). Nothing in
  this slice needs one — the workspace GC is proven offline.
- Migration freeze is HARD: do not create migration `0031`. Rename is an UPDATE, history is a SELECT,
  the reaper is filesystem-only — all migration-free by design.
