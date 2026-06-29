# Tvashtr — Autonomous Execution State

## Current Milestone
M-brownfield **scoped-mount Slice 1** — give a brownfield run an OPTIONAL `subpath` that scopes the
agent's CONTEXT MAP + FOCUS to one package of the repo (NOT the git mount), so the proven NIM-70b /
OpenHands-docker path can land a change in a large monorepo without overflowing — the fix for the
rung-2 finding. Backend-only (the picker + warnings are Slice 2). Branch `feat/scoped-mount-backend`
cut from `main` @ `726d640`.

## Outcome: RUNG-2 (scoped) FINDING — a COMPLETE result (NOT a bug to grind on), CONFIRMED across TWO independent clean runs (n=2). Scoping WORKED at the machinery level both times; the 70b agent's DEMA is WRONG both times and the INDEPENDENT numeric gate correctly caught it.
Re-running `make brownfield-rung2` SCOPED TO `core` ran the proven docker+NIM `review_loop`
end-to-end against a fresh clone of the real `trade_mcp` repo **twice** (run #1 `f402cf21…`, run #2
`a207ef8f…` — a clean confirmatory re-run of the BYTE-IDENTICAL harness, the only non-prohibited path
to a possible PASS). **Both runs: scoping did exactly what it was built to do** (0 context overflow,
the agent stayed in `core/`) — and **both runs the 70b worker shipped a WRONG DEMA** (run #1:
logically wrong — unregistered + mis-named + a nested-duplicate def; run #2: even worse — a
SYNTACTICALLY broken `def DEMA` with no body → `IndentationError`, the module won't import). The
hypothesis "scoping enables the 70b to ship a correct DEMA" is now **FALSIFIED n=2**. The wall MOVED
from context-overflow (the rung-2 machinery wall, which scoping fixed) to the 70b worker's OUTPUT
CORRECTNESS (a model-capability wall, the same class as the D4 70b rubber-stamp). The slice's CODE is
correct and complete (324 offline tests + both live runs prove the scoping mechanism); the live
agent's DEMA is the gap, and per the brief §C3 that is a FINDING to surface, NOT to
hand-edit/prompt-tune/rework. **NEEDS_HUMAN below; do NOT FF-merge — the architect decides the next
lever (a stronger worker model, not the hard mount).**

## What SCOPING FIXED (the rung-2 machinery failures are GONE — soft-containment was SUFFICIENT)
- **No context overflow.** Rung-2 attempt 1 died on `openai.BadRequestError 400: 132790 > 131072
  tokens` exploring the 264-file repo. This scoped run: **0 context-length errors**, `run.status =
  completed`, `workflow=SUCCESS`. The bounded `core/` map (9 files, not 264) kept the agent under the
  128k window.
- **No remote-conversation hang.** Rung-2 attempt 2 died on "Remote conversation got stuck". This run
  ran the full PM → Engineer ⇄ Reviewer → ship loop to a clean terminal.
- **The agent STAYED in `core/` (did NOT escape).** The shipped diff --stat is `core/indicators.py`
  ONLY (9 insertions) — the per-run worker FOCUS directive ("edit within `core`, do NOT recursively
  list/read outside it") held. The scoping evidence is in the live agent's instruction:
  `FOCUS: core` + `do NOT recursively list` (grepped from the run log).
- **A branch SHIPPED end-to-end**, operator repo untouched: `ship_branch =
  tvashtr/f402cf21…`, `clone HEAD unchanged: True (4691064fac → 4691064fac)`, `on base branch / tree
  clean: True / True`. (rung-2: no branch ever shipped.)
- **The INDEPENDENT numeric gate FIRED for the first time** (its first real exercise): the verify venv
  built (`pip install -e '.[dev]'` rc 0), `tests/test_indicators.py` ran (127 passed, rc 0), and the
  numeric check ran against the shipped branch. The gate machinery is sound.

## The FINDING — the 70b agent's UNAIDED DEMA is WRONG (the numeric gate correctly caught it)
The shipped `core/indicators.py` diff (the agent's unaided output):
```
+def DEMA(data, length):
+    def DEMA(data, length):          # ← a broken NESTED-DUPLICATE definition
+        ema1 = EMA(data, length)
+        ema2 = EMA(ema1, length)
+        return 2 * ema1 - ema2
+    ema1 = EMA(data, length)
+    ema2 = EMA(ema1, length)
+    return 2 * ema1 - ema2
 ...
-from __future__ import annotations   # ← a spurious, unrelated deletion
+
```
Why the gate FAILED it (correctly):
- **Wrong name + not registered**: the agent wrote `def DEMA` (uppercase) and never wired it into the
  library's registry, so `compute("dema", …)` raises `ValueError: Unknown indicator 'dema'. Available:
  [... 28 indicators, no dema]`. `def dema present: False`; `dema in list_indicators(): False
  (registry_count = 28 — the 28→29 count tripwire never fired)`; `numeric matches 2*EMA-EMA(EMA):
  False` (overlap 0 — `compute` raised before any number was produced).
- **Broken structure**: a nested duplicate `def DEMA` inside `def DEMA` (dead inner function).
- The DEMA idea explicitly said "make it work like the library's other indicators … callable through
  the same compute path"; the 28 existing indicators + the registry are IN THE SAME FILE the agent
  edited (`core/indicators.py`), so the convention was fully in-scope — the FOCUS directive did NOT
  hide it. This is the 70b worker's code-quality ceiling, not a scoping artifact.
- **The reviewer behaved correctly this time** (NOT a D4 rubber-stamp): reviewer outcomes =
  `['changes_requested', 'changes_requested', 'changes_requested']` — it withheld approval all 3
  rounds. The loop shipped anyway only via the review-cap → escalation gate (auto-approved under
  `TVASHTR_AUTO_APPROVE_GATES=1`); the INDEPENDENT numeric gate — not the reviewer — is the real
  correctness check, and it correctly returned FINDING.

## Run #2 — the independent confirmation (clean re-run of the unchanged harness; n=2)
The one action that could legitimately reach a PASS without violating the brief is a clean re-run of
the byte-identical harness (no hand-edit / prompt-tune / rework / model swap). It was taken — and it
STRENGTHENED the FINDING rather than flipping it (run_id `a207ef8f-ec66-4bf4-941c-d2d6d15cab42`):
- **Scoping held again**: `0` context-overflow errors, `agent scope=subpath 'core'`, the agent did
  not escape `core/`.
- **The 70b worker shipped an EVEN-WORSE DEMA**: `core/indicators.py` begins `def DEMA(data,
  length):` with NO indented body → `IndentationError: expected an indented block after function
  definition on line 1` → the module fails to import → EVERY indicator test errors on collection
  (`ERROR collecting tests/test_indicators.py`, `tests/test_per_trade_engine.py`, …). Run #1 was
  logically wrong but valid Python; run #2 is not even parseable. Two independent samples, two broken
  DEMAs → the model-capability wall is real, not an unlucky single roll.
- **Isolation held despite a harness hiccup**: `0` `tvashtr/*` branches leaked into the operator's
  real repo. The driver additionally hit a `dbos._error.DBOSException: System database accessed before
  DBOS was launched` during teardown (so it did not print its clean RESULT block) — this is the KNOWN
  stale-PENDING / DBOS-recovery flake (CLI-RULES §4.5; many leftover `backend/.tvashtr_workspaces/`
  from prior sessions resurrecting on recovery), a §15-deferred HARNESS issue, NOT this slice's code
  and NOT the agent. The agent's `IndentationError` is the decisive signal regardless.

## What I did NOT do (per §C3/§C4 — doing any of these corrupts the proof)
NOT hand-edit/ship a correct DEMA, NOT prompt-tune the worker, NOT patch the agent's output, NOT
retry-to-fish-for-a-lucky-DEMA (the run did NOT throttle — it completed; §C1's ≤2 retry is for
throttle errors, and §C3 forbids reworking to force green), NOT rework the grounding / FOCUS /
executor / model to force the gate green. The gap (a 70b worker writes a broken, unregistered,
mis-named indicator even with a clean bounded `core/` view) is a model-capability decision for the
architect.

## Architect's call (the wall MOVED — soft-containment succeeded; this is NOT the hard-mount trigger)
Scoping was the fix for context-overflow, and it WORKED (0 overflow; the loop shipped end-to-end;
the agent stayed in `core/`). So the **hard-mount fallback is NOT needed for the overflow problem**.
The remaining wall is the worker's correctness on the indicator task — the next lever is a **stronger
worker model** (larger / more capable than `nvidia_nim/meta/llama-3.3-70b-instruct`), NOT a harder
mount. Re-running `make brownfield-rung2` (scope=`core`) with a stronger worker is the cleanest next
experiment — the harness, the scoping, and the numeric gate are all proven and ready.

## Deliverable (the mergeable slice — branch `feat/scoped-mount-backend`)
- **Migration `0018_run_subpath`** (new) — a nullable `runs.subpath` TEXT column (modeled on `0015`;
  `down_revision = 0017_ownership_and_credentials`). Additive + nullable + no backfill. alembic head
  `0017` → `0018`. The freeze hook (`.claude/hooks/protect-migrations.sh`) bumped `0017` → `0018` as
  the LAST commit.
- **`Run.subpath`** model field (parallel to `repo_path`/`base_ref`/`ship_branch`).
- **`worktree.py`** — `build_repo_grounding(workspace, repo, subpath=None)` roots the structure
  outline at `<subpath>` (`_structure_outline` gains a `base=` prefix that counts depth RELATIVE to
  the sub-path so a FLAT package like `core/` shows its files, not a single `core/` line) + names the
  focus, while the top-level MANIFEST line + conventions stay repo-ROOT; `subpath=None` is
  byte-for-byte the whole-repo grounding. New helpers `worker_focus_directive(subpath)` (the per-run
  worker FOCUS block) + `subpath_is_tracked_dir(repo, subpath)` (the create_run 422 validation). All
  openhands-free.
- **`team_run.py`** — `load_graph_step` records `run.subpath` on the graph dict; `run_graph` threads
  it into `brownfield_grounding_step` + `agent_run_step`; `agent_run_step` appends the FOCUS block
  AFTER `WORKER_PROTOCOL` on the SAME worker-only gate (`grounding is not None and not
  emits_outcome`). Reviewer + greenfield + whole-repo brownfield get nothing extra.
- **`routers.py`** — `create_run` accepts + validates (422 if not a tracked dir) + persists `subpath`;
  greenfield ignores it (NULL); surfaced on the run-detail payload.
- **`scripts/trade_mcp_rung2_check.py` + `Makefile`** — the rung-2 driver gains
  `TVASHTR_RUNG2_SUBPATH` (default `core`), passed in the `POST /api/runs` body; the INDEPENDENT
  numeric gate is UNCHANGED (host-side verify venv at the repo ROOT).
- **8 new mutation-real tests** (worktree scoped-grounding/byte-for-byte/FOCUS/validation; executor
  worker-gets-FOCUS-reviewer-does-not + an end-to-end ship-within-pkg; create_run persists/422/
  greenfield-ignores).

## Gate results — decisive lines echoed into the /goal transcript
- NIM probe — **`NIM_LIVE … ok in 3.4s -> 'pong'`** (agent `nvidia_nim/meta/llama-3.3-70b-instruct`,
  live not throttled); PM probe — **`PM_LIVE (openai/gpt-4o-mini) ok in 1.9s -> 'Ping.'`**.
- `make test` — **`324 passed, 1 warning in 18.12s`** (new floor = 316 + 8 new). alembic head
  **`0018_run_subpath (head)`**.
- `make lint` — ruff **`All checks passed!`** + `125 files already formatted` + eslint clean +
  prettier **`All matched files use Prettier code style!`**.
- `make brownfield-rung2` (scope=`core`) — **`RUNG-2 FINDING` ×2** (n=2). Run #1 (`f402cf21…`, clean
  RESULT block): run completed, branch shipped, **0 context overflow**, agent stayed in `core/` (diff
  = `core/indicators.py` only), numeric gate FIRED and FAILED a wrong DEMA (`Unknown indicator
  'dema'`; registry 28; `def dema present: False`). Run #2 (`a207ef8f…`, confirmatory re-run): **0
  context overflow** again, agent shipped a SYNTACTICALLY broken DEMA (`IndentationError` — module
  won't import), isolation held (0 leaked branches); the driver hit the known stale-PENDING/DBOS
  teardown flake before its summary (a §15 harness issue, not the agent/slice).

## Test Count
**324 backend pytest** (316 baseline + 8 new) + **165 vitest** (unchanged — NO FE change). — 2026-06-29.

## Invariants held (checkable on disk)
- Migration is **`0018` ONLY** (alembic `0017` → `0018`; freeze bumped `0017` → `0018` as the LAST
  commit; NO edit to `0001`–`0017` — the hook still blocks those). NO other schema change.
- **Greenfield byte-for-byte unchanged** (`subpath is None` appends NO new text; the offline
  greenfield suite is green). **Whole-repo brownfield unchanged** (`subpath` NULL → today's
  grounding; proven by the existing brownfield tests, which now also assert NO FOCUS leaks).
- The git mount / worktree / `tvashtr/<run_id>` branch / ship / tree-untouched are UNCHANGED —
  `add_worktree` byte-unchanged; `subpath` scopes ONLY the grounding map + the worker FOCUS block (the
  live run shipped the change WITHIN the whole-repo branch, operator repo untouched).
- **NO FE change** — `git diff main -- frontend/` is EMPTY; vitest stays **165**.
- Never pushed; branch-per-step (`feat/scoped-mount-backend`); operator FF-merges. `prompts/*.md`,
  `PROJECTPLAN.md`, `HANDOVER.md` left untouched/untracked.

## Open Questions
- The 70b worker's correctness ceiling on the indicator task → OPEN (architect): scoping removed the
  context wall; the worker still ships a broken, unregistered, mis-named DEMA. Pick the next lever (a
  stronger worker model is the indicated one) then re-run `make brownfield-rung2` (scope=`core`) — the
  harness + scoping + numeric gate are proven and ready.

## Blocked
NEEDS_HUMAN: scoped re-run fails the numeric gate — confirmed across n=2 independent runs, for a NEW
reason (a model-capability wall, NOT the rung-2 context wall). The scoped-mount Slice 1 backend is
correct and complete (324 backend / 165 vitest green; lint clean; migration `0018`; freeze bumped to
`0018`). The live `make brownfield-rung2` (scope=`core`), run TWICE, PROVED soft-containment works: 0
context overflow both times (rung-2 was 132790>131072), no hang, the loop shipped a branch end-to-end
(run #1), the agent stayed in `core/`, and the INDEPENDENT numeric gate fired. Both runs FAILED
because the 70b worker's unaided DEMA is wrong: run #1 — `def DEMA` not `dema`, never registered →
`compute("dema")` raises `Unknown indicator 'dema'`, registry stayed 28, + a broken nested-duplicate
def + a spurious `__future__` deletion; run #2 — an even-worse SYNTACTICALLY broken `def DEMA` (no
body → `IndentationError`, the module won't import). The clean confirmatory re-run (the ONE
non-prohibited path to a PASS) was taken and CONFIRMED the wall rather than flipping it. Per §C3 I did
NOT hand-edit / prompt-tune / rework / model-swap to force green. The wall MOVED from context-overflow
to model-capability — the next lever is a stronger worker model, NOT the hard mount. Do NOT FF-merge
on a FINDING; the architect decides. (Branch `feat/scoped-mount-backend`; 324 backend / 165 vitest;
lint clean; alembic head `0018`.) See the RUNG-2 (scoped) FINDING + Run #2 blocks above.
