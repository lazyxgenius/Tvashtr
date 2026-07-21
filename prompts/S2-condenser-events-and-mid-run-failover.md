# S2 — Condenser events in `run_events` + mid-run provider failover

**Session 2 of the Tvashtr-79 parallel batch. TWO items (5 + 7), NO migration.** Runs in its own git worktree + its own Postgres DB; all gates OFFLINE (no docker, no live-LLM — the boot container-sweep must not cross into the sibling session). Both items live on the OpenHands adapter's event/error path, so they belong in one session. Operating contract: `prompts/CLI-RULES.md`.

**No schema change in this whole session** — item 5 uses the existing `run_events` table + its existing `kind` Text column; item 7 is code-only. Head stays `0030`; the migration-freeze hook is NOT bumped. (`git diff main -- backend/tvashtr/models.py backend/alembic` must be EMPTY.)

---

# ITEM 5 — persist the SDK Condensation event to `run_events`

## Outcome
When the in-transcript summarizing condenser fires (`LLMSummarizingCondenser`, already wired in every adapter), its **Condensation event is persisted to `run_events`** as a new engine-neutral kind, instead of being silently dropped. This gives C1 a durable, auditable artifact and finally satisfies M-ctx0's "visible condensation events in `run_events`" acceptance clause.

## The seam (grounded)
`_kind_of` (`backend/tvashtr/engines/openhands_adapter.py:68`) maps only `ActionEvent`→action / `ObservationBaseEvent`→observation / `AgentErrorEvent`→error / `MessageEvent`→message and returns `None` for everything else; the collector then DROPS it (`_on_oh_event`: `kind = _kind_of(...); if kind is None: return`). The SDK's Condensation event is not one of the four, so **zero condensation rows is structurally guaranteed, not evidence of absence** (the container-log-only proof Tvashtr-67 flagged).

## The fix
1. **Find the exact SDK Condensation event class + import path** from the installed `openhands` SDK in this worktree (grep the SDK — it is the event `LLMSummarizingCondenser` emits when it folds the transcript; the runtime log line is "Auto Conversation Condensation Triggered" / "Forgetting N events"). Import it beside the other event types (openhands_adapter.py:24-30).
2. Extend `_kind_of` to return `"condensation"` for that event type.
3. Extend `_payload_of` (openhands_adapter.py:82) with a `"condensation"` branch returning a small, JSON-able, bounded payload from the event's own fields (e.g. counts of events forgotten/kept and/or the summary text if exposed) — same defensive `getattr` + truncation style as the existing branches; never let payload extraction raise.
4. **Docker + Fly adapters reuse `_kind_of`/`_payload_of`** (both `from tvashtr.engines.openhands_adapter import _kind_of, _payload_of`), so this ONE edit covers local, docker, AND fly modes. No adapter-specific change needed for item 5.

## Reproduce-first (OFFLINE — no live LLM)
- A synthetic instance of the SDK's Condensation event type, fed through `_kind_of`, maps to `"condensation"` (RED today → `None` → dropped); through `_payload_of` produces a serializable dict.
- The adapter collector (`_on_oh_event`) COLLECTS a Condensation event rather than dropping it (RED today).
- Extend `backend/tests/test_condenser_wiring.py`, `test_run_events.py`, `test_payload_thought_serialization.py`.

## Invariant (as evidence)
- The four existing kinds map UNCHANGED (byte-identical for every non-condensation event) — item 5 is purely additive.
- No schema change (existing `run_events` table + `kind` column).

---

# ITEM 7 — mid-run provider failover (the in-container hard-failure case)

