# Brief — M-brownfield Slice 4: Harden the brownfield review gate

> Read `prompts/CLI-RULES.md` first (it governs). This brief SUPERSEDES CLI-RULES §7 for this run.
> Backend Control-Plane only. **NO migration** (alembic head stays `0015`; the migration-freeze hook
> covers `0001`–`0015` — do not touch any migration). No frontend.
> Base: `main` @ `758e9b5`, alembic head `0015`, **262 backend / 144 vitest**, ruff/eslint/prettier clean.

---

## Why this slice

The brownfield review-loop exit bar is CLEARED for rung 1, but the proof is **probabilistic** — it
passes only on rolls where the loop converges without losing the engineer's correct edit. Two
registered §15 Brownfield findings are the cause; this slice closes both. They are two faces of one
gap: **the loop can ship a branch that is missing (or wrong about) the feature.**

1. **Rework rounds can drop a landed edit** (the most correctness-relevant open item).
2. **The 70b reviewer rubber-stamps tests-green** (approves without verifying the change satisfies the
   idea/PRD).

A disk trace (architect, this session) found the carry-forward machinery is **faithful** — the
worktree is cut once and never reset, the prior round's edit persists in the host worktree, the
brownfield push (`git ls-files -c -o` + `file_upload` of working-tree content) seeds that dirty edit
into every rework container, and the rework instruction names it. **So the engineer-carry-forward is
NOT broken.** The real machinery hole is different (Item A below). There is also a likely model-
adherence contributor (Item B) — repro-gated.

**Goal of this slice:** the branch that ships is exactly what the Engineer built and the Reviewer
approved — never a version a review round quietly mutated, and never (after the reviewer can no longer
clobber) a version a rework regenerated away. Plus: measure, honestly, whether the 70b reviewer can
gate on spec-met at all, and log the finding for the rung-2 model decision.

---

## The three items

### Item A — Reviewer is workspace-READ-ONLY (the machinery fix — UNCONDITIONAL, reproduce-first)

**The hole.** The Slice-3 worker-gating split gated the reviewer's PROMPT (a reviewer gets orientation,
never `WORKER_PROTOCOL`) but left its WORKSPACE EFFECTS unenforced. The docker pull
(`engines/openhands_docker_adapter.py::_pull_workspace`) is unconditional and role-neutral — it copies
ALL non-`.git` container files back to the host worktree regardless of whether the node was a worker or
a reviewer. So if a reviewer node touches the deliverable while "reviewing," its changes get pulled back
and **clobber the worker's correct edit**; the next rework round then inherits the already-clobbered
state, which a faithful carry-forward cannot recover. "Reviewer gates, never implements" (the Tvashtr-25
pivot) holds in the prompt but not at the workspace.

**The fix.** An outcome-emitting node (a reviewer — `node_emits_outcome(edges, node_id) == True`, the
fact the executor already threads as `emits` / `emits_outcome`) must be **workspace-read-only**: its
container edits must NEVER mutate the shippable host worktree; only its verdict sidecar
(`REVIEW_VERDICT.json`) is harvested.

