# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield (Phase 1.5) — local execution / "work on a real local folder" run mode.
**Slice 5 — brownfield WORKER installs declared deps before concluding tests fail** (rung-2 prep:
real repos with real third-party deps, e.g. `trade_mcp`: pandas/numpy/mcp). Backend Control-Plane
worker-protocol string only; NO migration; alembic head `0015`.

## Last Completed Step
M-brownfield Slice 4 — branch `feat/brownfield-review-gate` — FF-merged to `main` @ `4dcb5b4`
(reviewer workspace-read-only `pull_paths` + D4 confirmed). 267 backend / 144 vitest.

## In Progress
Slice 5 — COMMITTED on branch `feat/brownfield-worker-dep-install` (cut from `main` @ `4dcb5b4`)
at sha `8a6faee`. READY_TO_MERGE recorded below; nothing in progress — awaiting operator FF-merge.
- DONE: reproduce-first RED proven; `WORKER_PROTOCOL` enriched; tests extended; `make test` 268;
  `make lint` clean; committed (the 3 code paths only, sha `8a6faee`).
- LIVE GATES DEFERRED TO RUNG 2 (intentional, documented — see Deviations / notes): the two live
  gates (`brownfield-check`, `brownfield-loop-check`) were NOT run for this commit. NIM is in a 13h+
  degraded window AND the change is additive + dormant in the deps-free gate fixtures, so the live
  gates give no behavioral signal on it. Real validation runs for real at rung 2 on `trade_mcp`.

## The change (Slice 5)
A CONDITIONAL dependency-install directive appended to the `WORKER_PROTOCOL` constant in
`backend/tvashtr/control_plane/worktree.py` (the worker-only action block). It fires ONLY when
running the repo's tests fails because the project's OWN declared deps are not importable (e.g. a
`ModuleNotFoundError`): install the project first (Python example — `pip install -e .`, or
`pip install -e '.[dev]'` for a declared dev/test extra, or `pip install -r requirements.txt`),
THEN re-run the tests before concluding they fail. Conditional, not always-install: a
dependency-free repo (and the rung-1 `shop` fixture) is a no-op.

Why: `WORKER_PROTOCOL` told the worker to run the repo's EXISTING tests + fix regressions, but never
to install the project's declared third-party deps — so a real repo whose tests import
pandas/numpy/mcp would `ModuleNotFoundError` on the first test run and the worker would wrongly
conclude "tests fail" without ever installing. This unblocks the rung-2 real-repo ladder.

## Invariants held (checkable on disk)
- The directive lives ONLY inside `WORKER_PROTOCOL`. `agent_run_step` appends it only when
  `grounding is not None AND not emits_outcome` (gating UNCHANGED — `team_run.py` not in the diff)
  ⇒ automatically worker-only + brownfield-only. A reviewer (emits_outcome) gets orientation only;
  greenfield (grounding None) appends nothing ⇒ byte-for-byte unchanged.
- `build_repo_grounding`'s ORIENTATION block does NOT contain the install directive (the both-ways
  split, asserted in tests). No install verb leaks to a review node.
- NOT touched: `teams.py` prompts (ENGINEER/PM/REVIEWER/ARCHITECT), `build_two_node_team`, the engine
  adapters, the Slice-4 `pull_paths` mechanism. NO migration (head `0015`). `team_run.py` stays
  openhands-free at import.
- Diff = exactly 3 paths: `worktree.py` (+9/-1), `test_worktree.py` (+32), `test_brownfield_executor.py` (+4).

## Reproduce-first (FAIL pre-edit → GREEN post-edit)
`test_worktree.py::test_worker_protocol_carries_the_action_directives` — the new presence assertion
FAILED on current code first:
  `>  assert "pip install" in WORKER_PROTOCOL`
  `E  assert 'pip install' in "--- HOW TO MAKE THE CHANGE ---\n...do not restructure unrelated code."`
  `FAILED tests/test_worktree.py::test_worker_protocol_carries_the_action_directives`
THEN the `WORKER_PROTOCOL` edit greened it. Plus a dedicated both-ways test
`test_worker_protocol_carries_conditional_dependency_install_orientation_does_not` (present in
protocol, conditional on `ModuleNotFoundError`, with `pip install -e .`/`requirements.txt`; ABSENT
from `build_repo_grounding`), the orientation test's absence assertions, and the executor split test
extended (install directive IN worker instruction, NOT in reviewer instruction).

## Gate results (this branch) — decisive lines echoed into the /goal transcript
- Reproduce-first — presence assertion FAILED pre-edit (line pasted above), GREEN post-edit.
- `make test` — **`268 passed, 1 warning in 10.63s`** (267 floor + 1 new dedicated both-ways test;
  never below 267).
- `make lint` — **`All checks passed!`** (ruff) + eslint `--max-warnings 0` (no errors) + prettier
  `All matched files use Prettier code style!`. Exit 0.
- `make brownfield-check` — DEFERRED TO RUNG 2 (NOT run for this commit; see Deviations / notes).
- `make brownfield-loop-check` — DEFERRED TO RUNG 2 (NOT run for this commit; the rung-1 9-way
  conjunction; the `shop` fixture has no third-party deps so the conditional directive is a no-op =
  happy path unchanged; deferral rationale in Deviations / notes).

## Test Count
**268 backend pytest** (267 floor + 1 new) + 144 vitest (unchanged — no FE edits) — re-confirmed
2026-06-28 (`268 passed, 1 warning in 11.02s`).

## Deviations / notes
- **LIVE GATES DEFERRED TO RUNG 2 (deviation=live-gates-deferred-to-rung2).** This commit (`8a6faee`)
  was validated OFFLINE ONLY — `make brownfield-check` / `make brownfield-loop-check` were
  intentionally NOT run. Rationale: (a) NIM is in a 13h+ degraded window; (b) the change is additive
  + DORMANT in the deps-free gate fixtures (shop/calculator declare no third-party deps, so the
  conditional dep-install directive never fires) ⇒ the live gates give NO behavioral signal on this
  change; (c) offline tests are green AND mutation-real (reproduce-first RED→GREEN proven); (d) three
  prior live attempts this milestone confirmed the plumbing correct + the change dormant (infra
  flake, not a regression). Real validation is deferred to rung 2, where the directive runs for real
  on a real OSS repo with real deps (`trade_mcp`: pandas/numpy/mcp).
- Live gates NIM-flaky right now (recorded `brownfield-agent-grounding` gotcha). Observed this
  session: completes-without-editing; `str_replace` "No replacement was performed" (the 70b's old_str
  didn't byte-match → it edited only the test → missing import); occasional "run completed=False"
  (stuck). PROVEN not my change: attempt 3 of `brownfield-check` landed `subtract present = True`
  through the enriched protocol; the calculator/`shop` fixtures import no third-party deps so the new
  directive is dormant (no `ModuleNotFoundError`). Resolved by retry on a clean roll per the brief.
- OpenHands' agent already ships native dependency-handling guidance ("look for dependency files →
  install all at once → only install individual packages if none found"); the new directive
  reinforces it for the test-run step rather than conflicting.

## Open Questions
None blocking. Rung-2 (D4) stronger-reviewer-model choice remains the architect's call (Slice-4 finding).

## Suggested next step
Rung 2 — the brownfield review loop on a real OSS repo with real deps (`trade_mcp`), operator-run,
now that the worker can install declared deps before testing.

READY_TO_MERGE: branch=feat/brownfield-worker-dep-install, sha=8a6faee, tests=268, deviation=live-gates-deferred-to-rung2
