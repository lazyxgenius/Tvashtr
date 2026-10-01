# M1 — Stall guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Runs no longer hang silently: every model call has a time limit, busy/failed calls retry
3 times then switch once to a backup model, each running step reports a derived live state
(Working / Running a command / Retrying / Quiet / Stalled), a periodic sweep fails a step stalled 20
minutes, and Home's Needs you gets a "Run stalled" item.

**Architecture:** Backend only (no migration). The gateway gains a per-attempt wall-clock limit,
a 3-retry envelope on transient errors and the once-only backup switch, reporting both through an
optional `on_event` hook. The worker path (every node since M-unify runs the agent loop) gains an
additive `AgentRunResult.retries_exhausted` flag and the mid-run arm switches on it, using the node's
`config.fallback_model` else the account backup for its capability. Live state is DERIVED at read
time from `run_events` + `agent_invocations` (`control_plane/live_state.py`) and added to the
`/graph` nodes, the run payload (`run_extras`) and the inbox. A DBOS scheduled workflow
(`control_plane/stall_sweep.py`) enforces the 20-minute ceiling.

**Tech Stack:** FastAPI, DBOS, SQLAlchemy 2, litellm, pytest.

**Spec:** `prompts/m1-m11.md` §3 R1, R2 and §4 M1 (operator brief, untracked).

## Global Constraints

- R1 numbers, env-dialable: Quiet after 90 s (`TVASHTR_QUIET_AFTER_S`), Stalled after 300 s
  (`TVASHTR_STALLED_AFTER_S`), failed after 1200 s (`TVASHTR_STALL_FAIL_AFTER_S`), per-call limit
  `agent_request_timeout_s` (120 s).
- A running command is never Quiet or Stalled.
- R2: 429 / 5xx / connection error / timeout retried with backoff, 3 tries; then (or on a hard
  failure) ONE switch to the backup: node `config.fallback_model`, else `teams.account_fallback_model`
  for its capability, only if the owner holds a key for it and it differs from the primary. Each
  retry and the switch is a run event; the switch also records a `RunWarning`.
- Failure copy: `failure_code="stalled"`, "The Engineer stopped responding: no update for 20 minutes".
- APIs only add fields. No migration. `team_run.py` stays openhands-free at import; the
  `EngineAdapter` signature and `build_two_node_team` are untouched; forced harness stays LLM-free.
- State words (machine values): `waiting, working, running_command, needs_you, retrying, quiet,
  stalled, failed, done, stopped` (`carried_over` arrives with M3).

## Review Focus

1. A brand-new running run with no events is NOT quiet/stalled (its clock starts at
   `invocation.started_at`) — the inbox exact-list tests create such runs.
2. A step whose last event is a terminal `action` with no later `observation` stays
   `running_command` for hours (no sweep kill).
