# Brief — M-brownfield Slice 3: the brownfield review_loop run + the worker-gating split (the exit-bar proof)

> Architect-authored brief (Tvashtr-33). The `/goal` points Claude Code here. This is ONE bounded
> milestone: (A) the §15 worker-gating carry-forward (a correctness prerequisite) **+** (B) a live
> `make brownfield-loop-check` that proves a composed PM → Engineer ⇄ Reviewer team ships a
> **correct, reviewer-approved** change into a **real-shaped repo** — the M-brownfield exit-bar gate
> for rung 1. You self-decompose the steps and RUN every gate to green yourself before READY_TO_MERGE.

---

## 0. Context you need (read these on disk first)

- **`backend/tvashtr/control_plane/team_run.py`** — the graph executor.
  - `agent_run_step(run_id, node_prompt, model, iteration, idea, prd_text, workspace, vkey, reviewer_feedback, emits_outcome, grounding=None)` — the ONE generic agent step. It currently appends `grounding` (the D6 block) **uniformly** to every agent node: `if grounding: context += f"\n\n{grounding}"`. `workspace_mode = "brownfield" if grounding is not None else "greenfield"`. **The `emits_outcome` bool is ALREADY a parameter here** — it is the worker/reviewer discriminator. This is the seam for Task A.
  - `node_emits_outcome(edges, node_id)` — pure helper: True iff the node has a non-escalation out-edge with a `{"when": ...}` condition (a reviewer-style node that branches the walk on a verdict); False for a worker (catch-all/escalation only). `run_graph` computes `emits = node_emits_outcome(edges, current)` and threads it into `agent_run_step`.
  - `brownfield_grounding_step(run_id, workspace, repo_basename)` — `@DBOS.step` that returns `build_repo_grounding(workspace, repo_basename)`; called ONCE at the first agent node for a brownfield run (recorded → replayed verbatim on resume). `run_graph` stores it in `grounding` and threads it via `**({"grounding": grounding} if grounding is not None else {})`.
- **`backend/tvashtr/control_plane/worktree.py`** — `build_repo_grounding(workspace, repo_basename)` builds the D6 block. **Today it returns ONE string conflating two things:** (1) the `--- REPO GROUNDING (<repo>; conventions: <…>) ---` header + the big *worker-protocol* paragraph ("You are modifying an EXISTING repository… Implement the request by EDITING… `view` then `str_replace`/`insert`; do NOT `create` an existing file… put the code in the real source MODULE… keep every file COMPLETE and runnable… RUN the repository's existing tests… FIX any failure…") + manifests + structure outline + conventions content. The action paragraph is what mis-steers a reviewer.
- **`backend/tvashtr/control_plane/teams.py`** — the editable template library. `build_review_loop_team()` wires PM (completion) → prd_gate (gate) → Engineer (agent) ⇄ Reviewer (agent, `{when: approved}` out-edge → emits_outcome True) → ship/stop terminals + escalation_gate. The Reviewer's `REVIEWER_PROMPT` (top of file) hardcodes a strict step: `Run the test suite with EXACTLY this command:\n       python -B -m unittest`. `ENGINEER_PROMPT` says "create exactly the file… do not modify anything else" (greenfield-shaped; the brownfield worker-protocol overrides it — proven by `brownfield-check`).
- **`scripts/brownfield_check.py`** + **`make brownfield-check`** — the Slice-1 live gate: a real docker+NIM **two_node** run lands a correct change on `tvashtr/<run_id>` in a throwaway fixture repo; the fixture's own pytest is GREEN on the branch; HEAD untouched; Run row carries repo_path/base_ref/ship_branch. **Model the new driver on this for the repo-mount + on-disk contract + cleanup + clean-skip-without-key.**
- **`scripts/loop_run.py`** (`_run_feature_mode`, `TVASHTR_FEATURE_RUN=1` → `make loop-feature-docker`) — the greenfield review-loop capstone driver: POSTs `{"team_shape": "review_loop", "idea": ...}`, polls to terminal, asserts the real Engineer ran + the agent-Reviewer harvested a verdict. **Model the new driver on this for the review_loop launch + verdict-harvest surfacing.**
- **`/api/runs`** accepts `{"team_shape": "review_loop", "idea": ..., "repo_path": ..., "base_ref": ...}` together (two_node + repo_path is proven; review_loop + idea is proven; review_loop + repo_path is the new combination — same endpoint, no endpoint change needed).
- **Tests:** `backend/tests/test_worktree.py` (asserts the grounding string — `EDIT`, `` `create` ``, `REPO GROUNDING` header, structure, conventions); `backend/tests/test_brownfield_executor.py` (the offline two_node brownfield wiring proof — extend it for the review_loop split); `backend/tests/test_teams.py` (asserts `"python -B -m unittest" in reviewer.prompt` — **keep this literal as the fallback** so this assertion stays green); `backend/tests/test_reviewer_agent.py` (greenfield stub, grounding stays None — **do NOT touch**).

