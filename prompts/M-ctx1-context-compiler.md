# M-ctx1 — Node context compiler + input budget + manifest + doc-handle + thinker max_tokens

**Session A (main checkout, branch `feat/m-ctx1-context-compiler`). This milestone DELIBERATELY opens the executor and adds migration `0019`.**

## Outcome
Pull the worker-node context-string assembly out of `control_plane/team_run.py` into a pure, unit-testable `compile_context(...)`; add a per-node **input** token budget that fails a breach BEFORE the agent call (with a clear reason naming the fattest part) instead of crashing mid-run; record a `context_manifest` per invocation; raise the thinker `max_tokens=400` ceiling; and when the spec is large, hand it to the worker as a `SPEC.md` file instead of inlining it — all with the small-greenfield path byte-identical to today.

## The three pieces (deep-dive C2 + C3 + C4)

### C2 — context compiler + input budget + manifest
- Extract the worker context assembly in `team_run.py` (the block starting `context = f"\n\n--- ORIGINAL IDEA ---\n{idea}..."` through `instruction = node_prompt + context`, ~lines 705–740) into a **pure function** `compile_context(...)` (no I/O, no DB) that returns (a) an ordered list of **typed parts** — each `{name, text, tokens}` — and (b) the assembled `instruction`. The parts, in the current order: `node_prompt`, `idea`, `spec` (the live PRD text), `revision` (only when `iteration > 1 and reviewer_feedback`), `grounding` (brownfield only), `worker_protocol` (worker-only, i.e. `not emits_outcome`), `worker_focus` (subpath only). Preserve the exact existing conditional logic — just move it into the function.
- Token-measure each part. Use a real tokenizer if one is already available in the deps; otherwise a documented `len(text)//4` heuristic. State which you used in a comment.
- Add a per-node **input** budget: a new setting `worker_context_token_budget` in `config.py` (default sized with headroom under the 131072 model window — pick ~110000; env-overridable via the usual `TVASHTR_...` alias) + an optional per-node override read from the node's existing `model_config` JSON (no migration for the override). If the compiled input **exceeds** the budget, DO NOT call the agent: return a **terminal failure** for that node with a clear reason that NAMES the fattest part and its token count (e.g. `context 152000 tok exceeds budget 110000 — the 'spec' part is 140000 tok`). Surface it exactly like the existing terminal-failure/blocker path (reuse the same status/return shape the `result.status != "completed"` branch uses). This is a clean **pre-call** failure — NOT a mid-agent crash, and NOT a new routable edge label (do not add any Edge/outcome vocabulary).
- Persist a `context_manifest` JSONB column on `agent_invocations` (migration `0019`): `{parts: [{name, tokens}], total_tokens, budget, handle_used: bool}`. Write it where the invocation row for a worker node is created/updated (check `control_plane/invocations.py` + `team_run.py`). Additive column, nullable.

### C3 — raise the thinker max_tokens ceiling
- Replace BOTH hardcoded `max_tokens=400` in `team_run.py` — `pm_step` (~line 265) and `thinker_refine_step` (~line 352) — with a new setting `thinker_max_output_tokens` (default ~2048; env-overridable) + an optional per-node override from the node's `model_config`. So a thinker's "produce the COMPLETE updated spec" is no longer silently truncated as specs grow. `CompletionRequest` already takes `max_tokens`; just source the value from settings/override instead of the literal.

### C4 — documents-as-handle + cache-friendly layout (bounded to the large path)
- Inside `compile_context`: when the `spec` part exceeds **~1500 tokens**, write the latest spec to `<workspace>/SPEC.md` (the host workspace dir the executor already knows) and replace the inline spec with a one-line pointer (e.g. `The full current spec is in ./SPEC.md — read that file before you start.`), AND reorder the assembled instruction **static-first** (stable `node_prompt`/`worker_protocol` before the volatile `idea`/`spec-pointer`/`revision`) so provider prefix-caches hit across loop iterations. When the spec is **at or below** the threshold, keep it INLINE in the **original order** — byte-identical to today.
- The executor writes `SPEC.md` to the host workspace dir; the docker adapter's existing `_push_workspace` carries it into the container. **Do NOT edit either adapter** — that is Session B's territory this batch, and keeping them byte-intact is what makes the parallel merge clean.
- Add `SPEC.md` to the workspace `.gitignore` handling if the brownfield ship path would otherwise pick it up (check the ship/pull scoping so `SPEC.md` never lands in a shipped diff).

