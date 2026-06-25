# Tvashtr — Autonomous Execution State

## Current Milestone
P1.8d — Topology editing (author your own wiring) (brief: `prompts/p1.8d-topology-editing.md`).
Turn the read-only canvas fully editable: add / delete / rewire nodes and edges, with **live holistic
graph-validity** gating runs (a server-authoritative `create_run` guard + the FE mirror), node
**positions persist**, a **node palette** + **edge-role authoring** + the per-worker **emit-contract**,
and a **Blank team** seed. **NO migration — alembic head stays 0013; the executor `team_run.py` is
UNTOUCHED (empty diff); the `teams.py` builders are byte-intact.** — **DONE, all gates green incl. the
new `topology-e2e` + the 4 regression smokes + both existing e2e, READY_TO_MERGE.**

## Last Completed Step
P1.8d — 2026-06-25 — branch: feat/p1.8d-topology-editing — `make test` **232** (was 209), `make lint`
clean, `make test-frontend` **110** (was 95), `make build-frontend` clean, alembic head **0013** (NO
migration), `team_run.py` diff vs main **EMPTY**, live `make topology-e2e` GREEN (authored a graph from
a blank team → ran via UI → shipped; invalid graph blocked in UI + `create_run` 422), the 4 regression
smokes + `thinker-chain-e2e` + `capability-edit-e2e` GREEN on the NIM agent model. READY_TO_MERGE.

## In Progress
None — P1.8d is implemented and every gate is green. Awaiting operator FF-merge of
feat/p1.8d-topology-editing (and the operator re-eyeball of the new palette / edge-role editor / Run
validity surface — the visual gate). NEXT slices (HANDOVER §4): the per-node work-brief (Option A), then
mid-run node-prompt re-read (M3) → "converse with a node".

## As-built (backend)
- `control_plane/graph_validity.py` (NEW) — the PURE `validate_graph(nodes, edges) -> {errors,
  warnings, runnable}` gate. BLOCKs only un-runnable graphs (not exactly one root; a non-thinker root;
  a reachable node with no valid route for an outcome it emits; a dead-end; an unbounded loop; a
  bounded rework loop with no escalation exit), WARNs an orphan. **Reuses the executor's own
  `next_node` / `escalation_target`** (imported from `team_run`, which is otherwise untouched) so the
  verdict can never drift from how the walk actually routes. Plus `graph_dicts(session, graph_id)` — the
  DB loader into the dict shape the validator consumes (used by the guard, the validate endpoint, the
  tests).
- `routers.py` — node/edge **CRUD** + position persistence + the validity verdict, all team-scoped and
  `_require_library_team`-guarded (a run snapshot / A-B graph is never CRUD-able). `POST/DELETE
  …/nodes`, `POST/DELETE …/edges`, `POST …/positions`, `GET …/validate`. `CreateNodeRequest` maps the
  canvas vocabulary (thinker/worker/gate/terminal + an optional PM/Architect/Engineer/Reviewer preset
  seeded from the byte-intact `teams.py` prompt constants) onto the columns; `CreateEdgeRequest`'s
  `role` maps to `(edge_type, conditions)` (forward→null; branch→`{when}`; loop_back→`{loop_limit}`;
  escalation→`edge_type="escalation"`). `create_team` gains the `template == "blank"` sentinel. **The
  run-start guard:** `create_run` re-validates the authored graph BEFORE cloning and **refuses an
  invalid graph with a 422** carrying the structured errors. A/B endpoints + `_AB_CONFIGS` /
  `_TEAM_BUILDERS` UNCHANGED (diff-verified).
- `control_plane/teams.py` — ADDED `create_blank_team(name)` (the minimal valid skeleton: one root
  thinker → a Ship terminal, 2 nodes/1 edge — never a 0-node canvas the gate would reject). The diff is
  **ADDITIONS-ONLY (45/0)** — `build_two_node_team`/`build_review_loop_team`/`build_thinker_chain_team`/
  `clone_team_graph`/`seed_library_if_empty`/`create_team_from_template`/`_TEMPLATE_CATALOG`/
  `list_templates` BYTE-INTACT.
- `control_plane/team_run.py` — **UNTOUCHED** (`git diff main -- …/team_run.py` is EMPTY). The
  graph-driven executor already runs any rows it is given; authoring needs zero executor change.