**State:** `main` @ `8f22592`, alembic head `0015`, 260 backend / 144 vitest, lint clean. **No migration in this slice** (no schema change — do NOT create one, do NOT bump the freeze).

---

## A. The worker-gating split (do this FIRST — the correctness prerequisite)

**Problem.** The D6 grounding's worker-protocol ("edit in place / land in the real module / run tests + fix") is appended to ALL agent nodes including the Reviewer, risking the Reviewer *implementing* instead of *gating*. Untested in Slice 1 (two_node has no reviewer).

**Fix.** Split the grounding into an always-safe **orientation** block (every agent node) and a worker-only **protocol** block (workers only), gated on the `emits_outcome` flag already at the `agent_run_step` seam.

A1. **`worktree.py` — `build_repo_grounding` returns orientation only.** Drop the *action* paragraph. Keep: the `--- REPO GROUNDING (<repo>; conventions: <…>) ---` header; a **neutral** situational line — "You are working in an existing repository named `<repo>`; its files are ALREADY PRESENT in your working directory." (NO implement/edit verb); the top-level manifests line; the depth-capped structure outline; the embedded conventions file; the transparency framing. This stays the repo-specific block computed once per run via `brownfield_grounding_step`. Keep it openhands-free + unit-tested.

A2. **`worktree.py` — add a module-level `WORKER_PROTOCOL` constant** (repo-agnostic) carrying ONLY the action directives (the text dropped from A1, lightly rephrased to stand alone): implement by EDITING the relevant existing source file(s) IN PLACE — `view` first, then a precise `str_replace`/`insert`; do NOT `create` a file that already exists; put the requested code in the real source MODULE (not only a test); keep every file COMPLETE and runnable (all imports; never partial/broken); after editing RUN the repo's existing tests and FIX any failure you introduced; make the smallest change; match the repo's conventions; do not restructure unrelated code. Export it so `team_run` can import it.

A3. **`team_run.py` — `agent_run_step` gates the protocol.** Keep appending `grounding` (now orientation) uniformly. ADD: append `WORKER_PROTOCOL` **only when `grounding is not None and not emits_outcome`** (brownfield + a non-emitting worker). A reviewer (`emits_outcome` True) gets orientation only; a thinker never gets grounding at all. `workspace_mode` discriminator is unaffected (orientation grounding is still non-None for brownfield). Import `WORKER_PROTOCOL` from `worktree` at module top (it is a plain string — no openhands import; `team_run` stays openhands-free at import).

A4. **Greenfield byte-for-byte:** with `grounding is None`, nothing is appended and `WORKER_PROTOCOL` is gated off → the greenfield instruction is unchanged. Confirm with the existing offline suite.

