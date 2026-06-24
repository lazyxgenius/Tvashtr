# Tvashtr — Autonomous Execution State

## Current Milestone
P1.5c §14.3 — the team A/B **comparison view** (finishes §14, the "which config ships better"
attributability instrument) — **DONE, offline-green, adversarially reviewed, READY_TO_MERGE**.
READ + FE only: the only backend product file changed is `routers.py`; no migration (head stays
0011), no executor change. §14.1 (verdict view) + §14.2 (A/B pair+launch) + verdict-reasons
persistence already merged; this is the last §14 milestone.

## Last Completed Step
P1.5c §14.3 (A/B comparison view) — 2026-06-24 — branch: feat/p1.5c-ab-comparison —
make test 171 GREEN, lint clean, alembic head 0011 (no migration), npm build clean, vitest 67 GREEN,
Playwright functional gate green, adversarial multi-agent review 0 blocking / 0 major (5 nits, all
fixed). READY_TO_MERGE.

## In Progress
None — §14.3 is implemented, offline-green, browser-functional-verified, and adversarially reviewed
(0 blocking / 0 major; 5 nits found AND all fixed, gates re-green). Awaiting operator FF-merge of
feat/p1.5c-ab-comparison + the operator's live visual smoke (the docker A/B + the forced-revision
reasons render — NOT on the offline path). With this, **§14 is complete**. NEXT (per §13 re-aim,
Tvashtr-17): the "value proven" path — Supervisor-first onboarding (P1.8) + the living-document
steering surface (P1.7), both ahead of WebSocket polish (P1.6).

