# M-ledger — C5 (backend): invocation-scoped events + durable cost link + the trajectory ledger

**Session A of a two-session parallel batch. You are the BACKEND half.** A separate session
builds the frontend against the SAME wire contract below. Touch ONLY backend files — do NOT touch
any `frontend/` file. Capture-only: **NO training, NO judge-LLM, NO GPUs.**

## Outcome
Give every node-execution a durable `invocation_id` join key and use it to: (a) stop the
`run_events.seq` cross-invocation collision that silently drops every round after the first;
(b) attach each cost row to the execution it belongs to; (c) expose the assembled
one-row-per-node-execution ledger — enrich the run's `/graph` + event-feed endpoints and add a new
capture-only `/trajectory` endpoint. Migration `0020` (freeze bumped LAST).

---

## WIRE CONTRACT  — identical in both briefs; emit EXACTLY this shape (field names, types, nullability are fixed)

**1. `GET /api/runs/{run_id}/graph`** — every object in each node's `invocations[]` gains two
ADDITIVE fields (all existing fields — `iteration`, `status`, `outcome`, `outcome_detail`,
`started_at`, `ended_at` — stay exactly as-is):
- `context_manifest`: object | null — `{ "parts": [ { "name": string, "tokens": integer }, ... ], "total_tokens": integer, "budget": integer, "handle_used": boolean }`. This is the stored
  `agent_invocations.context_manifest` JSONB serialized as-is. `null` for any invocation that has
  none (thinker / gate / terminal rounds write NULL).
- `cost`: object | null — `{ "prompt_tokens": integer, "completion_tokens": integer, "total_tokens": integer, "cost_usd": number }`. Derived from the cost row linked to this
  invocation (see the cost-link below). `null` when no cost row is linked (gates/terminals; a
  zero-usage reviewer round that wrote no cost row).

**2. `GET /api/spike/run-events/{run_id}`** — every object in `events[]` gains three ADDITIVE
fields (existing `seq`, `kind`, `payload`, `created_at` stay):
- `invocation_id`: integer | null — the `agent_invocations.id` this event belongs to. `null` for
  legacy rows written before migration 0020.
- `node_id`: string (UUID) | null — the node that invocation ran on. `null` for legacy rows.
- `iteration`: integer | null — that invocation's round number. `null` for legacy rows.

**3. NEW `GET /api/runs/{run_id}/trajectory`** — owner-scoped (same auth as `/graph`), read-only,
capture-only. Returns:
```
{
  "run": { "id": string, "idea": string, "status": string, "cost_total_usd": number | null },
  "rows": [
    {
      "invocation_id": integer,
      "node_id": string,
      "role_name": string,
      "kind": string,                     // "completion" | "agent" | "gate" | "terminal"
      "iteration": integer,
      "status": string,
      "outcome": string | null,
      "outcome_detail": string | null,
      "context_manifest": object | null,  // same shape as in (1)
      "cost": object | null,              // same shape as in (1)
      "started_at": string (ISO-8601),
      "ended_at": string | null (ISO-8601)
    }
    // ... one row per agent_invocation for the run, ordered by started_at ASC (the walk order)
  ]
}
```
The frontend does NOT consume `/trajectory` — it is the machine-readable capture surface only.

**The cost-link:** a new nullable `cost_records.invocation_id` (BigInteger) column, set at each
cost-write site to the invocation the spend belongs to. The `cost` object above = the cost row
where `cost_records.invocation_id == agent_invocations.id` (LEFT JOIN + COALESCE sum; ≤1 row per
invocation).

---

## The changes (backend only)

### 1. Schema — `models.py` + migration `0020`
- `RunEvent`: add `invocation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)`. REPLACE the `__table_args__` unique constraint `uq_run_events_run_seq` on
  `(run_id, seq)` with `uq_run_events_run_invocation_seq` on `(run_id, invocation_id, seq)`.
- `CostRecord`: add `invocation_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True, index=True)`.
- Migration `0020` (NEW — the set is frozen; create a new revision on top of `0019`): add
  `run_events.invocation_id` (+ index); DROP constraint `uq_run_events_run_seq`, ADD unique
  `uq_run_events_run_invocation_seq` on `(run_id, invocation_id, seq)`; add
  `cost_records.invocation_id` (+ index). All additive/nullable — NO backfill (legacy rows keep
  NULL; Postgres treats NULLs as distinct so the new unique constraint accepts them).
  `downgrade()` reverses all of it.
- After everything is green, bump the migration-freeze hook
  (`.claude/hooks/protect-migrations.sh`) to include `0020` — as the LAST step.

### 2. The event sink — `engines/run_event_sink.py`
- `make_run_event_sink(run_id, invocation_id)` — add the param. Write `invocation_id` onto the
  `RunEvent`. The idempotent existence-check MUST filter by `(run_id, invocation_id, seq)` — NOT
  `(run_id, seq)` — else a later round's seq=0 still matches the first round's row and the event is
  dropped. **This filter change is the actual fix; the column alone is not enough.**

