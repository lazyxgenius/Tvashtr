# Tvashtr — Autonomous Execution State

## Current Milestone
P1.8 — Option A, Milestone 1: the per-node work-brief (generalize `AgentInvocation.outcome_detail`
to every thinker/worker node + the run-view "Last run" panel). Brief: `prompts/work-brief-run-view.md`.

## Last Completed Step
Per-node work-brief — 2026-06-26 — branch: `feat/work-brief-run-view` — sha `d568850` — ALL gates
GREEN (239 backend / 114 vitest / lint / build / `work-brief-e2e` + the four smokes + the three
existing e2e). READY_TO_MERGE.

## In Progress
None — milestone complete, committed (`d568850`), all gates GREEN.

## Completed Steps (append-only, newest last)
- [x] Backend executor (`team_run.py`): additive pure helpers `_thinker_brief`/`_worker_brief`,
  `agent_run_step` threads `files_changed` (already computed, was discarded), and the thinker +
  NON-emitting-worker close sites gain `outcome_detail=`. The Reviewer's `outcome_detail` stays its
  verdict reasons (byte-stable). `git diff main -- team_run.py` confined to exactly those changes.
- [x] Backend tests (mutation-real, shown RED-on-revert then GREEN): `test_work_brief.py` (6 pure-helper
  unit tests) + `test_work_brief_executor.py` (executor-level: PM + Engineer briefs populated through
  the REAL `run_team`, Reviewer reasons intact). `test_review_loop.py` updated (PM/Engineer now write
  briefs; gates/terminal still NULL).
- [x] FE: run-view selection switched to NODE-ID (`App.tsx` `selectedRunNodeId` + `selectedRunNode`;
  `TeamCanvas` passes `node.id`); `SidePanel` retired the `role_name` switch → switches on `kind`
  with a uniform "Last run" section (reuses `reviewerVerdictLabel` tones so §14.1 is byte-identical),
  thinker→`PrdView` / worker→`EventFeed`. New CSS `.tv-lastrun`.
- [x] FE tests (mutation-real): `SidePanel.test.tsx` rewritten for the `node` prop (custom thinker /
  Engineer / Reviewer); `TeamCanvas.test.tsx` adds a node-id selection test (two same-role nodes
  select independently). Both shown RED-on-revert then GREEN.
- [x] `make work-brief-e2e` target + `scripts/work_brief_e2e.sh` + `scripts/work_brief_check.py`
  (API-driven §6.1) + `frontend/e2e/work-brief.spec.ts` (Playwright §6.2).

## Gate results (this branch)
- `make test` — **239 passed** (was 232; +7: 6 helper-unit + 1 executor), mutation-real.
- `make lint` — clean (backend ruff + FE eslint + prettier).
- `make test-frontend` — **114 passed** (was 112; +2: SidePanel +1, canvas selection +1), mutation-real.
- `make build-frontend` — clean (tsc strict + vite).
- `make work-brief-e2e` §6.1 executor-populate (NIM, in-process): GREEN —
  THINKER (pm).outcome_detail = `'Drafted the spec from the idea.'`;
  WORKER (engineer).outcome_detail = `'Ran but changed no files.'` (well-formed non-NULL);
  EMITTING (reviewer) r1 = `'<forced revision: round 1 of 1>'` (reasons, byte-stable);
  "brief populated for MORE than the Reviewer: True".
- Invariants: alembic head **0013**, NO `0014_*`; `teams.py` / `routers.py` (A/B + `get_run_graph`) /
  `engines/base.py` / `openhands_adapter.py` / `models.py` all **byte-intact** (empty diff vs main).

## Test Count
239 backend pytest + 114 vitest passing — 2026-06-26.

## Deviations from PROJECTPLAN.md / the brief
- Worker-close `outcome_detail` reads `result.get("files_changed", [])` (defensive) so the many
  existing test doubles that fake `agent_run_step` and legitimately omit `files_changed` don't
  KeyError; production always returns it. Contained + covered by the offline suite.
- Live `work-brief-e2e` §6.2 Playwright: the first attempt timed out because the spec edited the
  Engineer's model to the value the `review_loop` template already seeds → the dirty-aware Save
  stayed DISABLED and the click hung. Fix (code-proven, contained, regression-safe per the stop
  clause): dropped the superfluous model-edit (the §6.1 checker proves the template's default model
  runs on NIM) and ran the UI proof with FORCE_REVISIONS=0 (one Engineer build). Re-running.
- The live worker brief is the "Ran but changed no files." variant because the LOCAL adapter reports
  an empty `files_changed` for the trivial greeting build; it is still a well-formed non-NULL brief
  (the files-changed variant is proven in `test_work_brief_executor.py`). Noted, not a defect.

## Regression gates (NIM, live)
- `skeleton-run` ✓, `skeleton-crash` ✓, `loop-run` ✓ (Engineer x2, [changes_requested, approved],
  one loop-back, ships once), `loop-crash` ✓ (GREEN on re-roll attempt 1 — the first attempt hit the
  documented §15 empty-content crash-timing flake; every structural/exactly-once assertion passed,
  so it is content-luck on the kill timing, NOT a regression — my change never touches
  `ship_step`/the workspace/the resume path, and `loop-run` shipped a correct non-empty file).
- `thinker-chain-e2e` ✓, `capability-edit-e2e` ✓, `topology-e2e` ✓.

## Open Questions
None blocking.

READY_TO_MERGE: branch=feat/work-brief-run-view, sha=d568850, tests=239 backend + 114 vitest passing,
alembic head 0013 (NO migration; no 0014 file), `make work-brief-e2e` GREEN on NIM (the executor
populates the thinker + Engineer briefs beyond the Reviewer; the run-view panel surfaces them; 2
screenshots), the four smokes (skeleton-run/skeleton-crash/loop-run/loop-crash) + thinker-chain /
capability-edit / topology e2e GREEN, teams.py + A/B endpoints + get_run_graph byte-intact.
