# Brief — Parallel batch, Session A: node-capability drawer fields (3 features)

**Type:** one `/goal`, three additive node-capability features, all authored in the node config
drawer. **ZERO migration** (alembic head STAYS `0030`). Runs in parallel with Session B — see
"Parallel-batch rules" at the bottom.

## The through-line invariant (applies to ALL three features)

Every new per-node setting lives in **`AgentNode.config` (JSONB)** — NOT a new column. Two reasons:
(1) no migration; (2) `control_plane/teams.py::clone_team_graph` already `deepcopy`s `config` onto
the run snapshot, so a config-JSONB field rides the clone **for free** — a run executes the authored
value with no clone-code change. A new *column* would need `clone_team_graph` edited + a migration;
do NOT do that.

**Follow the existing precedent EXACTLY.** The keys `memory_remember_enabled`, `writes_to`,
`reads_from` are already threaded end-to-end as optional node-config fields. Grep all three keys and
copy their wiring verbatim for the new fields:
- FE: `frontend/src/lib/api.ts::updateTeamNode` adds an **optional** param; it is put in the PATCH
  body ONLY when the caller passes it (`if (x !== undefined) body.x = x`).
- BE: the `NodeUpdate` pydantic model in `backend/tvashtr/routers.py` (the
  `PATCH /api/teams/{team_id}/nodes/{node_id}` handler) gains the field; it merges into
  `AgentNode.config[...]` ONLY when the field is in `model_fields_set` (so an omitted field leaves
  the stored value untouched — the byte-identical guard).
- **Byte-identical bar:** a node with NONE of the three set must produce a PATCH body, a clone, and
  a run byte-for-byte identical to today. Prove it with a test (the `memory_remember_enabled` tests
  are the template).

## Feature 1 — Per-node fallback model (auto-failover)

