# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield (Phase 1.5) — local execution / "work on a real local folder" run mode.
**Slice 1** (the BACKEND run mode). Brief: `prompts/brownfield-1-backend-run-mode.md`.

## Last Completed Step
M-brownfield Slice 1 — 2026-06-27 — branch: `feat/brownfield-backend-run-mode` — sha `cd56bcc` —
ALL acceptance gates GREEN (incl. the live `make brownfield-check` on real docker+NIM). READY_TO_MERGE.

## In Progress
None — Slice 1 complete, committed, all gates GREEN. Slice 2 (the launch UI) is a SEPARATE later
`/goal` — NO frontend was touched this slice.

## Completed Steps (append-only, newest last)
- [x] **Migration `0015_run_brownfield_target`** — nullable Text `runs.repo_path` / `base_ref` /
  `ship_branch` (down_revision `0014`; no FK/index, per-run read-by-id) + `models.py::Run` cols.
  `alembic upgrade head` → head **`0015`**.
- [x] **`control_plane/worktree.py`** (NEW, openhands-free, stdlib/subprocess only):
  `repo_inspect(path)` (discriminated `{is_git,…}`/`{is_git:False,error}`); `add_worktree(repo, ws,
  run_id, base_ref)` — idempotent worktree on `tvashtr/<run_id>` cut from `base_ref`, resume no-op
  if `.git` exists, reuses an existing branch; `build_repo_grounding(ws, basename)` (D6: conventions
  file pick+priority+~6 KB truncation + depth-capped structure outline + manifests + a transparency
  line + a procedural EDIT-in-place / land-in-the-real-module / run-tests-and-fix steer).
- [x] **`team_run.py` brownfield threading (greenfield call sites byte-for-byte unchanged):**
  `load_graph_step` surfaces `repo_path`/`base_ref`; `engineer_setup_step` reads them off the Run row
  and branches (brownfield → `add_worktree` + records `ship_branch`, NO workspace `.gitignore`;
  greenfield → exactly as before); `brownfield_grounding_step` (recorded `@DBOS.step`) computes the
  block once; `grounding` threaded into `agent_run_step` ONLY when non-None (greenfield omits the
  kwarg → existing offline suite passes UNTOUCHED); `agent_run_step` sets `workspace_mode`; `ship_step`
  surfaces `ship_branch`; the completed-terminal result dict surfaces `ship_branch`.
- [x] **`engines/base.py`** — `AgentTask.workspace_mode: Literal["greenfield","brownfield"] =
  "greenfield"` (additive + defaulted, exactly like `llm_api_key`).
- [x] **`engines/docker_runtime.py`** — `enumerate_push_files_git` = `git ls-files -c -o
  --exclude-standard -z` (tracked + untracked-not-ignored, incl. tracked dotfiles; excludes `.git`,
  honors `.gitignore`). Greenfield `enumerate_push_files` UNTOUCHED.
- [x] **`engines/openhands_docker_adapter.py`** — `_push_workspace`/`_pull_workspace` take a `mode`
  (default `"greenfield"` → byte-identical); brownfield push via `enumerate_push_files_git`, brownfield
  pull `find . -type f -not -path './.git/*'` (keeps dotfiles, drops `.git/` + the scaffolding dirs).
  `run()` threads `task.workspace_mode`.
- [x] **`routers.py`** — `POST /api/repo/inspect` (always-200 discriminated result); `CreateRunRequest`
  += `repo_path`/`base_ref` with 422 validation (non-git / unknown `base_ref`) + `base_ref` default to
  the repo's current branch + recording on the Run; greenfield create byte-for-byte unchanged;
  `_run_to_dict` additively surfaces `repo_path`/`base_ref`/`ship_branch`.
- [x] **`make brownfield-check` + `scripts/brownfield_check.py`** — the live real-repo gate.
- [x] Tests (TDD): `test_worktree.py` (9: repo_inspect, add_worktree create+resume, build_repo_grounding
  pick/priority/truncate/none + edit-in-place steer), `test_brownfield_executor.py` (1: REAL run_team
  on a fixture repo, worktree+grounding+workspace_mode+ship-to-branch, original HEAD untouched —
  adapter+PM faked, no docker/NIM), `test_brownfield_router.py` (6: inspect 200, create 422 paths,
  base_ref default + column recording + payload, greenfield NULL columns), `test_docker_runtime.py`
  (+1: `enumerate_push_files_git`), `test_docker_adapter.py` (+2: brownfield push uses git enum / pull
  keeps dotfiles & drops .git+scaffolding).
- [x] **`protect-migrations.sh`** freeze regex `^00(0[1-9]|1[0-4])_` → `^00(0[1-9]|1[0-5])_` (LAST
  step; verified: `0015`/`0014` blocked, `0016` allowed, hook still parses).

## Gate results (this branch) — every decisive line echoed into the /goal transcript
- `make migrate` — head **`0015_run_brownfield_target`**.
- `make test` — **`260 passed, 1 warning`** (241 session-start baseline + 19 new; never regressed;
  the full pre-existing suite passes UNTOUCHED = the greenfield-byte-intactness proof at unit level).