**Required mechanism (preferred — confirm it's the cleanest as you implement):** a new **additive,
defaulted** field on `AgentTask` (in `engines/base.py`) that scopes the pull to a fixed file list —
e.g. `pull_paths: tuple[str, ...] | None = None`. This is the SAME established pattern as
`workspace_mode` / `llm_api_key` (the `AgentTask` docstring blesses it: "exactly the established way
`llm_api_key` extended this contract … the Control Plane never learns which adapter is active").
- `pull_paths is None` (default) → the adapter enumerates + pulls everything (TODAY's behavior,
  byte-identical for greenfield AND for a worker node).
- `pull_paths` set → the adapter pulls ONLY those exact relative paths.
- `agent_run_step`, for an emitting node, passes `pull_paths=("REVIEW_VERDICT.json",)`. The adapter is
  told WHICH files to pull (a sync directive) — it does NOT learn "reviewer," so the **EngineAdapter
  seam stays role-neutral (CLI-RULES §3 invariant 2 is preserved)**.
- Honor `pull_paths` in BOTH adapters (`openhands_docker_adapter.py` is the critical brownfield path;
  mirror in `openhands_adapter.py` for consistency — its snapshot/pull). The host worktree is then never
  written by an emitting node's round; `_harvest_verdict(workspace)` (reads `{workspace}/REVIEW_VERDICT.json`)
  works unchanged; a reviewer's `files_changed` is `["REVIEW_VERDICT.json"]` or `[]` (unused for
  ship/brief — `run_graph` uses `result["reasons"]` for an emitting node's `outcome_detail`, and ship
  reads `workspace`, not the reviewer's `files_changed`).
- A throwaway-copy-of-the-worktree approach is an alternative but is REJECTED unless `pull_paths` proves
  unworkable: copying a `git worktree` carries a fragile `.git` worktree-pointer (`git ls-files` on the
  copy shares the original's gitdir) — more risk, no benefit.

**Reproduce-first (this is a bug-fix — prove it FAILS on current code BEFORE the fix).** Two layers,
both deterministic + LLM-free + mutation-real:

1. **Executor wiring** (extend `backend/tests/test_brownfield_executor.py`). The existing
   `_ReviewLoopFakeAdapter` writes to `task.workspace_dir` DIRECTLY (it does not run the real pull). To
   make a meaningful regression, the fake must simulate the real pull-filtering: have the fake reviewer
   write `REVIEW_VERDICT.json` to the host ALWAYS, but write its *deliverable mutation* to the host ONLY
   IF `task.pull_paths is None` (i.e. simulate that a verdict-only pull discards the deliverable
   mutation). Add a NEW test where the fake reviewer ALSO clobbers the module (e.g. overwrites
   `calculator.py` to DROP `subtract`). Assert: the branch tip STILL has `def subtract` (and `def add`),
   AND assert the reviewer's captured `task.pull_paths == ("REVIEW_VERDICT.json",)` while the worker's
   `task.pull_paths is None`.
   - PRE-FIX: `agent_run_step` sets no `pull_paths` → `None` → the fake writes the clobbered
     `calculator.py` to host → branch tip LACKS `subtract` → **the new test FAILS** (confirm this
     failing first).
   - POST-FIX: `agent_run_step` sets `pull_paths=("REVIEW_VERDICT.json",)` for the emitting node → the
     fake skips the clobber write → branch tip RETAINS `subtract` → the test PASSES.
   - Keep the EXISTING `test_brownfield_review_loop_worker_gets_protocol_reviewer_does_not_offline`
     green (it asserts the split; do not weaken it).
2. **Adapter mechanism** (add to `backend/tests/test_docker_adapter.py` alongside the existing
   `_pull_workspace`/`_push_workspace` tests, using the same fake-`workspace` style). Assert that
   `_pull_workspace(workspace, host_dir, pull_paths=("REVIEW_VERDICT.json",))` (or however you wire the
   field through) downloads ONLY `REVIEW_VERDICT.json` and NOT the other container files. PRE-FIX this
   path doesn't exist (the test exercises the new branch); make it assert the new behavior.

### Item B — Reliable revise-in-place on rework (model-adherence — REPRO-GATED)

After Item A lands (the reviewer can no longer clobber), determine whether the engineer ITSELF still
drops the edit on a rework round.

**The live repro (deterministic trigger, real engineer).** Run a brownfield `review_loop` with
`TVASHTR_FORCE_REVISIONS=1` (forces exactly one reviewer `changes_requested` → one engineer rework; the
forced reviewer short-circuits before the adapter, so the engineer is the only thing running the real
docker+NIM adapter on the rework), against a small real-shaped fixture (reuse/adapt the
`brownfield_loop_check` `shop` fixture or the `calculator` fixture). Observe whether the engineer's
rework PRESERVES the prior edit (revise-in-place works) or DROPS it (regenerates from scratch and forgets
the feature). You may script this as a small diagnostic under `scripts/` (e.g. `scripts/rework_repro.py`)
that logs the worktree's `calculator.py`/`discounts.py` content pre- and post-rework.

**Decision (record it in `STATE.md`):**
- If the rework reliably PRESERVES the edit → **Item B is UNNEEDED. Skip it.** Record: "reviewer-clobber
  (Item A) was the cause; engineer revise-in-place is reliable once the reviewer can't clobber."
- If the rework DROPS the edit (regenerates despite the prior edit being present + named in the
  instruction) → **implement Item B:** in `agent_run_step` (the `iteration > 1 and reviewer_feedback`
  revision block, currently lines ~654–661), additionally compute the engineer's own prior change
  (`git -C <workspace> diff` in the worktree — its accumulated working-tree diff against HEAD/base) and
  inject it into the rework instruction, replacing the weak "your prior work is in your current working
  directory" line with the explicit diff, framed as: "Here is your prior change — modify THIS to address
  the feedback; do NOT start over." Compute the diff via a small openhands-free helper (keep
  `team_run.py` openhands-free at import). Add an offline regression: for a brownfield rework round
  (`iteration > 1` with feedback), the constructed instruction contains the prior diff. Then re-run the
  live repro to confirm the drop rate improved.
- **Throttle fallback (do NOT stall):** if NIM is too throttled to get a clean observation after a few
  clean-roll retries, implement Item B anyway (it is cheap, strictly-additive, and offline-verifiable)
  and record that the live repro was inconclusive due to throttling. A NIM throttle / "Remote
  conversation got stuck" is a **retry on a clean roll**, NOT a `NEEDS_HUMAN`.

### Item C — Measure the reviewer's spec-gating (finding 2 — MEASURE + log, do NOT rabbit-hole)

The `REVIEWER_PROMPT` (in `control_plane/teams.py`, lines ~53–84) ALREADY says: approve "ONLY IF the
tests pass AND the deliverable fulfills the ORIGINAL IDEA and the PRD", and "do not approve on
assumption." So finding 2 is the 70b **ignoring explicit instructions** — prompt-tuning a weak model is
exactly the trap the env gotcha warns against. The real value here is a MEASUREMENT that informs the
rung-2 (D4) model decision.

**Do:**
1. **A minimal, literal-safe procedural nudge to `REVIEWER_PROMPT`** (a cheap shot — bounded). Add a
   short step that forces an observable check before the verdict, e.g.: "Before deciding, state in one
   sentence the single concrete behavior the ORIGINAL IDEA/PRD requires, then state how you verified the
   build exhibits it." **HARD CONSTRAINT — preserve verbatim** (the comment at teams.py lines ~36–39
   says so; `_harvest_verdict`, the §14.1 view, the A/B view, the smokes, and `test_teams.py` depend on
   them): the `python -B -m unittest` literal, the `python -m pytest -q` line, the EXACT
   `REVIEW_VERDICT.json` sidecar name, and the `approved` / `changes_requested` label vocabulary. Do NOT
   touch `build_two_node_team`, `ENGINEER_PROMPT`, `PM_PROMPT`, or `ARCHITECT_PROMPT`. Keep `test_teams.py`
   green (update its assertion ONLY if it asserts the exact full prompt string AND your addition is
   additive — prefer leaving existing literal assertions intact).
2. **A negative fixture + a live measurement.** Build a deliberately-WRONG-but-tests-pass change: the
   idea requires a behavior the EXISTING tests don't fully cover, and the (scripted) build satisfies the
   tests while NOT meeting the spec (e.g. the idea asks for `bulk_discount` that only applies above a
   quantity threshold; the wrong build applies it always — the base-case test passes, the spec is
   unmet). Script it (e.g. `scripts/reviewer_spec_gate_check.py`) to run the real NIM reviewer against
   that wrong build and RECORD whether it returns `changes_requested` (caught) or `approved`
   (rubber-stamped).
3. **Log the finding** in `STATE.md` (and surface it for the architect to register in §15):
   - caught → the nudge + the gate work at rung 1 (record it);
   - rubber-stamped even with the nudge → the D4 "recommend a stronger reviewer model for rung 2" lever
     is CONFIRMED. **Record it and STOP — do NOT iterate on the prompt to chase a pass.**

**Item C does NOT gate the milestone on the model catching the negative fixture** (we cannot make a weak
model strong by prompt-tuning, and no stronger model is wired). The milestone's Item-C bar is: the
prompt edit preserves all literals + keeps `test_teams.py` green; the negative-fixture script exists and
records an outcome; the finding is logged. Either measured outcome is informative and PASSES.

---

## Invariants / do-not-touch (acceptance evidence where checkable)

- **NO migration.** alembic head stays `0015`; do not touch any migration `0001`–`0015` (the
  `protect-migrations.sh` PreToolUse hook blocks it under bypass).
- **`team_run.py` stays openhands-free at import** (no module-level openhands import; the diff helper for
  Item B must be subprocess/stdlib).
- **EngineAdapter seam stays role-neutral** (CLI-RULES §3 invariant 2): the adapter learns a SYNC
  directive (`pull_paths`), never "reviewer." `AgentTask` change is additive + defaulted.
- **Greenfield is byte-for-byte unchanged.** `pull_paths` defaults to `None` → the greenfield + worker
  pull path is byte-identical. Prove it: `make brownfield-check` (the two_node greenfield-shaped gate)
  still PASS, and the existing offline suite (the greenfield/worker tests) unchanged.
- **`build_two_node_team` untouched** (invariant 5). two_node has no emitting node → never sets
  `pull_paths` → unaffected.
- **Reviewer-prompt literals preserved** (Item C constraint above).
- **Offline suite never regresses:** **262** backend / 144 vitest floor; NEW tests required for each new
  behavior (Item A: the two layers; Item B if implemented: the prior-diff-in-instruction test).
- Branch-per-step; commit only your own changed paths; **never push**; leave `prompts/*.md` and the
  living docs untracked from your side.

---

## Acceptance / evidence — run every check yourself, debug to green, echo each decisive line into the chat

Echo these verbatim into the transcript (the `/goal` evaluator reads only the chat — CLI-RULES §4.3a):

- **Reproduce-first proof (Item A):** show the NEW executor regression and the adapter test FAILING on
  the pre-fix code first (paste the failing assertion), THEN green after the fix.
- `make test` — the final `=== N passed …===` line. **N ≥ 262 + your new tests** (state the new count;
  never below 262). Confirm `test_teams.py`, `test_reviewer_agent.py`, `test_review_verdict.py`,
  `test_review_loop.py`, `test_brownfield_executor.py`, `test_docker_adapter.py` are all green.
- `make lint` — the `All checks passed!` / clean result line.
- `make brownfield-check` — final `PASS` (the two_node greenfield-shaped gate, UNCHANGED — proves
  greenfield byte-intactness).
- `make brownfield-loop-check` — final `PASS` (the rung-1 review-loop exit-bar proof; the 9-way
  conjunction incl. `has_feature` + `behavior_ok` + `reviewer_approved` + HEAD-untouched). This is the
  integration confirmation that Item A didn't break the happy path. (Live docker+NIM — needs
  `NVIDIA_BUILD_API_KEY` + `agent_sandbox_mode=docker`; a NIM throttle is a retry-on-clean-roll.)
