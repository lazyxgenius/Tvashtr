# Tvashtr — Autonomous Execution State

## Current Milestone
P1.8c — the generic thinker + capability authoring (brief: `prompts/p1.8c-thinker-capability.md`).
Make a completion ("thinker") node composable ANYWHERE (not start-node-only); make a node's
capability (thinker ↔ worker) an editable authoring field with the start-node-must-be-a-thinker
invariant; ship a `thinker_chain` library template (PM → Architect → Engineer). **NO migration —
alembic head stays 0013.** — **DONE, all gates green incl. both live e2e + the 4 regression smokes,
READY_TO_MERGE.**

## Last Completed Step
P1.8c — 2026-06-25 — branch: feat/p1.8c-thinker-capability — `make test` **209** (was 202),
`make lint` clean, `make test-frontend` **95** (was 93), `make build-frontend` clean, alembic head
**0013** (NO migration), live `make thinker-chain-e2e` + `make capability-edit-e2e` GREEN, the 4
regression smokes (skeleton-run/skeleton-crash/loop-run/loop-crash) GREEN on the NIM agent model.
READY_TO_MERGE.

## In Progress
None — P1.8c is implemented and every gate is green. Awaiting operator FF-merge of
feat/p1.8c-thinker-capability (and the operator re-eyeball of the new Capability toggle / Architect
card, the visual gate). NEXT P1.8 slices (HANDOVER §4): canvas topology editing (`nodesConnectable`
ON / node+edge CRUD), then mid-run node-prompt re-read.

## As-built (backend)
- `control_plane/team_run.py` — generalized the `run_graph` **completion branch** to a first-vs-later
  dispatch on `pm_document_id` (NO start-node special-case, NO non-start fail — the pivot's last
  fixed-function residue is gone). The FIRST thinker (root) still runs **`pm_step` byte-identical**
  (same signature/body + `pm-llm`/`pm-prd-v1` keys); a LATER thinker runs a NEW purely-additive
  `@DBOS.step thinker_refine_step` (reads the current spec via the recorded `read_latest_prd_step`,
  refines it, appends a `DocumentVersion` `created_by="agent:thinker"`, idempotent on
  `…:thinker-llm:{node}:{n}` + `…:spec:{node}:{n}`). Crash-safe: `is_first = pm_document_id is None`
  recomputes deterministically on replay. `agent_run_step`, `read_latest_prd_step`,
  `engineer_setup_step`, the engine adapters — UNCHANGED.
