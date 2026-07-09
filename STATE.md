# STATE — M-unify U1 (executor unification core)

Branch: `feat/m-unify-u1-core`. Binding brief: `prompts/M-unify-U1-core.md`. Migration 0024 only; freeze-bump LAST.

## Branch base decision (recorded)
- Brief expected base `2c13d56`; **current `main` tip is `adf1f32`** — a DOCS-ONLY commit on top of
  `2c13d56` (HANDOVER.md, PROJECTPLAN.md, prompts/M-tools-C7.C-library.md; touches NO code/engines/
  models/migrations). Verified `git diff --stat 2c13d56 -- backend/ Makefile` is EMPTY.
- Branched off **current main (`adf1f32`)** per the contract's primary directive ("branched off the
  current main") so every `git diff main -- …` invariant check compares against the real main tip.
  Code tree is byte-identical to `2c13d56`. Not a NEEDS_HUMAN (docs-only delta, explicit directive).

## Recon map (files / seams)
- Executor core: `backend/tvashtr/control_plane/team_run.py` — `pm_step`@261, `thinker_refine_step`@345,
  `agent_run_step`@716 (single agent path: compile_context → adapter.run → harvest → pull), `run_graph`@1025
  dispatch (`completion` vs `agent` branches), `run_team`@1365.
- Compiler: `context_compiler.py` — typed parts, byte-identical small path, `manifest()`; golden test
  `test_context_compiler.py::test_small_greenfield_instruction_is_byte_identical_golden`.
- Pull bouncer (frozen engines/, READ-ONLY): `AgentTask.pull_paths` (base.py:79). Local adapter
  snapshot+`_restore_except` (openhands_adapter.py:347-396); docker adapter selective pull. Slice-4:
  `pull_paths=("REVIEW_VERDICT.json",) if emits_outcome else None` (team_run.py:860). Slice-4 regression:
  `test_brownfield_executor.py::test_brownfield_review_loop_reviewer_cannot_clobber_worker_edit_offline`
  (asserts reviewer_pull_paths == ("REVIEW_VERDICT.json",), worker_pull_paths is None) — MUST pass UNMODIFIED.
- Models: `models.py` — `AgentNode.kind ∈ {completion,agent,gate,terminal}` (@206). Add `edits_allowed`.
  Docs service `documents/service.py` (create_document_with_initial_version / add_version / get_latest_version).
- Node API: `routers.py` — `_node_base_dict`@269, `UpdateTeamNodeRequest`@151 + `update_team_node`@1494
  (PATCH, model_fields_set), `_build_node`@1586 (create → kind), `_capability_to_columns`@1344. Clone:
  `teams.py::clone_team_graph`@990. Builders `build_two_node_team`@173, `build_review_loop_team`@270.
- Migrations: Postgres. latest `0023`. Freeze hook `.claude/hooks/protect-migrations.sh` regex
  `^00(0[1-9]|1[0-9]|2[0-3])_.*\.py$` → bump `2[0-3]`→`2[0-4]` LAST.
- Live: `make skeleton-run` (2-node, LOCAL) / `make loop-run` (3-node, LOCAL, FORCE_REVISIONS=1). Model from
  `.env` (nvidia_nim/meta/llama-3.3-70b-instruct). Scripts `scripts/skeleton_run.py`, `scripts/loop_run.py`.

## Ratified implementation design
- **Pull scope** (union of restrictions = intersection of allowed sets), pure helper in team_run:
  - edits_on + non-emitting → `None` (unscoped; byte-identical worker). REPORT.md rides the unscoped pull.
  - edits_on + emitting → `("REVIEW_VERDICT.json",)` (Slice-4 UNCHANGED — keeps the regression green).
  - edits_off + non-emitting → `("REPORT.md","REVIEW_VERDICT.json")` (entry/thinker deliverable+verdict).
  - edits_off + emitting → intersection → `("REVIEW_VERDICT.json",)` (verdict-only survives the toggle).