### 3. Metering — `metering.py`
- `record_cost(...)` and `record_agent_cost(...)`: add `invocation_id: int | None = None`, write
  it onto the `CostRecord`. Default `None` keeps any other caller safe.

### 4. The executor threading — `control_plane/team_run.py`
- Capture the id the open-step already RETURNS (it's discarded today): at BOTH open sites (the
  completion branch ~L1032 and the agent branch ~L1105) change `open_invocation_step(...)` →
  `inv_id = open_invocation_step(...)`.
- Completion branch: thread `inv_id` into `pm_step(...)` and `thinker_refine_step(...)`, and inside
  each pass `invocation_id=inv_id` into its `record_cost(...)` call.
- Agent branch: thread `inv_id` into `agent_run_step(...)` (which passes it to
  `make_run_event_sink(run_id, inv_id)`) AND into `persist_agent_cost_step(...)` (which passes
  `invocation_id=inv_id` into `record_agent_cost(...)`).
- `agent_run_step` gains an `invocation_id: int` param (it's a `@DBOS.step`; an int arg is
  replay-safe).
- Gate/terminal branches write no cost + emit no events — leave them (their invocations correctly
  carry `cost=null`, no events).
- Do NOT change any routing, outcome label, or edge. `graph_validity.py` stays byte-intact.

### 5. The endpoints — `routers.py`
- `get_run_graph` (`GET /api/runs/{run_id}/graph`): enrich each invocation dict with
  `context_manifest` (serialize the stored JSONB as-is) + `cost` (from the
  `cost_records.invocation_id == agent_invocations.id` join; null if none). Existing invocation
  fields unchanged.
- `get_run_events` (`GET /api/spike/run-events/{run_id}`): join `run_events` → `agent_invocations`
  on `invocation_id`; add `invocation_id`, `node_id`, `iteration` per event. Existing fields
  unchanged.
- NEW `get_run_trajectory` (`GET /api/runs/{run_id}/trajectory`): owner-scoped (mirror
  `get_run_graph`'s `current_user` dependency + the run-ownership check); return the `run` header +
  `rows` (one per `agent_invocations` row for the run: join the node for `role_name`+`kind`, the
  cost row for `cost`, the manifest column; order by `started_at` ASC) exactly per the contract.
- Leave `_cost_to_dict` and the existing `/api/runs/{id}` + `/api/costs` cost serialization
  byte-unchanged (the trajectory endpoint serializes cost itself).

---

## Acceptance / evidence (run it ALL yourself, debug to green, echo each into the chat)
- **REPRODUCE-FIRST (the headline fix):** BEFORE the fix, add a regression that drives a forced
  multi-round run (`TVASHTR_FORCE_REVISIONS=1` so a worker node runs iteration 1 AND 2) and asserts
  `run_events` holds events from BOTH invocations (≥2 distinct `invocation_id`s for that node).
  CONFIRM it FAILS on the pre-fix code (round-2 events dropped by the `(run_id, seq)` collision) —
  paste the RED output — THEN apply the fix and show it green.
- **Cost link:** a test asserting each cost row carries the right `invocation_id` (agent + thinker
  + the PM entry, whose old `{run_id}:pm-llm` key omits node/iter) and that `/graph` + `/trajectory`
  return the right per-invocation `cost`.
- **Endpoint shapes:** tests asserting (a) `/graph` worker invocations carry non-null
  `context_manifest` + `cost`; (b) `/spike/run-events/{id}` events carry
  `invocation_id`+`node_id`+`iteration`; (c) `/runs/{id}/trajectory` returns one row per invocation
  ordered by `started_at`, with the joined cost+manifest, owner-scoped (a non-owner gets 403/404).
- `make test` all green (re-baseline the floor from a fresh run first; report old→new count).
  `make lint` clean.
- Drive the offline multi-round review-loop smoke (the Makefile's offline loop target) to confirm
  the executor threading doesn't break a real walk; then echo a sample `/trajectory` JSON body.
- **Invariants as evidence:** `git diff --name-only main` shows ONLY backend files + the migration
  + the freeze hook (NO `frontend/` file). `git diff main -- backend/tvashtr/control_plane/graph_validity.py` is EMPTY. No new outcome label / edge type (the routing tests pass unchanged).
- Commit on branch `feat/m-ledger-c5-backend`; commit only your own changed paths (leave the living
  docs + `prompts/*.md` untracked). End with `READY_TO_MERGE`.

## Stop conditions
Write `NEEDS_HUMAN` to `STATE.md` and stop on an external blocker (missing dep, infra down) or if a
SECOND, unknown problem would need a broad/unproven change. A code-proven, contained,
regression-guarded fix inside this scope → proceed. Hard cap: 40 turns.