- `make lint` — **`All checks passed!`** (ruff check+format) + eslint `--max-warnings 0` + **`All
  matched files use Prettier code style!`**.
- `make seeding-smoke` — **`seeding round-trip OK = True`** (greenfield docker push/pull byte-intact).
- `make skeleton-run` — all checks True (greenfield LOCAL ship).
- `make loop-run` — **`ALL LOOP-RAN ASSERTIONS PASSED`** (greenfield LOCAL review loop; Engineer x2,
  Reviewer x2, one loop-back, ship once).
- `make loop-run-docker` — all assertions `[ok]` (greenfield DOCKER review loop; my mode-branched
  seeding defaults to greenfield → unchanged). [Flaked twice with DIFFERENT agent symptoms, passed
  clean on retry with no code change — confirmed agent/container flakiness, not a regression.]
- `make brownfield-check` — **`[brownfield-check] PASS`**: real docker+NIM two_node run landed
  `subtract` on branch `tvashtr/<run_id>` in a throwaway fixture repo, the fixture's own `pytest` is
  GREEN on that branch (`1 passed`), the user's ORIGINAL `main` HEAD is UNCHANGED, and the Run row
  carries `repo_path`/`base_ref`/`ship_branch`. [Needed grounding iteration + a retry — see below.]

## Test Count
260 backend pytest passing — 2026-06-27 (was 241). No frontend touched this slice (no vitest delta).

## Deviations from PROJECTPLAN.md / the brief (and §15 items registered)
- **`engineer_setup_step` reads `repo_path`/`base_ref` INSIDE the step** (the brief offered "read
  inside OR pass in — your call"). Chosen so the GREENFIELD call site (`engineer_setup_step(run_id)`)
  stays byte-for-byte unchanged → the ~9 existing executor-test fakes that stub a 1-arg
  `engineer_setup_step` pass UNTOUCHED (the strongest greenfield-intactness proof). Costs one benign
  extra SELECT on the greenfield path (invisible to behavior; those tests mock the step anyway).
- **`grounding` is passed to `agent_run_step` only when non-None** (brownfield), so the greenfield
  `agent_run_step` call is byte-identical and every existing greenfield test runs untouched. The
  brief's "greenfield passes None → nothing appended" is honored by EFFECT.
- **D6 grounding wording was iterated to clear the live gate.** First live `brownfield-check` runs
  exposed the real "correctness on existing code" problem (the brief's whole point): the NIM agent
  (a) `create`d an existing file (the OpenHands editor refuses → no change → "nothing to ship"), then
  (b) edited only the test, then (c) left a file with a missing import. The fix was a GENERAL, non-
  fixture-specific grounding steer (EDIT in place not `create`; land the code in the real MODULE not
  only a test; run the repo's tests and fix fallout before finishing) — NOT a weakening of the check.
  The check's assertions are unchanged. The agent is FLAKY (it succeeded fully on a later roll), so the
  gate needed a retry — the same live-agent flakiness `loop-run-docker` shows. The cause was the model
  (an editor `str_replace` "old_str did not appear verbatim" failure — proven NOT a plumbing bug: the
  pull correctly returned what was in the container, and the offline executor test proves the worktree→
  ship pipeline deterministically).
- **§15 (registered, NOT built this slice — per the brief):** (1) an **allow-list / validation on
  `repo_path`** (today any local git path is accepted); (2) **selective (git-diff-based) pull** —
  brownfield currently pulls all container files except `.git/`+scaffolding and relies on the host-side
  `git add -A` honoring the repo `.gitignore` as the real filter (deletions are NOT synced; the
  enumeration is factored so a diff-based pull can replace it later); (3) a **nicer branch name** than
  `tvashtr/<run_id>`; (4) **push / PR** (that is P1.9, sequenced WITH brownfield); (5) a **brownfield
  review_loop** run (the Reviewer gating the real diff) — same machinery as greenfield M1, a manual
  follow-up, not this automated gate. A brownfield run against a repo WITHOUT a `.gitignore` can pull
  back `__pycache__` byproducts (a real user repo gitignores them); fold into the selective-pull item.

## Open Questions
None blocking. Slice 2 (launch UI) is the next `/goal`.

READY_TO_MERGE: branch=feat/brownfield-backend-run-mode, sha=cd56bcc, tests=260 backend passing,
alembic head 0015 (exactly one new migration; freeze regex bumped to 0001-0015), `make brownfield-check`
PASS on real docker+NIM, the greenfield smokes (seeding-smoke / skeleton-run / loop-run / loop-run-docker)
all GREEN, the full pre-existing backend suite passes UNTOUCHED (greenfield byte-intactness), `make lint`
clean. team_run.py stays openhands-free at import; the EngineAdapter seam extended ONLY additively
(`AgentTask.workspace_mode`, defaulted like `llm_api_key`); migrations 0001–0014 untouched.