## Completed Steps (append-only, newest last)
- [x] P1.5c §14.3 — A/B comparison view: routers.py 1a (additive `outcome_detail` on the graph
  endpoint's per-node invocations) + 1b (new `GET /api/ab-runs/{pair_id}` — ordered sides, derived
  team_shape, review_rounds w/ reasons, DBOS workflow_status, <2-run-pair tolerance, 404 on zero /
  400 on bad uuid); FE: lib/api.ts AB types + startABRuns/getABComparison, lib/status.ts exports the
  terminal sets, NEW pure lib/abCompare.ts (+ abCompare.test.ts, 24 tests), NEW components/ABCompare.tsx
  (+ abcompare.css), App.tsx segmented "Single run | A/B compare" mode toggle (state, no router),
  SidePanel ReviewerView reasons fold-in (+ panel.css `.tv-verdict__reasons`). NO migration / NO
  executor change — team_run.py / control_plane/* / models.py / engines/* / alembic untouched. —
  feat/p1.5c-ab-comparison @ b420da8 — 2026-06-24
- [x] P1.5c §14.2 — A/B pair + launch: migration 0010 (nullable pair_id [indexed
  ix_runs_pair_id] + pair_label on runs), POST /api/ab-runs (one idea -> two paired runs
  A=two_node / B=review_loop, same idea + same budget cap, each its own workflow keyed on its
  run_id), _run_to_dict surfaces the pairing, tests/test_ab_pair.py (offline, launch stubbed).
  NO executor change — team_run.py / teams.py / migrations 0001-0009 untouched. —
  feat/p1.5c-ab-pair @ 48e50d3 — 2026-06-23
- [x] P1.5c — verdict-reasons persistence: migration 0011 (nullable agent_invocations.outcome_detail)
  + one surgical team_run.py call-site persisting verdict["reasons"]. — main @ 7bf5e14 — 2026-06-23
- [x] Step 0 — provider-agnostic LLM routing (`agent_llm_routing` resolves api_key per
  provider on the proxy-OFF path) — feat/p1.5c-provider-routing @ 86a6685 — 2026-06-23
- [x] Step 1 — `config.TASK_LIST_IDEA` capstone feature, `routers.resolve_run_idea` seeding,
  `loop_run.py` feature mode, `make loop-feature-docker`, +8 routing/task tests; LIVE DOCKER
  ACCEPTANCE GREEN. — feat/p1.5c-capstone-live @ 254c14d

## Blocked
None.

## Acceptance evidence (§14.3)
- `git diff --stat main`: backend = ONLY `backend/tvashtr/routers.py` (product) + `tests/test_ab_compare.py`
  (new) + `tests/test_graph_endpoint.py` (extended). Do-not-touch list (team_run.py, control_plane/
  invocations.py, control_plane/teams.py, models.py, engines/*, alembic/versions/*) ALL untouched
  (`git diff --name-only main --` over them is empty). Alembic head still `0011_invocation_outcome_detail`.
- `make test` → **171 passed** (>167 baseline; +4 test_ab_compare.py). `make lint` → clean (74 files).
- `cd frontend && npm run build` → tsc + vite clean. `npm test` → **67 passed** (>43; +24 abCompare.test.ts).
- No new npm/pip dep (package.json / pyproject.toml not in the diff). Mode toggle is React state, no router.
- Playwright functional gate (localhost:5173): the segmented toggle renders + switches; "A/B compare"
  renders <ABCompare/> (Run button + hint + honest empty state); the "Single run" view is unchanged on
  round-trip; 0 console errors. (Screenshots saved to the session scratchpad, not committed.)
- Adversarial multi-agent review (4 dims -> verify): **0 blocking / 0 major**; 5 nits ALL fixed
  (canonical pair_id echo; B-side workflow_status assert; dead ABStatusTone "idle"; abHeadline derived
  loser status word; segmented control role=group/aria-pressed). Gates re-green after the fixes.

## Deviations / decisions (PROJECTPLAN.md didn't specify) — two-way-door, logged
- **DBOS status read placement:** `get_ab_comparison` reads `DBOS.get_workflow_status` AFTER the ORM
  session closes (build per-side dicts in-session carrying a temp `workflow_id`, pop+enrich after) —
  mirrors the established `get_run` / `cancel_run` separation (DBOS status is read off its own
  connection, not co-mingled with the SQLAlchemy session).
- **team_shape derived from the graph, not the label:** the side's `team_shape` is `review_loop` iff a
  reviewer AgentNode exists in the run's graph, else `two_node` — so a mislabeled pair can't misreport
  its shape (the brief asked for this).
- **abCompare delta semantics:** the headline is computed from terminal outcome + ship-tag + the
  review_loop side's round count — NOT a ship-sha compare (two runs always ship distinct commits;
  per the brief). A deliverable file-content diff is explicitly out of v1 scope.
- **`abSideStatus` is a parallel side-shaped helper** (not a refactor of `deriveOverall`) reusing the
  same labels/tones, so the single-run banner path stays byte-for-byte unchanged.
- **Mode toggle keeps the single-run poll alive underneath** (plain `mode` state, no router) so
  switching to A/B and back is lossless and the "Single run unchanged" invariant holds.
- **Review nit (autonomous):** abHeadline's one-shipped branch now interpolates the DERIVED status
  word (`abSideStatus(loser).label.toLowerCase()`) rather than the brief's literal raw `run.status`,
  so a side terminal only via `workflow_status` doesn't read a live-sounding "running" in a terminal
  verdict. Strictly more honest; the acceptance test stays green.

## Open Questions
- None blocking. (Cosmetic: the A/B view has no cancel/kill affordance for an in-flight pair — single-run
  has one; registered as a deferred follow-up, not in §14.3 scope.)

## Test Count
171 offline tests passing — 2026-06-24 (167 baseline + 4 new test_ab_compare.py). ruff clean.
67 vitest passing (43 baseline + 24 new abCompare.test.ts).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.5c-ab-comparison, sha=b420da8, tests=171 passing
  (make test 171 GREEN [167 baseline + 4 new test_ab_compare.py]; make lint clean; alembic head 0011 —
  NO migration; git diff --stat backend = ONLY routers.py + 2 test files, do-not-touch list [team_run.py,
  control_plane/invocations.py, control_plane/teams.py, models.py, engines/*, alembic/versions/*]
  UNTOUCHED; npm run build clean; vitest 67 GREEN [43 baseline + 24 abCompare.test.ts]; no new dep;
  mode toggle is React state not a router; GET /api/ab-runs/{pair_id} tolerates a <2-run pair [404 only
  on zero rows]; Playwright functional gate green [toggle switches, A/B view renders, single-run
  unchanged, 0 console errors]; adversarial multi-agent review 0 blocking / 0 major, 5 nits all fixed).
  Operator's remaining gate = the LIVE visual smoke (docker A/B run + the forced-revision reasons render),
  which is off the offline path by design.
