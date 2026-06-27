# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield (Phase 1.5) — local execution / "work on a real local folder" run mode.
**Slice 2** (the launch-panel UI, FRONTEND-ONLY). Brief: `prompts/brownfield-2-launch-panel.md`.

## Last Completed Step
M-brownfield Slice 2 — 2026-06-27 — branch: `feat/brownfield-launch-panel` — sha `5a99fc9` —
ALL acceptance gates GREEN (incl. the live `make launch-panel-e2e`, 3 screenshots). READY_TO_MERGE.

## In Progress
None — Slice 2 complete, committed, all gates GREEN. (Slice 1 — the backend run mode — was
FF-merged to `main` @ `6530ddb`, alembic head `0015`.)

## Completed Steps (append-only, newest last)
- [x] **`lib/api.ts`** — `runTeam(teamGraphId, opts?: { idea?; repo_path?; base_ref? })` adds each
  field to the POST body ONLY when set (a no-opts call posts `{ team_graph_id }` byte-for-byte);
  `inspectRepo(path)` + a discriminated `RepoInspect` type; `repo_path?`/`base_ref?`/`ship_branch?`
  on `RunRow`; `LARGE_REPO_FILE_THRESHOLD` (=300, lives here so the component file exports only
  components — Fast Refresh).
- [x] **`components/LaunchPanel.tsx`** + `.tv-launch*` in `index.css` — the D5 launch panel: a quiet
  hairline `tv-card` popover (no new heavy modal chrome) reusing `tv-field`/`tv-seg`/`tv-validity`.
  A feature-request `<textarea>`; a "work on a local repo" toggle revealing a typed repo-path
  `<input>` (inspect on blur; `is_git:false` → inline `tv-validity` error + Run-into-repo disabled;
  `is_git:true` → a base-branch `<select>` defaulted to `current_branch`); the D4 large-repo
  advisory shown when `tracked_file_count > LARGE_REPO_FILE_THRESHOLD`, naming the worker nodes
  (`kind==="agent"` → `role_name`; omitted if none), dismissible, NEVER auto-changing a model.
- [x] **`App.tsx`** — "Run this team" now OPENS the panel (gated on the existing `teamRunnable`);
  `handleLaunch(opts)` does `runTeam(opts)` + `getGraph` + `setRunId` — the SAME run-view takeover
  as before. The greenfield call path (no opts) is unchanged.
- [x] **`components/RunBanner.tsx`** — a brownfield `branch` Item (`run.ship_branch`) when set; the
  greenfield `ship`(tag/sha) Item otherwise.
- [x] Tests (vitest + RTL, **`fireEvent`** per HANDOVER §4): `api.test.ts` (6 — greenfield body
  shaping incl. the `{ team_graph_id }`-only contract + `inspectRepo` both discriminants),
  `LaunchPanel.test.tsx` (9 — opens, greenfield Run posts no extra fields, toggle reveal, inspect
  validation both ways, the **hint above threshold naming the worker `role_name`s** + below-threshold
  + dismiss, brownfield Run posts idea+repo_path+base_ref), `RunBanner.test.tsx` (3 — branch vs ship).
  The **App keystone** now drives the panel and asserts the greenfield POST body is `{ team_graph_id }`.
- [x] **`make launch-panel-e2e`** + `scripts/launch_panel_e2e.sh` + `frontend/e2e/launch-panel.spec.ts`
  — a real Playwright proof (NO agent run, NO NVIDIA key): the panel opens, a REAL fixture git repo
  validates through a live `POST /api/repo/inspect` round-trip populating the base-branch dropdown
  (`trunk`), and the greenfield path still launches (`{ team_graph_id }` only → run-view takeover).
  Targeted selectors + a screenshot per check (NOT a whole-tree a11y snapshot, HANDOVER §4).
- [x] The **6 existing launch-clicking e2e specs** (authoring-brief, work-brief, team-edit,
  team-library, topology, steering) updated for the open-panel flow: click "Run this team" → click
  the panel's "Run". (`fix1_signoff` only asserts the Run button's enabled/disabled state — untouched.)

## Gate results (this branch) — every decisive line echoed into the /goal transcript
- `make test` — **`260 passed, 1 warning`** (the backend suite, UNCHANGED — no backend edits; the
  brownfield endpoints/payloads were merged in Slice 1).
- `make test-frontend` — **`Tests 144 passed (144)` / `Test Files 17 passed (17)`** (was 126; +18:
  api 6, LaunchPanel 9, RunBanner 3; the App keystone updated, not added).
- `make build-frontend` — **`✓ built`** (tsc-strict `--noEmit` + vite).
- `make lint` — **`All checks passed!`** (ruff) + eslint `--max-warnings 0` + **`All matched files
  use Prettier code style!`**.
- `make launch-panel-e2e` — **`LAUNCH-PANEL E2E PASSED`** / `1 passed`: CHECK 1 (panel opens),
  CHECK 2 (inspect round-trip → branch dropdown = `trunk`), CHECK 3 (greenfield launch, body
  `{ team_graph_id }` only, run-view takeover). Screenshots:
  - `/tmp/tvashtr_launch_panel_shots/check1-panel-open.png`
  - `/tmp/tvashtr_launch_panel_shots/check2-repo-validated.png`
  - `/tmp/tvashtr_launch_panel_shots/check3-greenfield-launched.png`
  (Visual self-sign-off: the panel matches the quiet hairline system — serif title, uppercase field
  labels, coral toggle/Run, ghost Cancel; the brownfield reveal shows the path + base-branch select.)

## Test Count
260 backend pytest (unchanged) + **144 vitest** (was 126) passing — 2026-06-27.

## Deviations from the brief / §15 items
- **`make test` (backend) was not re-run as a "changed" gate** — the slice makes ZERO backend edits
  (verified: `git status` shows no `backend/` changes), so the 260 count is definitionally unchanged;
  re-ran it once to echo the line.
- **6 existing e2e specs updated (necessary, not optional).** "Run this team" changing from
  fire-the-run to open-the-panel breaks any spec that clicked it to launch. They were updated with a
  single mechanical added click (the panel's "Run"); they are NVIDIA-gated operator-run gates, so
  they are lint-clean here but NOT live-verified this slice (the panel's own `launch-panel-e2e` IS
  live-verified). Flagged for the operator's regression pass.
- **The launch panel has no click-outside-to-close** (Cancel + the × close button suffice; the brief
  asked for a popover, not a focus-trapped modal). §15 candidate if a click-away is wanted.
- **Greenfield-launch e2e cancels the run it starts** (`POST /api/runs/{id}/cancel`) so no PENDING
  workflow lingers in the dev DB (the §4.5 stale-PENDING hazard) — the gate is the panel + inspect,
  not a full run.

## Open Questions
None blocking. The D6-grounding worker-gating carry-forward (from Slice 1, §17) is a BACKEND item —
out of scope for this FE slice.

READY_TO_MERGE: branch=feat/brownfield-launch-panel, sha=5a99fc9, frontend tests=144 vitest passing
(was 126), backend make test=260 UNCHANGED (no backend edits), make build-frontend (tsc-strict + vite)
green, make lint clean, make launch-panel-e2e PASS with 3 screenshots
(/tmp/tvashtr_launch_panel_shots/check{1-panel-open,2-repo-validated,3-greenfield-launched}.png).
Greenfield launch byte-for-byte: empty idea + toggle off posts `{ team_graph_id }` (asserted in the
App keystone + the e2e). No backend files touched; no migration; no new heavy modal chrome.