- `routers.py` — `UpdateTeamNodeRequest` gains optional `capability: Literal["thinker","worker"] |
  None` (omitted = unchanged, back-compat). Pure `_capability_to_columns` (thinker→(completion,None);
  worker→(agent,openhands)). `_team_root_node_id` (the node not targeted by any edge — mirrors
  `load_graph_step`). In `update_team_node`, after the gate/terminal 409, a capability flip is a
  paired kind+engine write, with a **409 if `worker` is asked of the ROOT** ("the first node scopes
  the work — it must stay a thinker"). A/B endpoints + `_AB_CONFIGS` + `_TEAM_BUILDERS` UNCHANGED.
- `control_plane/teams.py` — ADDED `ARCHITECT_PROMPT` (a thinker that restates the PM's spec verbatim
  + appends a `## Technical design` section) + `build_thinker_chain_team` (PM→Architect→prd_gate→
  Engineer→ship/stop, linear, no review loop) + the `thinker_chain` catalog entry. `clone_team_graph`,
  `build_two_node_team`, `build_review_loop_team`, `seed_library_if_empty` BYTE-INTACT (the diff is
  ADDITIONS-ONLY — 0 removed lines).

## As-built (frontend)
- `lib/api.ts` — `Capability` type; `updateTeamNode(teamId,nodeId,prompt,model,capability?)` includes
  `capability` in the PATCH body ONLY when provided (existing 4-arg call sites unchanged).
- `panel/TeamNodePanel.tsx` — a **Capability** segmented control (Thinker | Worker) above Prompt; new
  `isStartNode` prop locks it to Thinker (disabled + tooltip) — defense-in-depth on the backend 409.
  Capability is in the dirty check (flipping it alone enables Save) and posted on Save. Caption under
  the control. Added `architect → "Architect"` title.
- `App.tsx` — computes the start node (not targeted by any edge) from `teamGraph.edges`, passes
  `isStartNode={selectedTeamNode?.id === startNodeId}`.
- `canvas/AgentNodeCard.tsx` — Architect role (title/blurb/`DraftingCompass` icon); the meta line now
  carries the capability label (Thinker/Worker) so a flip RE-LABELS the card. Token-driven; one
  `index.css` rule for the locked toggle (`.tv-seg__btn:disabled`).

## Tests (mutation-real)
- `backend/tests/test_thinker_chain.py` (NEW, keystone): REAL `run_team` over `thinker_chain`, faking
  only `complete` + the worker; asserts the spec doc has **exactly 2 versions** (PM v1 + the non-start
  Architect's v2), the worker read the REFINED spec (both markers), `completed` + one ship tag, both
  thinkers `done/prd_written`. **Mutation proven in-transcript:** restoring the non-start-completion
  `else`-fail → RED (`FAILED test_thinker_chain_runs_the_non_start_thinker_and_ships`); restored
  byte-identical → GREEN (`1 passed`).
- `backend/tests/test_capability_edit.py` (NEW, +6): `_capability_to_columns` mapping; non-root
  thinker↔worker flip persists (re-read the row); worker-on-root → 409 (row unchanged); thinker-on-root
  allowed; capability omitted leaves kind/engine unchanged (back-compat); flip + prompt/model in one
  PATCH.
- `backend/tests/test_team_library.py` — the 2 catalog assertions updated to include `thinker_chain`.
- `frontend/src/panel/TeamNodePanel.test.tsx` (+2): the toggle renders + seeds from kind; flipping it
  alone enables Save + PATCHes the new capability; `isStartNode` disables/locks the toggle.

## Live targets (NEW)
- `make thinker-chain-e2e` (`scripts/thinker_chain_e2e.sh` + `scripts/thinker_chain_check.py`,
  in-process TestClient): real models, instantiate `thinker_chain`, run it, assert ships once + spec
  has 2 versions.
- `make capability-edit-e2e` (`scripts/capability_edit_e2e.sh` + `frontend/e2e/capability-edit.spec.ts`,
  Playwright): open a fresh `thinker_chain` team, flip the Architect thinker→worker, Save, assert the
  flip persists (kind=agent/engine=openhands), the canvas re-labels it Worker, and the PM toggle is
  locked.

## Acceptance evidence (all green — 2026-06-25)
- `make test` → **209 passed** (was 202; +7 = 1 keystone + 6 capability). Keystone mutation RED→GREEN
  demonstrated in-transcript.
- `make lint` → clean (backend+scripts ruff check+format + FE eslint `--max-warnings 0` + prettier).
- `make test-frontend` → **95 passed** (was 93; +2 TeamNodePanel toggle/start-lock).
- `make build-frontend` → clean (tsc --noEmit strict + vite).
- `make thinker-chain-e2e` → **GREEN** (real models): run_id f99665cc-…; `completed`; ship tag
  `ship-f99665cc-…`; spec **versions=2 authors=['agent:pm','agent:thinker']` (the non-start Architect
  refined it).
- `make capability-edit-e2e` → **GREEN** (`1 passed`): flip persisted (kind=agent/engine=openhands),
  canvas re-labelled Worker, PM toggle locked.
- Regression smokes (TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct), single-thinker path:
  - `make skeleton-run` → GREEN: completed, shipped once, committed file matches, **pm-llm cost row
    present**, agent-cost present.
  - `make skeleton-crash` → GREEN: one ship tag/commit, one PRD version (held across crash), one
    agent-cost, **one pm-llm CostRecord**.
  - `make loop-run` → GREEN: Engineer [1,2], Reviewer [changes_requested, approved] (one loop-back),
    one ship tag.
  - `make loop-crash` → GREEN: mid-iteration-2 resume (attempt pids [90206,90206,91130,91130]),
    Engineer×3, Reviewer [cr,cr,approved], ship once.
- Byte-intact (disk-verified): `git diff main -- teams.py` is ADDITIONS-ONLY (0 removed lines →
  `clone_team_graph`/`build_two_node_team`/`build_review_loop_team`/`seed_library_if_empty`
  byte-intact); `pm_step` byte-identical incl. `pm-llm`/`pm-prd-v1`; `agent_run_step` /
  `read_latest_prd_step` / `engineer_setup_step` / `engines/*` / `shipping.py` / `models.py`
  UNCHANGED; routers A/B endpoints + `_AB_CONFIGS` + `_TEAM_BUILDERS` UNCHANGED.
- `git diff --stat main` over `backend/alembic/versions/` is **EMPTY** — NO migration; `alembic heads`
  = **0013_team_graph_is_library**. (The `protect-migrations.sh` freeze needs no bump this slice.)

## Known M1 limitation (for the architect → PROJECTPLAN §15)
On the FIXED templates a capability flip can produce a **nonsensical-but-runnable** graph (e.g.
flipping `review_loop`'s Reviewer to a thinker routes via the loop-back catch-all; flipping a node's
capability without updating its prompt is a prompt/capability mismatch). EXPECTED — the only invariant
the executor needs this slice (**the root is a thinker**) is enforced. Holistic graph-validity (a
thinker must run before any worker on every path; capability/prompt coherence) arrives with the M2
topology-editing slice. No broader validity added here (scope).

## Deviations / decisions (two-way-door, logged)
- **The panel posts `capability` on every Save** (like prompt/model), not only when the toggle moved.
  The backend write is idempotent (re-writing the same kind/engine is a no-op) and the start node
  always posts "thinker" (allowed). Consequence: the existing `TeamNodePanel.test.tsx` body assertion
  was updated to include `capability` — expected (T10 extends that test).
- **`thinker-chain-e2e` is an in-process TestClient checker** (mirrors `skeleton_run.py`), not a
  separate-backend Playwright run — it is API-only (no UI), so a separate backend/Vite is unnecessary;
  the `.sh` is the self-contained db-up+migrate+checker wrapper the brief asked for.
- **`capability-edit-e2e` keeps the `NVIDIA_BUILD_API_KEY` skip guard** (mirrors its siblings) even
  though it runs no agent — so it skips cleanly in a keyless CI, consistent with the other e2e.

## Blocked
None.

## Test Count
**209** offline backend pytest (was 202) + **95** vitest (was 93). `make lint` clean. alembic head
**0013** (NO migration).

## READY_TO_MERGE
READY_TO_MERGE: branch=feat/p1.8c-thinker-capability, sha=<this commit — echoed in the loop report>,
backend tests=209 passing, frontend vitest=95 passing. P1.8c — the generic thinker (a completion node
composable anywhere) + capability (thinker↔worker) authoring + the `thinker_chain` template. Gates:
`make test` 209; `make lint` clean; `make test-frontend` 95; `make build-frontend` clean;
`make thinker-chain-e2e` GREEN (ships once + spec 2 versions, real models); `make capability-edit-e2e`
GREEN (flip persists + re-labels + PM locked); the 4 regression smokes (skeleton-run/skeleton-crash/
loop-run/loop-crash) GREEN on NIM. Keystone mutation RED→GREEN demonstrated. Byte-intact: teams.py
additions-only (clone/builders/seed unchanged), pm_step byte-identical (pm-llm/pm-prd-v1 keys),
agent_run_step / read_latest_prd_step / engines / shipping / models.py UNCHANGED, A/B endpoints
UNCHANGED. NO migration — alembic head 0013. Architect-owned PROJECTPLAN.md / HANDOVER.md /
prompts/p1.8c-thinker-capability.md left for the architect's own doc closeout (not staged/committed
by this step).