- **NO migration** — `agent_nodes.position` (JSONB) holds layout; edges use the existing columns.
  Alembic head **0013**; `backend/alembic/versions/` diff vs main is empty.

## As-built (frontend)
- `lib/topology.ts` (NEW, pure) — `edgeRoleOptions` (offer only what the source supports),
  `closesLoop`/`reachableFrom`, `branchLabelsOf`, `escalationTargets`, `validityFlags`,
  `emitContract`/`applyEmitContract`, `withLayout`/`nextDropPosition`. `lib/api.ts` — the CRUD/validity
  client + types.
- `canvas/TeamCanvas.tsx` — an **editable mode**: `nodesConnectable` ON; `onConnect` opens the inline
  edge-role editor; `onNodesDelete`/`onEdgesDelete` → the delete endpoints; `onNodeDragStop` persists
  position; the rebuild keys on the node-id SET (so add/delete rebuild, a drag doesn't reset). Validity
  flags red-ring offending nodes/edges + dim orphans. The run view is unchanged.
- `canvas/NodePalette.tsx` (NEW) — the on-canvas tray: 4 blank primitives (thinker/worker/gate/Ship/
  Stop) + 4 role presets (PM/Architect/Engineer/Reviewer). `canvas/EdgeRoleEditor.tsx` (NEW) — the
  plain-language role editor (Then → / If approved/rejected → / When it outputs … → / a bounded Rework
  loop that ALSO authors its escalation exit — termination provable).
- `panel/TeamNodePanel.tsx` — a branch worker shows the **emit-contract** derived live from its edges +
  a one-click "write this into the prompt" (the Tvashtr-26 anti-drift mechanism). `App.tsx` wires the
  CRUD handlers + the validity state; **Run greys out** with a per-issue list when not runnable;
  authoring selection is by NODE ID (duplicate role names are now possible). `components/TeamsRail.tsx` —
  a **Blank team** option in the New-team picker. CSS in `canvas.css`/`index.css`/`panel.css`.

## Tests (mutation-real)
- `backend/tests/test_graph_validity.py` (NEW, +13) — each BLOCK code (no_root / multiple_roots /
  root_not_thinker / no_exit+dead_end / gate_no_branch / unbounded_loop / loop_no_exit) + the orphan
  WARN, each on a focused hand-built graph; the valid minimal + review-loop shapes; and the integration
  proof that all three code templates + the blank skeleton validate CLEAN.
- `backend/tests/test_topology_crud.py` (NEW, +10) — create (worker preset seeds ENGINEER_PROMPT; blank
  thinker empty prompt; gate/terminal config; terminal needs terminal_kind → 400); the four edge roles
  round-trip to the exact `(edge_type, conditions)`; off-team endpoint 404; delete-node cascades edges;
  delete edge; positions persist (re-read the row); library-guard (unknown/non-library → 404); and the
  run-start guard refuses an invalid graph with a 422.
- `frontend/src/lib/topology.test.ts` (NEW, +14) — the pure authoring helpers.
- `frontend/src/App.test.tsx` — added the `/validate` route to the fetch stub; the authoring keystone
  now targets the node card (not the new palette chip of the same label).

## Live targets
- `make topology-e2e` (NEW — `scripts/topology_e2e.sh` + `frontend/e2e/topology.spec.ts`, Vite +
  headless Playwright): from a **blank team**, author root thinker → Engineer → Ship (palette adds the
  worker; edges via the same team-edge CRUD the connect-gesture calls), **Run through the UI → it
  ships** (real NIM); PLUS an invalid graph (an unconnected node) greys out Run with the reason AND
  `create_run` is refused 422.

## Acceptance evidence (all green — 2026-06-25)
- `make test` → **232 passed** (was 209; +23 = 13 validity + 10 CRUD).
- `make lint` → clean (backend+scripts ruff check+format + FE eslint `--max-warnings 0` + prettier).
- `make test-frontend` → **110 passed** (was 95; +15).
- `make build-frontend` → clean (tsc --noEmit strict + vite).
- `make topology-e2e` → **GREEN** (2 passed): invalid graph → Run disabled + `create_run` 422; authored
  thinker→Engineer→Ship from a blank team → ran via UI → **SHIPPED** (run 1cbdfe38…, ship_tag
  ship-1cbdfe38…).
- `make skeleton-run` → GREEN (completed, committed file matches, pm-llm + agent-cost present).
- `make skeleton-crash` → GREEN (recovered to SUCCESS; one ship/commit, one PRD version, one pm-llm).
- `make loop-run` → GREEN (Engineer [1,2], Reviewer [changes_requested, approved], one loop-back, ship).
- `make loop-crash` → GREEN (resumed mid-iteration-2; Engineer×3, Reviewer [cr,cr,approved], ship once).
- `make capability-edit-e2e` → GREEN (flip persists + re-labels + PM locked — no FE regression).
- `make thinker-chain-e2e` → GREEN (non-start Architect refined the spec; shipped once; 2 versions).
- Invariants (disk + git verified): `git diff main -- …/team_run.py` **EMPTY**; `backend/alembic/
  versions/` diff vs main empty (alembic head **0013**, NO migration); `teams.py` diff **45/0**
  (builders byte-intact); A/B endpoints + `_AB_CONFIGS`/`_TEAM_BUILDERS` UNCHANGED (no diff hits).

## Deviations / decisions (two-way-door, logged)
- **`topology-e2e` authors the graph's edges through the team-edge CRUD endpoints (via Playwright's
  `request`) rather than a literal drag-to-connect gesture**, while the node-add IS driven through the
  canvas palette and the Run IS driven through the UI. Rationale: drag-to-connect on React Flow is flaky
  under headless Playwright; the connect/role/loop LOGIC is proven in `topology.test.ts`, and the
  CRUD endpoints the gesture calls are the same ones the e2e exercises. The e2e still proves the headline
  outcome end-to-end (author from a blank team → run → ship) + the invalid-graph UX + the server guard.
