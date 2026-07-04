# M-ctx0 — In-worker condenser ON + model bench

**Session B. You are in a git WORKTREE at `/Users/adimac/Desktop/Tvashtr-ctx0`, already checked out on branch `feat/m-ctx0-condenser-bench` (do NOT `git checkout` or switch branches). Your database is `tvashtr_ctx0` (the `DATABASE_URL` env is exported in your shell — every `make migrate`/`make test` you run hits it, isolated from the parallel session). This milestone adds NO migration.**

First actions: `make setup` (installs deps in this fresh worktree) then `make migrate` (applies the schema to `tvashtr_ctx0`, already at head `0018`). Then do the work.

## Outcome
Turn the OpenHands summarizing condenser ON in BOTH worker adapters so a long real-repo run compacts its own transcript as it grows (instead of blowing the model context window and crashing), and add a scripted model bench that races the candidate worker/reviewer models through the existing LiteLLM→NIM path.

## The two pieces (deep-dive C1 + C9)

### C1 — in-worker condenser ON
- In BOTH adapters — `engines/openhands_docker_adapter.py` (~line 296) and `engines/openhands_adapter.py` (~line 312) — construct the worker `Agent(...)` with a `condenser=`. Their `agent = Agent(llm=llm, tools=[...])` blocks are byte-identical, so this is the SAME change in both files.
- Use the OpenHands SDK's `LLMSummarizingCondenser`. **Read the installed SDK to get the exact import path + constructor signature — do NOT guess the params.** Wire it with `keep_first=2` (pins the first messages — the compiled instruction — so the durable spec/worktree/verdict artifacts that live OUTSIDE the transcript are never summarized away) and a sensible size/trigger threshold (whatever the SDK calls its "condense when the transcript exceeds N" param). The condenser's own LLM should reuse the agent's model + key (build it from the same `agent_llm_routing(...)` kwargs, or reuse the `llm` object if the SDK allows) — document the choice in a comment.
- **Config-only: keep the condenser params INLINE in the adapters** (module-level constants or literals). Do NOT add anything to `config.py` — the parallel session owns `config.py` this batch. No schema, no endpoint.
- The condenser is inert on a short transcript (it only fires past its threshold), so small greenfield/loop runs behave as before — but the Agent now HAS a condenser (that's what the unit test asserts).

### C9 — model bench script
- New script `scripts/model_bench.py` + ONE new Makefile target `model-bench` (the only Makefile change this batch). It runs the candidate models through the existing LiteLLM→NIM path against a fixed task and scores, per model: task success (a simple deterministic check on the output), tokens in/out, cost, wall-clock latency, and 429 count.
- Candidates for the WORKER seat: `nvidia_nim/meta/llama-3.3-70b-instruct` (baseline), the two Nemotron-3 models (super + nano — resolve their real NIM slugs), and `kimi-k2.6`. Score the REVIEWER seat separately (the D4 finding: a 70b rubber-stamps spec-violations, so the reviewer seat needs its own success measure — e.g. does it correctly REJECT a deliberately-wrong build).
- Write results in a flat dict/JSON shape that the future trajectory ledger can consume, and echo a compact summary TABLE to the chat.
- **The live model runs need NVIDIA quota.** Build the harness so it proves its plumbing offline/cheaply (a dry-run, or a single cheap-model call), and produce the full table WHEN quota allows. If NIM is throttled, report a PARTIAL table + the throttle reason — do NOT block merge on a full live run.

## Hard invariants (prove them on disk)
- **Executor BYTE-INTACT**: `control_plane/team_run.py` and `control_plane/graph_validity.py` untouched (the parallel session owns the executor). A `git diff --stat main` must list ONLY: the two adapters, `scripts/model_bench.py`, the `Makefile`, and new test file(s).
- **`config.py` untouched** (parallel session owns it — condenser params stay inline).
- **NO migration** (the freeze hook stays satisfied; do not create a `0019+` file).

## Acceptance / evidence (Claude Code runs ALL of this itself, to green, before READY_TO_MERGE)
1. A unit test asserting BOTH adapters construct the worker `Agent` WITH an `LLMSummarizingCondenser` carrying `keep_first=2` (and the threshold) — inspect/patch the constructed Agent. This regression MUST fail if the condenser is removed. (No DB needed for this test.)
2. A bench-harness smoke: `scripts/model_bench.py` imports and runs its plumbing (dry-run or one mocked/cheap call) and emits a well-formed summary table structure. (No live NIM needed to pass this.)
3. `make test` GREEN against `tvashtr_ctx0` — backend floor **≥ 336** (re-baseline from a fresh `make test` at the start; report before/after). M-ctx0 touches no DB-backed code, so the floor should be untouched + your new tests added.
4. `make lint` clean.
5. LIVE (run WHEN NVIDIA quota allows — NOT a merge blocker): a long/brownfield run showing condensation events in `run_events`, and the full multi-model bench table. Echo the results or, if throttled, the reason.
6. Echo each piece of evidence as it lands. End with the branch name + `READY_TO_MERGE` + the before/after test counts + the `git diff --stat main feat/m-ctx0-condenser-bench` (adapters + script + Makefile + tests ONLY — NO executor, NO `config.py`, NO migration).

## Stop conditions
- Write `NEEDS_HUMAN` to `STATE.md` and stop on an external blocker (the SDK condenser API is not what's expected, a missing dep) or at a hard turn cap.
- Distinguish: a **second/unknown problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`**; a **code-proven, contained fix → proceed**.
- Commit ONLY this milestone's own changed paths. Do NOT touch `PROJECTPLAN.md`, `HANDOVER.md`, or any `prompts/*.md`. Never `git push` (the hook blocks it; the operator merges).
