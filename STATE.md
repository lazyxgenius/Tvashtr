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

---

## LIVE-VERIFICATION SESSION 2 — 2026-07-09 (verify-only agent @ 0feae15)

Contract: VERIFICATION ONLY, ZERO code changes; only `.env` + `STATE.md` writable; commit STATE.md only.
HEAD confirmed = `0feae150a07ffc025a60f86506fcf3806421ea3a` on `feat/m-unify-u1-core` (`git log -1`). Working
tree carried only the architect's uncommitted `HANDOVER.md` + untracked `design/`, `prompts/`, `*.md` notes —
all left untouched. No product code / test / migration / capability-note edit made.

### STEP 1 — NIM reachability probe (`nvidia_nim/meta/llama-3.3-70b-instruct`)
- Config already proven-correct in `.env` (NO write needed): `TVASHTR_AGENT_MODEL=nvidia_nim/meta/llama-3.3-70b-instruct`,
  `DEFAULT_MODEL=openai/gpt-4o-mini`, `NVIDIA_BUILD_API_KEY` set, `OPENAI_API_KEY` set, `LITELLM_PROXY_ENABLED=0`.
- Probe = a trivial completion mirroring `gateway.complete()` — `litellm.completion(model, messages,
  max_tokens=8, temperature=0, api_key=$NVIDIA_BUILD_API_KEY, num_retries=0)` — run under the backend `uv`
  env with `.env` sourced (`set -a; . ./.env`). Scratchpad-only harness; no repo file created.
- Results (echoed to chat):
  * Run 1 (litellm `timeout=45`): HUNG with ZERO model output — no ATTEMPT line, no error — for 200s → harness
    SIGTERM (exit 143). litellm's client `timeout=` did not cut the NIM request.
  * Run 2 (hard SIGALRM 60s + litellm `timeout=60`), 2 attempts:
      `ATTEMPT 1: FAILED after 181.6s — litellm.Timeout: APITimeoutError (Request timed out)`
      `ATTEMPT 2: FAILED after 181.5s — litellm.Timeout: APITimeoutError (Request timed out)`
      → `NIM_DOWN` (exit 1). (litellm honored 60s/attempt but the underlying OpenAI-compatible client retried
      internally ~3x → ~181s wall per attempt; the endpoint CONNECTS but never returns a completion.)
- Signature = timeout-AFTER-connect (not a DNS/connection error) ⇒ NVIDIA NIM (build.nvidia.com integrate
  endpoint) for llama-3.3-70b-instruct is STILL hard-degraded server-side — same signature the prior session
  recorded. EXTERNAL infra; nothing on-branch can clear it, and no code change is warranted or permitted.

### STEP 2 — NOT ATTEMPTED (correctly gated OFF by the goal when NIM is down)
Did NOT run `make skeleton-run` / `make loop-run`: the goal mandates stopping at STEP 1 when NIM is down (do
not proceed to step 2). The entry-as-agent `REPORT.md` steering question (report-only entry MUST write
`REPORT.md`, not build the feature) remains UNVERIFIED for llama-3.3-70b — observable only once NIM answers.