- **Authoring node-selection is by NODE ID** (not role name) — a topology-edited team can carry duplicate
  role names (two blank thinkers). The run view keeps its role-based selection.
- **The blank-team root thinker carries an empty prompt** ("blank primitive"); the e2e authors a PM
  prompt onto it before running (a blank prompt is structurally valid but writes no useful spec).

## Deferred (for the architect → PROJECTPLAN §15)
- **Gate/terminal config editing beyond drop-time** (rename a gate / flip a terminal post-drop) — the
  immediate follow-on; out of scope this slice.
- **User-authored custom presets** ("save your own") — Phase-4.
- **Thinker-as-router** (a thinker emitting a routing label) — needs a NEW executor harvest path for
  completion output; real executor work outside this wiring slice.
- The cosmetic `REVIEW_VERDICT.json` → `OUTCOME.json` rename (byte-intact discipline — the emit-contract
  templates the existing `REVIEW_VERDICT.json` contract).

## Blocked
None.

## Test Count
**232** offline backend pytest (was 209) + **110** vitest (was 95). `make lint` clean. alembic head
**0013** (NO migration).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.8d-topology-editing, sha=<this commit — echoed in the loop report>,
backend tests=232 passing, frontend vitest=110 passing. P1.8d — topology editing (author your own
wiring): node/edge CRUD + a pure `validate_graph` + a run-start 422 guard + a Blank-team seed
(backend, NO migration, `team_run.py` empty diff, `teams.py` additions-only); `nodesConnectable` ON +
a node palette + plain-language edge-role authoring (incl. the bounded rework loop with its escalation
exit) + the per-worker emit-contract + a live validity surface that greys out Run (frontend). Gates:
`make test` 232; `make lint` clean; `make test-frontend` 110; `make build-frontend` clean; `make
topology-e2e` GREEN (authored a blank team → ran via UI → shipped; invalid graph blocked in UI +
`create_run` 422, real NIM); the 4 regression smokes (skeleton-run/skeleton-crash/loop-run/loop-crash)
GREEN on NIM; `capability-edit-e2e` + `thinker-chain-e2e` GREEN. Invariants: `team_run.py` UNTOUCHED
(empty diff), NO migration (alembic head 0013), `teams.py` builders byte-intact (additions-only 45/0),
A/B endpoints UNCHANGED. Architect-owned PROJECTPLAN.md / HANDOVER.md / prompts/*.md left for the
architect's own doc closeout (not staged/committed by this step).