3. The sweep never touches a run that finished between detection and the write (guarded update).
4. A 429 that clears within the retries never burns the backup (the old test's intent, kept stricter).
5. The proxy budget cutoff (`Budget has been exceeded`) is never read as retries-exhausted.

## File structure

- Modify `backend/tvashtr/gateway/types.py` — `CompletionRequest.on_event` (optional callable).
- Modify `backend/tvashtr/gateway/gateway.py` — limit, retries, switch, events.
- Modify `backend/tvashtr/config.py` — the new settings.
- Modify `backend/tvashtr/engines/base.py` — `AgentRunResult.retries_exhausted: bool = False`.
- Modify `backend/tvashtr/engines/openhands_adapter.py`, `openhands_docker_adapter.py`,
  `openhands_fly_adapter.py` — set `retries_exhausted`.
- Modify `backend/tvashtr/control_plane/team_run.py` — backup resolution, mid-run arm, forced hang.
- Modify `backend/tvashtr/control_plane/domain_ask.py` / `team_run.domain_query_step` — pass `on_event`.
- Create `backend/tvashtr/control_plane/live_state.py` — derivation + activity line + host events.
- Create `backend/tvashtr/control_plane/stall_sweep.py` — the sweep + scheduled registration.
- Modify `backend/tvashtr/control_plane/run_failure.py` — `STALLED` code + message.
- Modify `backend/tvashtr/control_plane/inbox.py` — `run_stalled` item.
- Modify `backend/tvashtr/control_plane/run_views.py` + `routers.py` (`/graph`) — payload fields.
- Modify `backend/tvashtr/main.py` — import `stall_sweep` before launch.
- Tests: `tests/test_stall_guard_gateway.py`, `tests/test_stall_guard_worker.py`,
  `tests/test_live_state.py`, `tests/test_stall_sweep.py`, updates to `test_node_capabilities.py`.

## Tasks

### Task 1: Gateway — time limit, retry envelope, backup switch, events
- [ ] RED: (a) a fake `litellm.completion` that blocks is cut at `agent_request_timeout_s`
  (set to 0.2 s) and raises `GatewayError` naming the limit; (b) 429×3 then success → result from the
  primary, 3 `retry` events `{attempt 1..3, of 3, wait_s, next_at, reason, model}`, no `backup_model`
  event; (c) 429×4 → the fallback serves, one `backup_model` event `{from_model, to_model, reason}`;
  a hard failure still switches without retrying; a RuntimeError with no status is NOT retried.
- [ ] GREEN: `_call_with_limit` (daemon thread + `timeout=` kwarg), `_is_transient` (status 429/5xx,
  litellm type names RateLimitError/Timeout/APITimeoutError/APIConnectionError/InternalServerError/
  ServiceUnavailableError, our limit), backoff `base * 2**(n-1)` (`TVASHTR_MODEL_RETRY_BACKOFF_S`,
  default 10), retries `TVASHTR_MODEL_RETRIES` (default 3).
- [ ] Rewrite `test_a_429_on_the_primary_does_NOT_use_the_node_fallback` stricter: a 429 that clears
  within the tries never touches the fallback.
- [ ] Commit.

### Task 2: Worker path — retries exhausted switches once to the backup (helper)
- [ ] RED: adapters set `retries_exhausted` for a transient non-budget failure (local exception
  chain; docker/fly also from captured error-event text); default False.
- [ ] RED: executor — `retries_exhausted` + node fallback → one re-run on the fallback, a
  `backup_model` run event and a `fallback_model` RunWarning; no node fallback but an account backup
  for the capability the owner holds a key for → switch to it; backup equal to primary → no switch;
  budget cutoff → no switch; at most once.
- [ ] GREEN in `team_run.agent_run_step` (+ `capability` kwarg from the walk).
- [ ] Commit.

### Task 3: Live state derivation
- [ ] RED `tests/test_live_state.py`: states at 89/91 s and 299/301 s; terminal action without
  observation = `running_command` at 2 h; latest `retry` event = `retrying` with `{attempt, of,
  next_at}`; `backup_model` event → `backup_model` slug; new run with no events = `working`; run
  worst state ordering.
- [ ] GREEN `live_state.py`: `invocation_live(session, invocations, now) -> dict[int, dict]`,
  `run_live_state(...)`, `activity_line(kind, payload)`, `record_host_event(run_id, invocation_id,
  kind, payload)` (reuses `connector_proxy._write_event`'s band discipline).
- [ ] Commit.

### Task 4: Payloads + inbox
- [ ] RED: `/graph` nodes carry `live` (live_state, last_event_at, activity, activity_started_at,
  retry, backup_model) and the top level `live_state`; `run_extras` carries `live_state`; inbox
  lists `run_stalled` for a run stalled 5+ min, not for a fresh one; owner scope unchanged.
- [ ] GREEN, commit.

### Task 5: The 20-minute sweep
- [ ] RED `tests/test_stall_sweep.py`: a step with no update for 1201 s → invocation failed
  (`outcome="stalled"`), run `failed` with `failure_code="stalled"` and the R1 message, a `stalled`
  event, `close_run_sandboxes(run_id)` called, the DBOS workflow cancelled, the run no longer in
  flight (slot freed); a 1199 s step / a running command / a finished run is untouched; not
  registered when `TVASHTR_STALL_SWEEP=0` (conftest).
- [ ] GREEN, commit.

### Task 6: Forced hang + live proof
- [ ] `TVASHTR_FORCE_HANG_ROLE=<role>`: that node's step blocks like a model that never answers
  (no LLM), released by `close_run_sandboxes`. Unit test.
- [ ] `scripts/stall_guard_check.py` (LOCAL sandbox, small R1 numbers): poll `/graph` and show
  working → quiet → stalled → run failed `stalled`, inbox item, slot freed.
- [ ] Commit.
