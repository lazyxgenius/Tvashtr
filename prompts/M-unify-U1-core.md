# M-unify U1 — Executor unification core (loop-always + the edits toggle)

## Mission
Collapse the thinker/worker execution split. After this slice, EVERY `AgentNode` executes through the single agent path (the one workers use today). The ONLY capability distinction is a new boolean `agent_nodes.edits_allowed`. A node with `edits_allowed=false` runs the full agent loop — read tools, terminal, its configured MCP tools and skills — but NONE of its file changes ever leave its sandbox; its deliverable is a written report. This is milestone U1 of M-unify (U2 = sandbox reuse, U3 = FE — NOT in scope here).

## Ratified design (implement exactly; do not re-litigate)
- **D1 loop-always.** `pm_step` and `thinker_refine_step` stop doing direct single completions. The entry node and every refine round execute as agent invocations through the same path as `agent_run_step` workers (same adapter, same harvest, same ledger/manifest recording). No hybrid fast-path.
- **D2.1 Deliverable file.** `REPORT.md` at the workspace root is the universal written deliverable. REQUIRED from edits-off nodes. OPTIONAL from edits-on nodes — if present, pull + surface it (run inspector / work-brief), no prompt changes on the worker path.
- **D2.2 Pull manifest is the bouncer (union of restrictions).** Pull scope per invocation:
  - `edits_allowed=false` → pull EXACTLY `REPORT.md` + the verdict file (`REVIEW_VERDICT.json` — do NOT rename it this slice).
  - `edits_allowed=true` AND the node is emitting (the Slice-4 rule) → verdict-only pull SURVIVES unchanged, plus `REPORT.md` if written. The Slice-4 clobber protection must NOT regress.
  - `edits_allowed=true`, non-emitting → current unscoped pull, plus `REPORT.md` if written.
  Enforcement is at the pull, NOT tool detachment. Detaching the file-editor tool from edits-off nodes is allowed as steering, but the guarantee asserted by tests is the pull scope.
- **D2.3 Spec versioning.** The run's spec document (`pm_document_id`) is owned by the ENTRY node. Each completed entry-node invocation whose pull contains `REPORT.md` writes that content as the NEXT version of the spec document. This REPLACES both the old pm_step text→doc and thinker_refine_step paths. Entry-node invocation ends with no `REPORT.md` → the invocation FAILS with a clearly recorded reason (event/warning naming the missing report); no crash, no silent empty spec version. Match existing node-failure semantics; do not invent new routing.
- **D2.4 Non-entry reports.** Pulled + stored/surfaced (inspector/work-brief). NOT versioned into the spec. NOT auto-injected downstream (registered deferral; out of scope).
- **D2.5 Capability note.** `compile_context` appends a new TYPED part, ONLY for edits-off nodes, recorded in `context_manifest` like any other part. Content (verbatim-close): "File changes you make in this run are not applied anywhere — this node is report-only. Write your complete deliverable to REPORT.md at the workspace root. Do not attempt workarounds to apply file changes." Edits-on nodes get NO new part — their compiled instruction stream must remain byte-equivalent to main.
- **D2.6 Downstream consumption.** Unchanged: the compiler writes the latest spec into the next node's workspace as `SPEC.md` (C4). No new inter-node channel.
- **Routing.** Unified nodes ride the EXISTING worker harvest. An edits-off node that emits a verdict routes on `Edge.conditions`; one that doesn't gets the existing default/catch-all behavior. Root/entry structural validation stays as-is semantically (entry must be `edits_allowed=false` where it required a thinker before — behavior-preserving under the backfill).

## Schema (the ONE migration)
New migration `0024`: `agent_nodes.edits_allowed` BOOLEAN NOT NULL, backfill `kind='completion'→false`, `kind='agent'→true`; server default for new rows = true is NOT desired — new-node default comes from the create path mapping kind (see API). Additive + reversible (downgrade drops the column). Keep `kind` in place, now vestigial for dispatch (register its later drop; do not remove it). Bump the migration-freeze hook to cover `0024` as the LAST step of the branch.