## Outcome
When a node's PRIMARY provider **hard-fails during the agent loop** (bad key rejected by the provider, provider outage, connection failure — NOT a 429), the run **automatically retries the step once on the node's `fallback_model`** instead of crashing — closing the gap the Slice-A "Fallback model" field left open (§17 Tvashtr-78: today the field only fires on the host-side `gateway.complete` path + a pre-flight missing-credential check, never mid-run, because the agent's litellm call is made in-container where the host never saw the failure).

## The seam is ALREADY THERE — this is a classifier + a one-shot retry, not a protocol rewrite
The in-container failure ALREADY reaches the host: the SDK genericizes the raised exception but the detail arrives as a `ConversationErrorEvent`, captured host-side into `error_event_texts`. The docker adapter (`openhands_docker_adapter.py:264-275, 466-489`) and the fly adapter (`openhands_fly_adapter.py:470-474, 593-597`) ALREADY classify the *budget* case there: `budget_hit = _is_budget_error(exc) or any(_text_has_budget_signature(t) for t in error_event_texts)`. Item 7 adds the exact analogue for provider failures.

## The fix — three parts

### 7a. Classifier (openhands_adapter.py, beside the budget helpers at :234-281)
Add `_text_has_provider_signature(text)` + `_is_provider_error(exc)`, MIRRORING `_text_has_budget_signature`/`_is_budget_error` (`_exception_chain_text` already exists — reuse it):
- Match HARD provider failures: authentication (bad/expired key), provider/API errors, connection failures, model-not-found. Match on litellm error-class names / message signatures across the exception chain AND the ConversationErrorEvent detail (the dual-surface approach budget uses).
- **EXCLUDE 429 / rate-limit / transient timeouts** — the SDK's own retry envelope (`num_retries`/`retry_max_wait` from `config.agent_llm_routing`) rides those; a generic 429 must stay `failed` and must NOT trigger failover. This exclusion is the crux — test it explicitly.
- Deliberately do NOT `import litellm` (preserve the gateway's litellm monopoly + the import boundary — match by class-name string + message substrings, exactly as `_is_budget_error` does).

### 7b. Signal it up — `AgentRunResult` (base.py:98) + both remote adapters
- Add an ADDITIVE field to `AgentRunResult`: `provider_failure: bool = False`. **Leave `status` as `Literal["completed","failed","over_budget"]` UNCHANGED** — so the workflow finalizer and every existing `result.status` switch stay byte-identical. On a hard provider failure the status is still `"failed"`; the new flag rides alongside.
- In the docker adapter's except block (`openhands_docker_adapter.py:466`) AND the fly adapter's (`openhands_fly_adapter.py:593`): when NOT budget but `_is_provider_error(exc) or any(_text_has_provider_signature(t) for t in error_event_texts)`, set `provider_failure = True` (status stays `"failed"`). Mirror the same classification into the local adapter's except block (`openhands_adapter.py:433`) for consistency.

### 7c. One-shot host retry — `agent_run_step`, team_run.py:946 (adapter call at :1153, status handling at :1174)
- After `result = adapter.run(task, ...)`, BEFORE the existing `if result.status != "completed"` return: if `result.status == "failed" AND result.provider_failure AND fallback_model AND not already_failed_over` →
  - re-resolve `(model, key) = _resolve_model_and_key(run_id, fallback_model, None)` (the fallback has no further fallback),
  - rebuild the `AgentTask` with the fallback model + key (identical to the primary task otherwise),
  - re-run `adapter.run(...)` ONCE, and use the second result,
  - record the swap: `record_resolution_warning(run_id, "fallback_model", fallback_model, f"primary {model!r} hard-failed mid-run — failed over to the node's fallback model")` (mirrors the pre-flight swap's existing warning at team_run.py:161).
- **Fail over AT MOST ONCE.** If the fallback run ALSO provider-fails (or fails for any reason), it propagates through the existing `!= "completed"` path as `"failed"` — no further retry.
- A node with NO `fallback_model` is byte-identical to today (the retry branch is never entered; a provider failure propagates as `"failed"` exactly as now).
- Leave the pre-flight swap (`_resolve_model_and_key`, team_run.py:132) as-is — item 7 ADDS the mid-run path; it does not replace the pre-flight one.

## Reproduce-first (OFFLINE — no docker, no live provider)
1. **Classifier:** `_is_provider_error` (and the text variant) → True for representative auth / connection / provider-error / model-not-found strings + exceptions; **False for 429 / rate-limit / timeout** (the exclusion). RED today (function doesn't exist).
2. **Executor one-shot retry:** a FAKE `EngineAdapter` (or monkeypatched `resolve_adapter`) whose `.run` returns `AgentRunResult(status="failed", provider_failure=True, …)` on the FIRST call and `completed` on the SECOND → assert `agent_run_step` re-runs on the `fallback_model`, completes, and records the resolution warning; assert it fails over at most ONCE (a second provider_failure is not retried). RED today (the run finalizes `failed` on the first result).
3. **No-fallback path unchanged:** with `fallback_model=None`, a `provider_failure` result finalizes `failed` with no retry (byte-identical to today).
- Extend `backend/tests/test_node_capabilities.py` (Slice-A fallback tests live here), `test_byok_retry_envelope.py`, `test_owned_run_executor.py`; a docker-classification unit test may go in `test_docker_adapter.py` if it can be driven with a synthetic `ConversationErrorEvent` without a live container — otherwise the classifier + executor tests above cover the behavior offline.

## Invariants / do-not-touch (as evidence)
- `AgentRunResult.status` vocabulary UNCHANGED; `provider_failure` is additive default-False → the workflow finalizer + every existing status switch byte-identical when no provider failure occurs.
- 429 / rate-limit NEVER failed over (proven by the classifier exclusion test).
- The pre-flight `_resolve_model_and_key` swap unchanged.
- No schema change anywhere in this session.

---

## Acceptance / evidence for the WHOLE session (Claude Code runs EVERY check itself, debugs to GREEN, echoes each)
- `make test` GREEN — floor **≥1000 backend**, plus the new item-5 + item-7 regressions.
- `make lint` clean; ruff/`make fmt` clean (re-run the FULL lint on ALL added files before READY).
- FE build + `make vitest` GREEN — floor **≥403 vitest** (both items backend-only; run to prove zero FE regression).
- `git diff main -- backend/tvashtr/models.py backend/alembic` EMPTY (NO migration; head stays `0030`; freeze NOT bumped).
- **NO docker / live-LLM gate** (offline batch). Any gate needing a live agent/container is OUT OF SCOPE for this worktree (run from `main` post-merge by the architect — never handed to the operator).
- End on a `READY_TO_MERGE` line naming the branch and stating "no migration (head 0030)".

## Stop conditions
- Write `NEEDS_HUMAN` to `STATE.md` + stop on an external blocker (DB won't connect; the SDK's Condensation event class can't be located — report what you found).
- A **code-proven, contained, regression-guarded** change MAY proceed. A **second/unknown problem needing a broad or unproven change** → STOP + `NEEDS_HUMAN`. In particular: if reliably classifying the in-container provider failure turns out to need a change to the OpenHands agent-server protocol itself (not just host-side classification of the `ConversationErrorEvent` detail), STOP and report — that is a broader change than this slice assumes.
- Hard turn cap per CLI-RULES. Commit only THIS session's changed paths on its own branch (never `-A`; never sweep `prompts/*.md` or the living docs).