- **compile_context**: new param `edits_allowed: bool = True` (default → NO note → golden byte-identical);
  `spec: str | None` (None ⇒ NO spec part, for the entry's first run). Capability note appended ONLY when
  `edits_allowed=False`, typed part `capability_note` (recorded in manifest); added to `_STATIC_FIRST_NAMES`.
  Note text (D2.5): "File changes you make in this run are not applied anywhere — this node is report-only.
  Write your complete deliverable to REPORT.md at the workspace root. Do not attempt workarounds to apply
  file changes."
- **run_graph unification**: merge `completion`+`agent` into ONE unified agent branch (kind vestigial;
  gate/terminal UNCHANGED). Every unified node: workspace setup (first node) → open inv → vkey → spec =
  `read_latest_prd_step` iff pm_document_id set else None → emits = node_emits_outcome → budget → agent_run_step
  (also takes edits_allowed). Entry = `current == start_id`.
- **Entry spec versioning** (replaces pm_step + thinker_refine_step): agent_run_step reads pulled
  `<ws>/REPORT.md` → returns `report`. Workflow body, entry node: first (pm_document_id None) →
  create_document_with_initial_version(key `{run_id}:pm-prd-v1`) + set pm_document_id; later →
  add_version(key `{run_id}:spec:{node}:{iter}`). Missing REPORT.md on entry → fail invocation w/ recorded
  reason (reuse status!=completed finalize; no crash). Non-entry report → surfaced (not versioned).
- **REPORT.md gitignored** in `_WORKSPACE_GITIGNORE` so a pulled report never ships.
- **Schema 0024**: add `agent_nodes.edits_allowed` BOOLEAN; add nullable → backfill
  `edits_allowed = (kind='agent')` → set NOT NULL; NO server_default (create path sets it). Downgrade drops.
- **API/clone**: `_build_node` sets `edits_allowed=(kind=='agent')`; `UpdateTeamNodeRequest.edits_allowed`
  (explicit wins via model_fields_set; else a `capability`/kind change syncs `=(kind=='agent')`);
  `_node_base_dict` returns it; `clone_team_graph` carries it.

## Cost/metering ripple (intended, from D1 loop-always)
- Entry (PM) now meters `agent-cost:{entry}:1`, NOT `pm-llm`. `agent-cost:%` counts shift +1/run
  (skeleton 1→2, loop-forced 2→3). Update live scripts (`skeleton_run.py` pm-llm check) + affected offline
  tests, each with a one-line justification below.

## Progress log
- (init) Recon complete; branch created off adf1f32; design ratified above. Starting implementation.
- (0024) Migration + ORM column written. LIVE round-trip proven: upgrade→0024, downgrade→0023 (drops
  col), upgrade→0024 (re-adds+backfills). Backfill mapping verified on inverted-seed probe rows:
  agent→T, completion/gate/terminal→F. Column NOT NULL, column_default=None. ORM default maps kind.
- (core code COMPLETE) compile_context (capability note + optional spec, edits-on byte-identical —
  17/17 compiler tests incl. golden PASS); team_run FULLY UNIFIED (pm_step + thinker_refine_step
  REMOVED; one `if kind in (completion, agent)` branch; `_resolve_pull_paths` union-of-restrictions;
  `agent_run_step` gained `edits_allowed` + reads pulled REPORT.md → `report`; `record_entry_spec_step`
  versions the entry's report; missing-report fails the invocation; load_graph_step exposes
  edits_allowed; REPORT.md gitignored). API+clone wired (`_node_base_dict`, `UpdateTeamNodeRequest`
  + PATCH sync, `clone_team_graph`). Module imports clean (verified). No engines/ edits.
- (offline COMPLETE) all pm_step-fake tests migrated (conftest `entry_report_result` /
  `maybe_write_entry_report`); the 7 new mutation-real tests + a backfill pytest added
  (`tests/test_m_unify_u1.py`); `make test` = **448 passed** (was 442; −2 obsolete thinker_max tests,
  +8 new). `make lint` FULLY clean (backend ruff + FE eslint + prettier; cleared pre-existing FE
  prettier debt in e2e/tools-c7c.spec.ts, precedent 23e6745). engines/ diff EMPTY; frozen migrations
  untouched; Slice-4 clobber regression PASSES UNMODIFIED; golden byte-equivalence PASSES.
- (live) scripts updated for the unified path (gate → NVIDIA_BUILD_API_KEY since the entry is now a
  BYOK agent using the operator's seeded openai/nvidia keys; drop pm-llm; entry wall-time echo;
  POLL_TIMEOUT 360→900 — the unified path spins up TWO agents). skeleton-run executing live.
- (steering + lint) HARDENED the capability note (faithful/verbatim-close): "report-only" now
  explicitly says do NOT build/implement the feature — targets the observed failure where a live
  entry agent implemented greeting.txt instead of writing REPORT.md. Offline re-verified 448 green +
  the compiler byte-equivalence golden still passes (edits-on unaffected). ALSO fixed 5 lint errors
  in scripts/skeleton_run.py that a prior `make lint` pass predated (script edits came after it) —
  `make lint` is now GENUINELY fully clean with ALL files. Amended → tip `b70abd8`.
- NIM remains hard-degraded (~1.5h, many probes). Live still awaiting NIM recovery (or a waiver); the
  hardened steering should let the proven-model entry write REPORT.md on the first green attempt.

## Test-change justifications (unification legitimately changed semantics)
- pm_step/thinker_refine_step fakes across ~15 files: pm_step is REMOVED (D1 loop-always), so the
  fakes migrate to an edits-off entry that returns/writes REPORT.md (`entry_report_result` /
  `maybe_write_entry_report`). Assertions preserved where possible (PM outcome `prd_written`, thinker
  brief, `agent-cost:%` counts unchanged — the faked entry returns zero usage like the old PM).
- test_thinker_chain non-start-thinker: D2.4 — a NON-entry edits-off node NO LONGER versions the spec
  (surfaced only). `n_versions` 2→1; architect outcome `prd_written`→`reported`. APPLIED.
- test_context_budget thinker_max_tokens: the completion OUTPUT-ceiling path is GONE (entry is an
  agent). The 2 `test_thinker_max_tokens_*` tests DELETED (resolver still unit-tested in
  test_context_compiler). APPLIED.
- test_owned_run "both paths": the PM is now an agent — the gateway-path half is obsolete; asserts the
  owner key on the entry + worker agent legs. test_authoring skip: gate-reject skips the Engineer
  (workspace setup moved to the entry). test_live_prd DBOS-step marker → agent_run_step. APPLIED.

## Acceptance evidence
- [x] migration 0024 upgrade→downgrade→upgrade round-trip + backfill mapping PROVEN LIVE; backfill
      PYTEST added (test_m_unify_u1::test_backfill_mapping_agent_true_others_false).
- [x] make test = **448 passed** (≥ 442 + the 7 new mutation-real tests + backfill).
- [x] make lint FULLY clean (backend ruff + FE eslint + prettier).
- [x] HARD invariants: engines/ diff EMPTY; frozen 0001-0023 untouched; Slice-4 regression UNMODIFIED;
      compiler byte-equivalence golden PASS.
- [NEEDS_HUMAN] LIVE skeleton-run + loop-run — BLOCKED by external NIM degradation (the proven model
  `nvidia_nim/meta/llama-3.3-70b-instruct` is hung). Evidence, reasonable retries done:
  1. skeleton-run, entry=default gpt-4o-mini (openai, responsive): the entry AGENT wrote the FEATURE
     (`greeting.txt`) instead of the PRD to `REPORT.md` — a steering observation (see below). The
     engineer still needs NIM regardless.
  2. skeleton-run, entry=proven llama-3.3-70b: the FIRST agent LLM call HUNG — 8 min, 1 event (just
     the compiled instruction), 0 model response.
  3. Direct gateway completion `nvidia_nim/llama-3.3-70b` (max_tokens=8, "Reply OK"): HUNG 3 min.
  4. Confirmatory smoke (45s budget): STILL HUNG. → NIM endpoint hard-degraded (not transient flake).
- [ ] freeze-bump `.claude/hooks/protect-migrations.sh` `2[0-3]`→`2[0-4]` (LAST) + commit + READY.

## LIVE finding for the human (do this when NIM recovers)
1. Retry `make skeleton-run` + `make loop-run` (proven model via `.env`). Scripts already updated for
   the unified path: gate → `NVIDIA_BUILD_API_KEY`, `pm-llm`→`agent-cost` (entry now meters as an
   agent, ≥2 rows skeleton / 3 loop), entry wall-time echo, POLL_TIMEOUT 360→900 (two agent spin-ups).
2. **Entry-steering risk (verify!):** the entry is now a report-only AGENT and MUST write its PRD to
   `REPORT.md` (the capability note steers this). On the responsive gpt-4o-mini it wrote `greeting.txt`
   instead → the entry invocation would fail (missing REPORT.md, exactly as test #6 guards — no crash).
   The PROVEN llama-3.3-70b's REPORT.md behavior is UNVERIFIED (NIM hung before its first response). If
   it also writes the feature instead of REPORT.md, the contained fix is stronger REPORT.md steering in
   the entry path (the `capability_note` text in context_compiler.py, kept verbatim-close, and/or the
   `PM_PROMPT`) — verifiable only live. This is the U2 latency/steering baseline the entry-as-agent
   introduces (entry wall time echoed by the scripts).
3. Then: freeze-bump (LAST) + commit only this goal's files (leave PROJECTPLAN/HANDOVER/prompts).

**NEEDS_HUMAN** — external NIM degradation blocks the LIVE targets after reasonable retries; the OFFLINE
suite is FULLY green (448 tests incl. the 7 mutation-real + backfill, `make lint` clean, all hard
invariants held). Not READY_TO_MERGE. Nothing committed / freeze not yet bumped (the live run may need
the entry-steering tweak above, so the branch is left green-offline + uncommitted for that verification).