## Hard invariants (prove them on disk)
- **Routing byte-equivalent**: outcome-label routing, `Edge.conditions` matching, gate/terminal logic, the `AgentTask` fields OTHER than `instruction`, and adapter selection are UNCHANGED. Only the context/instruction assembly moves into `compile_context`, plus the additive budget/manifest/max_tokens.
- **Small-greenfield byte-equivalence**: for a small greenfield case (tiny PRD, `iteration==1`, no grounding), the compiled `instruction` is **byte-identical** to the pre-refactor instruction. Prove it with a test that pins the old string (a golden literal captured from the current code) and asserts equality.
- **`control_plane/graph_validity.py` BYTE-INTACT** (grep/diff to prove).
- **Both adapters BYTE-INTACT** — `engines/openhands_adapter.py` and `engines/openhands_docker_adapter.py` (Session B owns them). A `git diff --stat main` must NOT list either adapter.
- **No Makefile target added** — reuse existing smokes (Session B adds the one new target this batch).
- Migration `0019` is a NEW file (the freeze hook allows new migrations). Bump the migration freeze to include `0019` as the **LAST** step. This is the one session adding a migration this batch.

## Acceptance / evidence (Claude Code runs ALL of this itself, to green, before READY_TO_MERGE)
1. `make migrate` applies `0019` cleanly; `alembic downgrade -1` then `alembic upgrade head` round-trips with no error.
2. `make test` GREEN — backend floor **≥ 336** (re-baseline from a fresh `make test` at the start; report the before/after counts). New tests, all mutation-real:
   - `compile_context` pure-function tests: the typed parts + token counts for greenfield, rework (`iteration>1`), and brownfield inputs.
   - The **budget-breach** test: a forced over-budget spec → the terminal `failed_over_context`-style failure whose reason names the `spec` part + its token count. This regression MUST fail if the budget check is deleted.
   - The **byte-equivalence** test (the golden-string equality above).
   - C3: a thinker call carries `max_tokens` from the setting (and a per-node override wins) — assert the value passed, not 400.
   - C4: above-threshold spec → `SPEC.md` written + a pointer in the instruction + static-first order; below-threshold → inline + original order (the byte-equivalence case).
3. `make lint` clean.
4. Live greenfield smoke IF a gateway key is configured: `make skeleton-run` (2-node) and `make loop-run` (loop) complete green — proving the refactor didn't break the greenfield path. If no key, echo that they were skipped and why (do NOT block on it).
5. Echo each piece of evidence into the chat as it lands. End with the branch name + `READY_TO_MERGE` + the before/after test counts + the `git diff --stat main feat/m-ctx1-context-compiler` (which must show `team_run.py`, `models.py`, `config.py`, `control_plane/invocations.py` if touched, the new `0019` migration, and new test files — and NOT the two adapters, NOT the Makefile).

## Stop conditions
- Write `NEEDS_HUMAN` to `STATE.md` and stop on an external blocker (missing dep, a broken SDK API, an ambiguous spec) or at a hard turn cap.
- Distinguish: a **second/unknown problem needing a broad or unproven change → STOP + `NEEDS_HUMAN`**; a **code-proven, contained, regression-guarded fix → proceed**.
- Commit ONLY this milestone's own changed paths. Do NOT touch `PROJECTPLAN.md`, `HANDOVER.md`, or any `prompts/*.md` (the architect owns those). Never `git push` (the hook blocks it; the operator merges).