**Config key:** `config["fallback_model"]` (a model slug string; absent = no fallback).
**UX:** an optional "Fallback model" field in `panel/TeamNodePanel.tsx`, directly under the existing
model picker. Empty by default → no behaviour change. Free-text + the same `MODEL_PRESETS` datalist
the primary model field uses.
**Executor behaviour:** in the agent-LLM routing the executor does before/around invoking the
adapter (grep `agent_llm_routing` in `control_plane/team_run.py` + the `gateway/` model resolution;
the BYOK key resolves via `credentials.provider_for_model`), when the PRIMARY model's call **hard-
fails** — a provider / auth / connection error, explicitly **NOT** a 429 (the Milestone-B retry
envelope already rides those) — and `config["fallback_model"]` is set, retry that step **once** with
the fallback slug (resolve its provider + the owner's key the same way). No fallback set → behaviour
unchanged (it raises exactly as today).
**Honest scope (do not rabbit-hole):** the DOCKER agent loop makes its litellm call INSIDE the
container, so a host-side swap may only reach the seam where the host resolves/invokes the model
(the completion/thinker path + the point the host hands the model to the adapter). Implement the
swap at the **reachable host-side seam**; if the in-container agent loop cannot be failed over from
the host, scope the feature to the reachable path and **document that limitation in a code comment**
(this is the same in-container wall that scoped proactive pacing — Milestone-B). Do not patch the
in-container agent-server.
**Reproduce-first test:** force the primary provider to hard-fail at the reachable seam, assert the
`fallback_model` is used; assert that with NO fallback set the same failure still raises (RED before
the swap exists).

## Feature 2 — Per-node typed output schema + multimodal toggle

Two independent optional fields, both in `config`:
- **`config["output_schema"]`** (a JSON object; absent = none). **UX:** an "Expected output" JSON
  textarea in the drawer. **Enforcement (v1 = advisory, non-blocking):** REUSE the existing
  JSON-Schema-subset validator that M-rails C9 shipped in `control_plane/guardrails.py`
  (`output_schema_check`) — do not write a second validator. On a **completion (thinker)** node
  whose `config["output_schema"]` is set, validate the node's output against it; on a mismatch,
  record a `RunWarning` via the existing resolution/run-warning recorder (grep
  `control_plane/resolution_warnings.py`) — the run **continues** (v1 does not fail on a schema
  miss; a hard gate is a later milestone). BE validation on PATCH: reject a non-object `output_schema`
  with 422.
- **`config["multimodal"]`** (a bool; absent/false = off). **UX:** a "Multimodal" toggle in the
  drawer. **Behaviour:** thread the flag to the model call where the gateway/SDK exposes a modality
  option in a trivial way; if threading is non-trivial, STORE + SURFACE it and thread it at the one
  obvious call site only, documenting anything deeper as a follow-on. It is still bounded by the
  chosen model (a text-only model ignores it). Keep this small — the value is the authored,
  persisted, round-tripped field + the one-line thread.
**Reproduce-first test:** a completion node with an `output_schema` its output violates records a
RunWarning (RED before enforcement); the config round-trip persists + clears both fields; a node
with neither set is byte-identical.

## Feature 3 — Edit-time model validation (the "validated registry", soft)

**FE-only. No backend change.** The model field is deliberately free-text (BYOK, any provider), so
this is a **dismissible inline warning, never a block**. In `panel/TeamNodePanel.tsx`, under the
model field, show a hint when EITHER: (a) the entered slug's provider (`api.ts::providerOf`) is NOT
among the account's configured providers (`listProviders`), or (b) the slug is not a recognized
preset for its provider (`presetsForProvider`). Copy: e.g. "Unrecognised model for this provider —
it'll fail at run time if the slug is wrong or the provider key isn't set." Save is NEVER disabled;
the field stays free-text. This catches the typo-fails-30s-into-a-run case at edit time.
**Reproduce-first test:** the hint renders for an unknown slug / unconfigured provider and is absent
for a valid configured preset; save still fires with the hint showing.

## Files you will touch (expect overlap with B — see rules)
- `frontend/src/lib/api.ts` (extend `updateTeamNode` for features 1–2; feature 3 uses existing
  `providerOf`/`listProviders`/`presetsForProvider`).
- `frontend/src/panel/TeamNodePanel.tsx` (+ its test) — all three drawer fields.
- `backend/tvashtr/routers.py` — `NodeUpdate` + config-merge for `fallback_model` / `output_schema`
  / `multimodal`.
- `backend/tvashtr/control_plane/team_run.py` (+ `gateway/`) — the fallback swap at the reachable
  model-resolution seam.
- `control_plane/guardrails.py` — REUSED read-only for the schema validator (do not duplicate it).
- New backend tests under `backend/tests/`; a `Makefile` gate target if you add one.

## Gates (run them ALL yourself to green before READY_TO_MERGE)
- `make test` backend floor **≥ 904**; vitest floor **≥ 379**; `make lint` fully clean.
- Reproduce-first tests as named above (RED on pre-change code, GREEN after).
- Invariant-as-evidence: alembic head STAYS `0030` (NO migration); a node with none of the three
  fields set is byte-identical (PATCH body + clone + run); the frozen `EngineAdapter` interface
  (`engines/base.py`) is untouched — if the fallback needs any `engines/` touch, keep it minimal +
  say so in the report.
- Optional: a Playwright screenshot of the drawer showing the three new fields.
- **No docker live gate is required for this slice** — prove failover with a faked hard-fail, not a
  real provider outage. (See the reaper caution in the rules.)

## Parallel-batch rules (Session A)
- You run in your OWN worktree with your OWN DB + ports — do not touch another checkout.
- **Expect merge overlap** in `api.ts`, `routers.py`, and the `Makefile` with the other session.
  That is fine and planned — the operator resolves conflicts at merge time. Do NOT try to avoid them
  by contorting your design; write the clean version in your files.
- **Do NOT run any docker-backed live gate.** A second session is running concurrently and the boot
  container-sweep can reap a live agent container across sessions (the M-reaper history). Nothing in
  this slice needs one.
- Migration freeze is HARD: do not create migration `0031`. If a step seems to need one, STOP and
  report — the design is meant to be migration-free (config JSONB).
