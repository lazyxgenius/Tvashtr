# Tvashtr — Autonomous Execution State

## Current Milestone
Option A, Milestone 2 — the authoring-panel "Last run" brief + the `cloned_from_node_id` linkage.
Brief: `prompts/m2-authoring-brief-linkage.md`.

## Last Completed Step
M2 authoring-brief linkage — 2026-06-26 — branch: `feat/m2-authoring-brief-linkage` — sha `5f65904` —
ALL gates + the full regression chain GREEN. READY_TO_MERGE.

## In Progress
None — milestone complete, committed, all gates + regression GREEN.

## Completed Steps (append-only, newest last)
- [x] Backend: `AgentNode.cloned_from_node_id` (plain Uuid, nullable, indexed — NO FK) + `index=True`
  on `AgentInvocation.node_id`; migration **`0014`** (column + both indexes; real downgrade); ORM↔DB
  drift-free (`alembic check`), downgrade→upgrade round-trip verified.
- [x] `clone_team_graph` sets `cloned_from_node_id=n.id` on every clone node (one added line).
- [x] `GET /api/teams/{id}/graph` attaches `last_run` per node via ONE `DISTINCT ON (cloned_from_node_id)
  … ORDER BY started_at DESC` read (the new `_latest_invocation_by_origin` helper). Run-view endpoint
  + A/B + builders byte-intact.
- [x] Backend tests (mutation-real): `test_authoring_brief.py` — keystone (links clone invocations to
  authored PM/Engineer nodes; never-run node → None) + decision-b (latest-across-runs + survives a
  later run that skipped a node). RED-on-mutation shown (revert clone set → all `last_run` None).
- [x] FE: shared `components/LastRun.tsx` (rounds-based + optional `provenance` → relative-time tag),
  `lib/time.ts` `formatRelativeTime`, `lib/text.ts` `titleCase`, `api.ts` `last_run` type,
  `TeamNodePanel` read-only "Last run" section (not in the dirty-check), `SidePanel` re-uses the
  shared `LastRun` (no provenance → byte-identical; `SidePanel.test.tsx` unchanged). `App.tsx`
  needed no change — `handleEditTeam` already re-fetches the authoring graph on return-to-authoring.
- [x] FE tests: `LastRun.test.tsx`, `lib/time.test.ts`, `TeamNodePanel.test.tsx` (+3).
- [x] `make authoring-brief-e2e` + `scripts/authoring_brief_e2e.sh` + `frontend/e2e/authoring-brief.spec.ts`.
- [x] Bumped `.claude/hooks/protect-migrations.sh` freeze regex → `^00(0[1-9]|1[0-4])_` (0001–0014).

## Gate results (this branch)
- `make migrate` — head **`0014`**; `alembic check` drift-free; downgrade→upgrade round-trip clean.
- `make test` — **241 passed** (was 239; +2 M2 keystone/decision-b), mutation-real RED-on-revert shown.
- `make lint` — clean (backend+scripts ruff + FE eslint + prettier).
- `make test-frontend` — **126 passed** (was 114; +12: LastRun 3, time 6, TeamNodePanel +3).
- `make build-frontend` — clean (tsc strict + vite).
- `make authoring-brief-e2e` — **GREEN on NIM**: ran review_loop, returned to authoring, clicked the
  PM node → panel shows "Drafted the spec from the idea." + a relative-time tag; screenshot at
  `/tmp/tvashtr_authoring_brief_shots/authoring-pm-last-run.png`.
- Invariants: `git diff main -- team_run.py` EMPTY; `engines/*` byte-intact; `teams.py` = only the
  `clone_team_graph` line; `routers.py` confined to `get_team_graph` + the helper; exactly one new
  `0014`, frozen `0001`–`0013` untouched.

## Test Count
241 backend pytest + 126 vitest passing — 2026-06-26.

## Deviations from PROJECTPLAN.md / the brief
- The brief's API sketch had `LastRun` take a single `outcome`/`outcomeDetail`; M1's actual run-view
  `LastRun` renders a per-round LIST (`rounds: NodeInvocation[]`). I extracted it AS-IS (rounds-based
  + optional `provenance`) so the run-view render is byte-identical (`SidePanel.test.tsx` unchanged);
  the authoring view passes its single `last_run` as a one-element rounds list. `titleCase` moved to
  `lib/text.ts` (shared by `SidePanel`'s `nodeTitle` + `LastRun`).
- The e2e creates a fresh `review_loop` team via "+ New team" rather than the literal seeded "My team"
  (deterministic regardless of prior DB state; same template, identical proof).
- Fixed a latent M1 lint miss: `scripts/work_brief_check.py` had E501s (the M1 process linted before
  that script existed). Wrapped/shortened the long lines (no behavior change; the e2e exit code is
  unchanged). Committed separately. (Real paths used: `control_plane/{team_run,teams}.py`, per disk.)

## Regression gates (NIM, live, on a clean dev DB)
- `skeleton-run` ✓, `skeleton-crash` ✓ (attempt 1), `loop-run` ✓, `loop-crash` ✓ (attempt 1),
  `thinker-chain-e2e` ✓, `capability-edit-e2e` ✓, `topology-e2e` ✓, `work-brief-e2e` ✓ →
  `ALL_REGRESSION_GREEN`. (A first `skeleton-crash` run hit the documented §4.5 stale-parked-runs
  recovery-stall hang from this session's accumulated PENDING workflows — NOT an M2 regression [my
  diff doesn't touch crash-resume]; cleared by a `docker compose down -v` dev-DB reset, then green.)

## Open Questions
None blocking.

READY_TO_MERGE: branch=feat/m2-authoring-brief-linkage, tip=5f65904 (feat) on 567a3d0 (chore),
tests=241 backend + 126 vitest passing, alembic head 0014 (exactly one new migration; freeze bumped
to 0001-0014), make authoring-brief-e2e GREEN on NIM (screenshot saved), the 4 smokes + thinker-chain
/ capability / topology / work-brief e2e GREEN, git diff main -- backend/tvashtr/control_plane/team_run.py
EMPTY + engines/* byte-intact + teams.py one-line change + run-view/A-B endpoints + builders byte-intact.