- **Item B observation** — paste the forced-one-rework repro result (edit PRESERVED vs DROPPED), the
  decision (Item B implemented or skipped), and — if implemented — the offline "prior-diff is in the
  rework instruction" test passing + the re-run repro.
- **Item C measurement** — paste the negative-fixture reviewer outcome (`changes_requested` = caught, or
  `approved` = rubber-stamped) and the logged finding.
- The `READY_TO_MERGE: branch=feat/<slug>, sha=<sha>, tests=<N>` line you wrote to `STATE.md`.

## Reproduce-first & stop conditions

- **Reproduce-first (Item A):** a failing regression that PROVES the reviewer-clobber on the CURRENT code
  must exist and be shown failing BEFORE the fix. Item B's "fix" is gated on the live repro (or the
  throttle fallback) — do not add the prior-diff injection if the repro shows the engineer already
  preserves the edit, UNLESS the throttle fallback applies.
- **Proceed vs STOP:** a code-proven, contained, regression-guarded fix to a SINGLE identified cause may
  proceed (Item A is exactly this). A **second/unknown problem that would need a broad or unproven
  change** → STOP and write `NEEDS_HUMAN: <reason>` to `STATE.md`. A NIM throttle / "stuck" / rate-limit
  is NEVER `NEEDS_HUMAN` (retry on a clean roll; the Item-B/C live runs may use the throttle fallback /
  record-and-move-on). A genuinely DEAD `NVIDIA_BUILD_API_KEY` with no alternative is `NEEDS_HUMAN`.
- Hard turn cap per CLI-RULES.

## Report-back (in `STATE.md` + the final summary)

Files changed (with the role of each); the reproduce-first failing-then-green evidence for Item A; the
Item-B decision + evidence; the Item-C measurement + the logged finding; every gate command run WITH its
decisive output line; any deviation from this brief + rationale; the `READY_TO_MERGE` line. Note the
suggested next step (rung 2 — a real OSS repo, operator-run).