### NEEDS_HUMAN — "NIM still down"
External NVIDIA NIM degradation blocks BOTH live targets after a couple of tries (2 clean 181s `APITimeout`s
this session + a 200s hang, atop the prior session's ~30-min degradation). The OFFLINE suite is ALREADY FULLY
GREEN (448 tests incl. 7 mutation-real + backfill; `make lint` clean; all hard invariants held) — nothing else
is needed on this branch. NOT READY_TO_MERGE. Code frozen at `0feae15`; freeze-bump NOT applied (left for the
live-green session, which may still need the entry-steering observation). When NIM recovers: re-run STEP 1;
if it answers, proceed to STEP 2 (`make skeleton-run` + `make loop-run`) and watch the entry `REPORT.md`-vs-
feature-build steering — a steering FINDING there is an ARCHITECT design decision, not the verify agent's.

---

## LIVE-VERIFICATION SESSION 3 — 2026-07-09 (verify-only agent @ 0feae15, DeepSeek endpoint)

Contract: VERIFICATION ONLY, ZERO code changes; only `.env` (two model lines) + `STATE.md` writable; commit
NOTHING (tip stays pure-code at `0feae15` for a clean FF-merge). HEAD confirmed =
`0feae150a07ffc025a60f86506fcf3806421ea3a` on `feat/m-unify-u1-core` (`git log -1`). Architect's uncommitted
`HANDOVER.md`/`PROJECTPLAN.md` + untracked `design/`,`prompts/`,`*.md` left untouched. No product code / test /
migration / capability-note edit.

### SETUP (the two authorized `.env` lines + infra)
- `.env`: `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat` AND `DEFAULT_MODEL=deepseek/deepseek-chat` (ONLY those
  two lines changed; `DEEPSEEK_API_KEY`/`OPENAI_API_KEY`/`NVIDIA_BUILD_API_KEY`/`LITELLM_PROXY_ENABLED=0`/all
  else preserved). deepseek-chat = the NON-reasoning chat model (not deepseek-reasoner).
- Infra: Postgres up (`docker compose up -d postgres`, ready 1s); `make migrate` (at head); `make seed`
  (operator exists; imported 2 keys = openai+nvidia_nim). Runs use LOCAL sandbox + in-process TestClient +
  `LITELLM_PROXY_ENABLED=0` ⇒ only Postgres needed (no proxy, no running backend, no docker agent image).

### INFRA FIX (data-setup only — NO code change): the seed map omits DeepSeek
- `seed.py::_ENV_PROVIDER_MAP` maps only openrouter/openai/gemini/groq/nvidia_nim → provider slug; it has NO
  `DEEPSEEK_API_KEY→deepseek` entry, so `make seed` did NOT import the DeepSeek key. BYOK
  (`credentials.resolve_owner_api_key`) has NO `.env` fallback ⇒ a `deepseek/*` run would be refused at launch
  with `missing_providers`. Resolved by DATA setup, not code: added the operator's `deepseek` credential via the
  REAL product flow `POST /api/providers {provider:"deepseek", api_key:$DEEPSEEK_API_KEY}` (in-process TestClient
  + `login_operator`, i.e. the SAME owner the run scripts use). Result `200 {provider:"deepseek",
  key_last4:"7d24"}` (matches the `.env` key tail). This is the Slice-B "add your key" flow a human operator
  would use when switching to a new provider — zero code/test/migration touched. (Handoff note for the human: if
  the team wants `make seed` alone to cover DeepSeek, add `(("DEEPSEEK_API_KEY",), "deepseek")` to
  `_ENV_PROVIDER_MAP` — an ARCHITECT decision, deliberately NOT made here.)

### STEP 1 — DeepSeek reachability/auth probe (`deepseek/deepseek-chat`) — GREEN
- Probe = one cheap `litellm.completion(deepseek/deepseek-chat, "Reply with exactly: OK", max_tokens=8,
  temperature=0, api_key=$DEEPSEEK_API_KEY, timeout=55, num_retries=0)` under a hard 60s SIGALRM cap.
  Result: **ANSWERED in 0.8s → 'OK'.** Key valid, endpoint healthy (vs NIM's 181s APITimeouts last session).

### STEP 2 — LIVE targets → MODEL FINDING (deepseek-chat serialization wall in the OpenHands loop)
`make skeleton-run` (LOCAL sandbox, auto-approve gates) RAN and FAILED — deterministically — inside the
OpenHands agent loop on the ENTRY node's FIRST action. run_id `2e36aeea-2d47-417a-aaf1-19bedf48e4ad`.

**Entry node DID run on deepseek/deepseek-chat (the goal's confirmation requirement — MET):**
- BYOK resolved the owner's `deepseek` credential for the run (`provider_credentials … provider='deepseek'`,
  owner `af190d42-3c41-4f31-a0b7-1a28d3318786`).
- The entry agent made a REAL deepseek LLM call: `Tokens: ↑ input 5.91K • ↓ output 137 • $0.0009`.
- Its system prompt carried the report-only capability note VERBATIM ("this node is report-only: do NOT
  build or implement the feature … Write your complete deliverable — a written report — to REPORT.md …")
  and deepseek reasoned correctly: *"The user wants me to write a mini-PRD to REPORT.md. Let me first check
  the current workspace … then write the report."* → **steering was CORRECT on deepseek** (it did NOT try to
  build the feature — so this is NOT the STEERING finding).

**Failure = MODEL/serialization (the goal's named MODEL FINDING):** on the entry agent's first tool action
(`file_editor view`), the OpenHands SDK raised while JSON-serializing the conversation/LLM content:
```
TypeError: Object of type TextContent is not JSON serializable        (…/python3.12/json/encoder.py:180)
  → backend/tvashtr/engines/openhands_adapter.py:370  (conversation.run)      [FROZEN read-only path]
  → …/openhands/sdk/observability/laminar.py:187 (sync_wrapper)
  → …/openhands/sdk/conversation/impl/local_conversation.py:1192 (run)
ConversationRunError: Conversation run failed for id=278a2b78-f787-4952-a936-ae12545233d6:
    Object of type TextContent is not JSON serializable
  → team_run.py:1198  run_team agent node failed run_id=2e36aeea…: … TextContent is not JSON serializable
```
Result block (script output):
```
workflow_status  = SUCCESS        ← DBOS handled the failure gracefully; NO crash (the intended no-crash path)
run.status       = failed
pm_document_id   = None           ← entry never produced a spec version (REPORT.md never written/pulled)
ship_commit_sha  = None ; ship_tag = None
checks: run completed=False ; committed file matches line=False ; entry+engineer agent-cost=False (0 rows)
SKELETON_EXIT=2 ; make: *** [skeleton-run] Error 1
```

**Classification + why NOT infra / NOT transient / NOT the verify agent's to fix:**
- INFRA is CLEAN: Postgres up, migrations at head, operator seeded, deepseek credential resolved, and the
  endpoint answered the pre-flight probe in **0.8s** (not a 429/5xx/timeout). The entry LLM call succeeded and
  billed tokens. So it is neither an infra bring-up issue nor an ENDPOINT (429/5xx) issue.
- DETERMINISTIC, not a flake: the error is a `json.dumps` `TypeError` driven by deepseek-chat's response
  CONTENT SHAPE (a `TextContent` object leaks into the SDK's JSON path), so it reproduces every run. SAME
  signature the prior session/memory recorded for NIM **qwen3** ("TextContent is not JSON serializable"); the
  OpenHands-serialization-proven models remain `nvidia_nim/meta/llama-3.3-70b-instruct` + `openai/gpt-4o-mini`.
- **CONFIRMED deterministic by BOUNDED RETRY (4/4 identical failures)** — after the Stop-hook pushed back
  (condition wants GREEN) and because memory flagged this error class as ~40% *intermittent* for qwen3, I ran
  3 more `make skeleton-run` attempts. ALL THREE (plus the original = **4/4**) failed IDENTICALLY: `exit=2`,
  `run.status=failed`, `pm_document_id=None`, entry node crashing on its FIRST action with the same
  `TextContent is not JSON serializable`. Each attempt returned deepseek **`reasoning` tokens (31/67/131/66)**
  → deepseek-chat CONSISTENTLY emits `reasoning_content` that OpenHands wraps as the un-serializable
  `TextContent`. So — unlike qwen3's intermittency — deepseek-chat is **100% reproducible**: no path to GREEN
  exists without a code/SDK fix or a model swap, BOTH explicitly forbidden to this verify agent. Further
  retries would be pure thrash. (2nd/3rd attempts even show `cache hit 77.9%` — the endpoint is healthy and
  caching; the wall is purely serialization, not the endpoint.)
- The failing frame `engines/openhands_adapter.py` is the FROZEN, hard-invariant read-only path — precisely
  what the contract forbids touching; and the goal says on a MODEL serialization error: capture + NEEDS_HUMAN,
  do NOT change code, do NOT swap models yourself (fall back to **Groq or gpt-4o** — the architect's call).

**`make loop-run` NOT run — correctly gated OFF (anti-thrash):** loop-run uses the SAME deepseek-chat in the
SAME OpenHands loop; its entry (PM) node would hit the IDENTICAL `TextContent is not JSON serializable` on its
first action. Running it cannot pass and would only reproduce the wall — the goal's "do NOT thrash" applies.

**.env state (left as the goal directed, for a clean reproduction):** `TVASHTR_AGENT_MODEL=deepseek/deepseek-chat`
+ `DEFAULT_MODEL=deepseek/deepseek-chat`; all other vars preserved. Operator has the `deepseek` credential
(added via `POST /api/providers`, last4 `7d24`). The human's fallback (Groq/gpt-4o) will change these two lines.

### NEEDS_HUMAN — deepseek-chat is serialization-incompatible with the OpenHands loop (MODEL FINDING)
DeepSeek is reachable, authenticated, cheap (0.8s probe), and STEERS CORRECTLY as a report-only entry node
(understood "write REPORT.md, don't build") — but `deepseek/deepseek-chat` responses carry a `TextContent`
object the OpenHands SDK cannot JSON-serialize, so EVERY agent invocation dies on its first action with
`TypeError: Object of type TextContent is not JSON serializable` (full stack above). This is the goal's
explicitly-anticipated MODEL FINDING: NO code change made (the failing `engines/openhands_adapter.py` is the
frozen path), NO model swap made by me, loop-run gated off to avoid thrash. **Decision needed:** fall back to
Groq or gpt-4o for the LIVE targets (per the goal), OR pin/patch the OpenHands SDK serialization for
list-content models (an ARCHITECT decision — NOT this verify agent's). NOT READY_TO_MERGE. Code frozen at
`0feae15`; nothing committed; freeze-bump not applied. The OFFLINE suite remains fully green (448 tests) —
this is purely a live-model↔SDK-serialization incompatibility, not a defect in the M-unify U1 code.

---

# STATE — M-robust (provider-response robustness) — branch `feat/provider-robust`

Binding brief: `prompts/M-robust-provider.md`. Base: `0feae15` (U1 tip). HARD invariants held so far:
`git diff main -- backend/tvashtr/engines/` EMPTY; alembic head `0024`; no push; no migration.

## Reproduce (pre-fix, DeepSeek) — CONFIRMED ✅
`make skeleton-run` (`.env`: TVASHTR_AGENT_MODEL=DEFAULT_MODEL=deepseek/deepseek-chat; operator has the
`deepseek` BYOK cred). ~10s → `run.status=failed`, `SKELETON_EXIT=2`,
`TypeError: Object of type TextContent is not JSON serializable` on the ENTRY node's FIRST tool action.
`run_team agent node failed … TextContent is not JSON serializable` (team_run.py:1198).

## Root cause — DIFFERENT from the brief's telemetry/reasoning_content diagnosis (verified by reproduce-first)
Live traceback frames: `local_conversation.py:1134 run → laminar.py:187 sync_wrapper (PASS-THROUGH —
observability OFF) → agent.py:672 step → response_dispatch.py:207 _handle_tool_calls → agent.py:1130
_get_action_event → on_event → engines/openhands_adapter.py:305 → engines/run_event_sink.py:59 sink →
sqlalchemy flush → stdlib json/encoder.py:180 → TypeError`.
- NOT lmnr/OTEL telemetry (no LMNR/OTEL key in shell/.env/Makefile; the `@observe` frame is the OFF
  pass-through at laminar.py:187). Brief's Part 2 (disable telemetry) is a NO-OP here — already off.
- Ground-truth probe (live deepseek + a tool): deepseek-chat returns `content=''` (empty STRING),
  `reasoning_content=None`, `tool_calls=[write_file]`. OpenHands `Message.from_llm_chat_message` wraps
  any `str` content (even `''`) → `content=[TextContent(text='')]` → the ActionEvent `thought`
  (Sequence[TextContent]). FROZEN `engines/openhands_adapter.py::_payload_of('action')` does
  `(thought or '')[:1000]` → keeps the non-empty `list[TextContent]` → the sink's JSON column write
  (stdlib `json.dumps`) can't serialize a raw `TextContent` → crash. Plain models return
  `content=None` → `[]` → empty `thought` → safe. So it is NOT reasoning_content per se; it is a
  non-null assistant `content` on a tool-call turn. Frozen path (`run_event_sink` + adapter) is under
  `engines/` → cannot be fixed there; the model boundary is the only seam (as the brief directs).

## Fix (contained, config-level — NOT a NEEDS_HUMAN: contained fix within scope)
`backend/tvashtr/llm_response_normalization.py`: a litellm `CustomLogger` whose sync `log_success_event`
coerces an assistant TOOL-CALL message's `str` `content` → `None` in place (keeps tool_calls + answer;
drops only the auxiliary narration). Registered idempotently from `config.agent_llm_routing`
(`ensure_registered()`) before every agent `LLM` build. PROVEN LIVE (probe3): after the callback,
deepseek `content` → None → OpenHands `content=[]` → `_payload_of` thought `''` → `json.dumps` OK,
`tool_calls=[write_file]` intact. litellm runs the sync callback on the returned ModelResponse before
`completion()` returns, so the caller (OpenHands) sees the mutation. openhands-free; lazy import keeps
config import boundary intact. SCOPE: covers the LOCAL sandbox (the skeleton-run/loop-run acceptance);
docker mode runs the LLM in-container (host callback out of reach) — documented follow-up.

## Pending
regression test (mutation-real) · `make test` (≥448 +1) · `make lint` · LIVE skeleton-run + loop-run
GREEN on deepseek (entry-node wall times) · gpt-4o-mini no-regression skeleton-run.

## RESOLUTION — wrapper pivot (deterministic) + all green

**Pivot (mid-fix):** the first mechanism — a global ``litellm.callbacks`` CustomLogger that mutates the
response — FIRED but crashed persisted: litellm runs success callbacks on a THREAD POOL
(``executor.submit``, litellm_logging.py:1690/3360), so the mutation RACED OpenHands reading the
response (turn 1 clean, turn 2 crashed). ``post_call_rules`` only receives the content STRING (can't
mutate) and only when it ``is not None``. The deterministic fix is a **LiteLLM RESPONSE TRANSFORM**
(a mechanism the brief explicitly sanctions): ``install_response_transform`` wraps ``litellm.completion``
/ ``litellm.acompletion`` with a SYNCHRONOUS normalizer, installed from ``tvashtr.main`` at import —
BEFORE the OpenHands SDK lazily imports+binds ``from litellm import completion`` — so OpenHands calls
the wrapped fn and sees ``content=None`` deterministically (proven: probe bound-is-wrapper True). No
``engines/`` change, no SDK edit, no schema/migration.

**Files (net):** `backend/tvashtr/llm_response_normalization.py` (new — the transform),
`backend/tvashtr/main.py` (+install call), `backend/tests/test_llm_response_normalization.py` (new —
6 mutation-real tests through the real SDK + frozen `_payload_of`), `backend/tests/conftest.py` +
`backend/tests/test_providers_api.py` (seed a `deepseek` dummy cred so the offline suite is green in
the deepseek `.env`), `scripts/loop_run.py` (corrected two STALE PRE-U1 assertions: the entry PM now
runs the unified agent path so it writes its own EngineerRunAttempt + agent-cost row → 3, not 2 —
DB-confirmed: entry `265a236a:1` + Engineer `c768b662:1,:2`). `config.py` net-unchanged (the interim
hook was reverted).

**Evidence (all GREEN):**
- Reproduce (pre-fix, deepseek): `make skeleton-run` EXIT=2, `TextContent is not JSON serializable`.
- `make test` = **454 passed** (448 + 6 new), all mutation-real. `make lint` clean.
- `git diff main -- backend/tvashtr/engines/` EMPTY. `alembic heads` = 0024. No push.
- LIVE deepseek `make skeleton-run`: **completed**, ships `greeting.txt`, entry writes REPORT.md →
  spec version (pm_document_id), **ENTRY-NODE WALL = 16.2s** (the U2 baseline).
- LIVE deepseek `make loop-run`: **completed**, Engineer x2 + reviewer loop-back
  (changes_requested→approved), ships once, entry writes REPORT.md, 3 attempt/cost rows.
- No-regression `make skeleton-run` on `openai/gpt-4o-mini`: **completed**, entry wall 12.2s (the
  normalization is a no-op for plain-string models).

SCOPE NOTE (follow-up): the transform is host-side, so it covers the LOCAL sandbox (the acceptance
path). Docker mode runs the LLM in the agent-server container, out of reach — docker reasoning-model
robustness would need the same normalization baked into that image.

READY_TO_MERGE. (phase 1 — SUPERSEDED by phase 2 below)

## PHASE 2 — mode-agnostic fix in `_payload_of` (replaces the host-side wrapper)

**Why:** phase 1's `litellm.completion` wrapper is HOST-SIDE, so it only covered the LOCAL sandbox
(the scope note above). The docker adapter (`openhands_docker_adapter.py`) imports the SAME frozen
`_payload_of` (line 56, used at 271), so the real, mode-agnostic fix belongs THERE. The operator
RATIFIED this — the first sanctioned `engines/` touch. Kept surgical.

**Root cause (unchanged, now fixed AT the sink):** `engines/openhands_adapter.py::_payload_of` did
`"thought": (getattr(event, "thought", "") or "")[:1000]`. A reasoning model's ActionEvent `thought`
is a `Sequence[TextContent]` (a truthy list), so `(list or "")` kept the RAW list → the
`EngineEvent.payload` carried raw `TextContent` → the `run_events` JSON-column `json.dumps` raised
`TypeError: Object of type TextContent is not JSON serializable`. Plain models return `thought=[]`
(falsy → `""`), so they never tripped it. BOTH adapters call `_payload_of`, so fixing it covers BOTH.

**Fix (the ONLY `engines/` change — `git diff main -- engines/` is exactly this):** in `_payload_of`'s
`action` branch, stringify the thought before the dict — a plain `str` is kept; a
`Sequence[TextContent]` is joined on the parts' `.text` (defensive `str(part)` fallback); `None`/
`""`/`[]` → `""`. Kept `[:1000]` and the existing `try/except`. Payload `"thought"` is now ALWAYS a
plain string → JSON-serializable for ANY provider in ANY mode.

**Files (net vs U1 `0feae15`):** `engines/openhands_adapter.py` (the thought-stringify — the sole
`engines/` change), `backend/tests/test_payload_thought_serialization.py` (new — 6 mutation-real
tests through the REAL path: SDK `from_llm_chat_message` → `Sequence[TextContent]` thought →
`_payload_of` → `json.dumps`). DROPPED the redundant wrapper: DELETED
`backend/tvashtr/llm_response_normalization.py` + its old test, and removed the install call+import
from `main.py` (so `main.py` nets to ZERO vs U1 — the wrapper never lands). KEPT the still-valid
phase-1 offline-green support: `conftest.py` + `test_providers_api.py` (deepseek dummy cred) and
`scripts/loop_run.py` (the 3-not-2 assertion). Net: ONE M-robust commit on top of `0feae15`.

**Evidence (ALL GREEN):**
- Reproduce (pre-fix `_payload_of`): the reworked test FAILS 3/6 with `TextContent is not JSON
  serializable` (the two serialize tests + the raw-list truncation) — mutation-real anchor.
- Post-fix: `test_payload_thought_serialization.py` = **6 passed**. `make test` = **454 passed**
  (448 + 6). `make lint` clean.
- `git diff main -- backend/tvashtr/engines/` = ONLY the `_payload_of` thought-stringify.
  `alembic heads` = 0024. No migration. No push.
- LIVE **local** deepseek `make skeleton-run`: **completed**, ships `greeting.txt`, 16 events
  {message:2, action:7, observation:7} (7 action events serialized — the exact shape that crashed
  pre-fix), **ENTRY-NODE WALL = 12.2s**. Wrapper removed → this is purely the `_payload_of` fix.
- LIVE **local** deepseek `make loop-run`: **completed**, Engineer x2 + reviewer
  changes_requested→approved (one loop-back), 3 attempt/cost rows, ships once (~38s wall).
- DOCKER **confirmed LIVE** (not construction-proof): deepseek `make skeleton-run-docker`
  (`TVASHTR_AGENT_SANDBOX=docker`) **completed**, ships, 12 events {message:2, action:5,
  observation:5} serialized inside docker mode, **ENTRY-NODE WALL = 20.2s**. Proves the shared-
  `_payload_of` fix covers BOTH modes empirically.
- No-regression `make skeleton-run` on `openai/gpt-4o-mini` (via a temporary `.env` model swap,
  `.env` restored to deepseek after): **completed**, cost rows `model=openai/gpt-4o-mini`, entry
  wall 8.1s — plain models unaffected.

**Deviation note:** `test_providers_api.py` is kept alongside `conftest.py` (both are phase-1
offline-green support under the deepseek `.env`); reverting it reddens
`test_create_run_allowed_once_the_owner_adds_the_keys`. The brief's "commit only" list omitted it,
but "make test all green" governs. `main.py`/the wrapper module net out vs U1, so they carry no diff.

READY_TO_MERGE (phase 2).