## API / transitional FE coherence (backend-only slice)
- Node GET returns `edits_allowed`. Node PATCH accepts it (additive, `model_fields_set` semantics like C7).
- The FE still drives `kind` until U3: when a PATCH changes `kind` WITHOUT explicitly sending `edits_allowed`, sync `edits_allowed = (kind == 'agent')`. Test this both directions. Explicit `edits_allowed` in the PATCH wins.
- Clone (`teams.py`) carries `edits_allowed`.

## Hard invariants (each checkable on disk)
1. Frozen migrations `0001–0023` byte-untouched (the hook enforces; do not fight it).
2. Never push. Branch `feat/m-unify-u1-core` off current `main` (`2c13d56`); verify base with `git log -1` before work.
3. `git diff main -- backend/tvashtr/engines/` is EMPTY. `pull_paths`, `mcp_config`, `skills` on `AgentTask` already exist — use them. If you believe an engines/ change is unavoidable, STOP and write NEEDS_HUMAN to STATE.md with the reason; do not make it.
4. Gate + terminal deterministic handling behavior-unchanged: their existing tests pass UNMODIFIED.
5. Existing tests may be UPDATED only where the unification legitimately changes semantics (e.g., pm_step-specific fakes); never deleted or weakened without a one-line justification in STATE.md per test. Floors: backend ≥ 442 → higher, vitest ≥ 252 (FE untouched → unchanged).
6. Commit only files you changed for this goal. Leave `PROJECTPLAN.md`, `HANDOVER.md`, `prompts/` alone.

## Acceptance / evidence (echo each into chat as it completes)
- `alembic upgrade head` → `0024`; a `downgrade -1` + `upgrade head` round-trip; a test asserting the backfill mapping on seeded rows of both kinds.
- `make test` all green, count ≥ 442 + the new tests below, all mutation-real:
  1. **Routing equivalence:** a template-shaped graph (entry → worker ⇄ reviewer loop) driven through the REAL `run_team` with a capturing/scripted adapter produces the SAME outcome-label sequence over the same edges as the pre-unification semantics, and the spec document gains one version per completed entry invocation (initial + each refine round).
  2. **Leak test (the bouncer):** an edits-off node whose scripted run writes `REPORT.md` PLUS a stray workspace file → `REPORT.md` is pulled + becomes a spec version (entry case) / surfaced (non-entry case); the stray file is ABSENT from the host worktree and from everything pulled.
  3. **Slice-4 survival:** the existing reviewer-cannot-clobber regression still passes UNMODIFIED, and an emitting `edits_allowed=true` node still gets verdict-only(+report) pull.
  4. **Verdict routing:** an edits-off node emitting `REVIEW_VERDICT.json` with a label routes per `Edge.conditions`.
  5. **Capability note:** present as a typed manifest part iff `edits_allowed=false`; an edits-on worker's compiled instruction byte-equivalent to main's for the same fixture.
  6. **Missing report:** entry node ending with no `REPORT.md` → invocation failed with the recorded reason; run does not crash the workflow.
  7. **PATCH sync:** kind-change syncs `edits_allowed` unless explicitly provided; explicit value wins; clone carries it.
- `make lint` fully clean (run it AFTER all files, including any scripts, are added).
- LIVE (you run these yourself and debug to green; the proven model `nvidia_nim/meta/llama-3.3-70b-instruct` via `.env`): `make skeleton-run` and `make loop-run` complete green end-to-end on the unified path. Echo the WALL TIME of each entry-node invocation (spin-up → pulled) — this is the latency baseline U2 optimizes against.
- `STATE.md` log maintained; final line `READY_TO_MERGE` + the branch tip sha.

## Stop conditions
- External infra (NIM degraded/throttled, docker pull walls) blocking the LIVE targets after reasonable retries → write NEEDS_HUMAN + exactly what's blocked; the offline suite must still be fully green first.
- Any fix requiring engines/-adapter rework, DBOS-semantics changes, or a schema change beyond `0024` → NEEDS_HUMAN; do not proceed.
- A second/unknown root cause needing a broad or unproven change → NEEDS_HUMAN. A code-proven, contained, regression-guarded fix within scope → proceed.
- Hard cap: 45 turns.