A5. **Tests.**
- Update `test_worktree.py`: `build_repo_grounding` now asserts the orientation pieces (header, the "existing repository"/"ALREADY PRESENT" line, manifests, structure, conventions) and **asserts the action directives are NOT in it** (e.g. `"str_replace" not in grounding`, the "RUN the repository's existing tests" phrase not in grounding). Add a test that `WORKER_PROTOCOL` contains the action directives (`str_replace`, "do NOT", "real source MODULE" or equivalent, "RUN", "smallest change").
- Extend `test_brownfield_executor.py` (the offline split proof — the mutation-real test): add a test that runs a REAL `run_team` over `build_review_loop_team()` against a real throwaway git repo (init in tmp, an existing module + an existing `unittest.TestCase` test), with `pm_step` stubbed (`seed_pm_prd`) and `resolve_adapter` stubbed by a fake adapter that **captures the instruction PER NODE** (keyed by whether it's the worker or reviewer) — the worker edits the worktree file + reports completed; the reviewer writes an `approved` `REVIEW_VERDICT.json` + reports completed. Assert: the **worker's** captured instruction contains the orientation header AND a `WORKER_PROTOCOL` marker (e.g. `str_replace`); the **reviewer's** captured instruction contains the orientation header but **NOT** the `WORKER_PROTOCOL` marker; `workspace_mode == "brownfield"` for both; the run completes and ships to `tvashtr/<run_id>`; the original HEAD is untouched. (To tell worker from reviewer in the fake adapter: a reviewer task's instruction emits a verdict / the node is the emitting one — simplest is to branch on whether the instruction already contains the `WORKER_PROTOCOL` marker, OR capture into a dict keyed by a stable substring of each node's prompt. Pick the robust approach and document it in a comment.)

---

## B. The brownfield review_loop live target + rung-1 repo (the exit-bar proof)

B1. **`teams.py` — generalize the Reviewer's test step to be test-runner-agnostic** (D5: the SAME template must serve a real repo, and real repos use pytest). Reword the strict step so the Reviewer runs the **repository's** tests, **preferring `python -m pytest -q`** and **falling back to `python -B -m unittest` if pytest is unavailable or collects no tests**. **CONSTRAINT: the literal string `python -B -m unittest` MUST remain in `REVIEWER_PROMPT`** (it is the fallback command AND `test_teams.py` asserts it — keep that assertion green; do not change the assertion). Everything else about the Reviewer (REVIEW_VERDICT.json sidecar, the approved/changes_requested vocabulary, "review, do not edit") stays verbatim — `_harvest_verdict`, §14.1/§14.3 views, and the smokes depend on them. `ENGINEER_PROMPT`/`PM_PROMPT` stay UNTOUCHED. This is behavior-preserving for greenfield (pytest discovers `unittest.TestCase` tests; the greenfield `loop-feature-docker` build's tests still run) — re-verify it (B5).

B2. **`scripts/brownfield_loop_check.py` (new)** — the live driver, modeled on `brownfield_check.py` (repo mount + on-disk contract + cleanup + clean-skip without `NVIDIA_BUILD_API_KEY`) ⊕ `loop_run.py::_run_feature_mode` (review_loop launch + verdict-harvest surfacing). It must:
  1. Clean-skip (return 0, print a "not a failure" note) if `NVIDIA_BUILD_API_KEY` is unset.
  2. Build a **rung-1 fixture repo** in a temp dir (see B3), git-init + commit it.
  3. `POST /api/repo/inspect` (assert `is_git`, `current_branch`, `tracked_file_count`).
  4. `POST /api/runs` with `{"team_shape": "review_loop", "idea": <rung-1 feature>, "repo_path": <repo>, "base_ref": <current_branch>}`.
  5. Poll to terminal (a roomy cap — a real review loop with possible loop-backs is slow; reuse the `loop_run` feature timeout ~1800s, env-overridable).
  6. Assert the **exit-bar contract ON DISK** (all must hold):
     - `run.status == "completed"` (it shipped);
     - branch `tvashtr/<run_id>` exists in the repo;
     - the edited module on the branch tip carries the new behavior (the feature is present);
     - **the repo's tests are GREEN on the branch** — host-side `python -m pytest -q` on a detached worktree checkout of the branch tip (pytest discovers the `unittest.TestCase` tests), exit 0 (the hard correctness backstop — a broken build fails here);
     - the original branch HEAD is UNCHANGED and HEAD is still the base branch (the user's tree untouched);
     - the Run row carries `repo_path`/`base_ref`/`ship_branch`;
     - **the Reviewer genuinely gated AND approved**: the reviewer node has an `AgentInvocation` with `outcome == "approved"`, and it is the run's FINAL reviewer outcome (proves a *reviewer-approved* ship, not an escalation-gate auto-approve of an unreviewed build).
  7. Print each check + PASS/FAIL (mirror `brownfield_check.py`'s result block) and surface the harvested verdict reasons. Echo a line stating which test runner the Reviewer used if discoverable (best-effort, from the verdict reasons / run-event log — informational, not a gate).
  8. Clean up the run's worktree + the temp fixture in a `finally` (mirror `brownfield_check.py`).
  Return 0 only if ALL checks hold, else 1.

B3. **The rung-1 fixture repo (built by the driver) — tractable but genuinely real-shaped.** A small Python package, materially harder than the calculator:
  - a real package layout (a top-level package dir with `__init__.py` + **≥2 interdependent modules** — e.g. one module that imports/uses another);
  - a `pyproject.toml`;
  - a conventions file (`AGENTS.md` or `CLAUDE.md`) with a couple of real rules;
  - an **existing test suite written as `unittest.TestCase` subclasses** (the no-regret robust choice — discoverable by BOTH `pytest` and the `unittest` fallback, so the gate can't be defeated by a missing-pytest container) that **covers the module the feature will edit** (so a botched edit actually breaks a test → the Reviewer's gate is REAL, not theatre).
  - **The scoped feature = a modification to an EXISTING module** (the brownfield-hard case the worker-protocol exists for), small + clearly pointing at one module (so 70b can locate it from the idea + the grounding's structure outline), and verifiable by the existing tests staying green + the new behavior being present. Keep it tractable enough that `nvidia_nim/meta/llama-3.3-70b-instruct` should clear it (de-risking the model wall on the *automated* gate). Pick a concrete domain (e.g. a tiny `pricing`/`discounts` or `validators` package) and a concrete feature; document both in the driver's docstring.

B4. **`Makefile` — add `brownfield-loop-check`** next to `brownfield-check`, same env (`TVASHTR_AGENT_SANDBOX=docker TVASHTR_AUTO_APPROVE_GATES=1 TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct TVASHTR_AGENT_MAX_ITERATIONS=40`), running `scripts/brownfield_loop_check.py`; add it to `.PHONY`; write a `##` help line describing it as the M-brownfield Slice-3 exit-bar gate (a real docker+NIM review_loop run ships a correct reviewer-approved change into a real-shaped repo). Skips cleanly without the key.

B5. **Re-verify greenfield is intact** by running `make loop-feature-docker` (the greenfield review-loop capstone) to green — this is the proof that the B1 reviewer-prompt generalization did not regress greenfield. (If `loop-feature-docker` is too slow/flaky in your environment, at minimum confirm the offline suite + lint are green and the prompt still contains `python -B -m unittest`; note in STATE.md whichever you ran.)

---

## Constraints / do-NOT-touch (express as acceptance evidence where you can)

- **NO migration.** No schema change. Do not create `0016`; do not bump the migration-freeze hook.
- **`team_run.py` stays openhands-free at import** (`WORKER_PROTOCOL` is a plain string from `worktree`).
- **`EngineAdapter` seam inviolable**; do not touch adapter signatures or `engines/`.
- **Greenfield byte-for-byte:** the offline suite (260+) + the greenfield smokes pass unchanged; the only greenfield-touching change is the B1 reviewer-prompt generalization, which is behavior-preserving and re-verified (B5).
- **`ENGINEER_PROMPT`/`PM_PROMPT` untouched.** Only `REVIEWER_PROMPT`'s test-command step changes, and it must retain the literal `python -B -m unittest`.
- **`build_two_node_team` untouched.** `brownfield-check` must still pass unchanged (its worker still gets orientation + the protocol — same directives, reassembled).
- **`test_reviewer_agent.py` untouched** (greenfield stub, grounding stays None).
- **Branch-per-step, never push, operator FF-merges.** Commit only your changed paths; leave `prompts/*.md` + the living docs untracked.

---

## Acceptance / evidence (run every check yourself; echo the decisive line per §4.3a)

- `make test` — **GREEN, ≥ 260 backend** (the new offline split test + the updated worktree tests raise it). Echo the `=== N passed in Xs ===` line.
- `make lint` — clean (ruff check + format-check; `scripts/` is under the gate). Echo the result line.
- `make brownfield-check` — **still PASS** (two_node brownfield unchanged). Echo its `PASS` line.
- `make brownfield-loop-check` — **PASS** (the new exit-bar gate; the full on-disk contract incl. tests-green-on-branch + a reviewer-approved ship). Echo its `PASS` line + the harvested verdict.
- `make loop-feature-docker` — **GREEN** (greenfield review-loop capstone unregressed by B1), OR the documented fallback per B5. Echo its final status.
- `READY_TO_MERGE: branch=feat/brownfield-review-loop, sha=<sha>, backend tests=<N>` written to `STATE.md`. Echo it.

## Stop conditions (NEEDS_HUMAN → `STATE.md`, then stop)

- **The run does not converge to a reviewer-approved correct ship after the loop's iterations** (the loop cycles/escalates without a green reviewer-approved build): this is a real signal that even the tractable rung-1 needs a stronger model — write `NEEDS_HUMAN: brownfield review_loop did not reach a reviewer-approved correct ship on llama-3.3-70b after N iterations; recommend the operator provision a stronger worker/reviewer model (no proven stronger agent model is wired — qwen is parked, OpenRouter exhausted) or accept a more tractable rung-1 feature`. **Do NOT weaken any assertion to force a green gate. Do NOT go hunting for an unproven model under bypass** (that is the "second/unknown problem needing an unproven change → STOP" clause).
- A genuinely DEAD `NVIDIA_BUILD_API_KEY` (not a throttle/retry — those you retry on a clean roll, the `brownfield-check` flakiness pattern) → `NEEDS_HUMAN`.
- The reviewer prompt change forces a choice that would regress greenfield in a way you cannot make behavior-preserving → STOP and surface it rather than changing greenfield behavior.
- Otherwise (compiler/import/test failures, docker/NIM throttle-retries, lint) — fix it yourself; retry the live targets on a clean roll.

## Report-back (in `STATE.md` + the final message)

Files changed; the exact `REVIEWER_PROMPT` diff (the one greenfield-touching change); the rung-1 repo shape + feature you chose; commands run WITH their decisive output lines (`make test`, `make lint`, `brownfield-check`, `brownfield-loop-check`, `loop-feature-docker`); the harvested reviewer verdict from the live run; which test runner the Reviewer used (if discoverable); any deviation + rationale; the suggested next step.
