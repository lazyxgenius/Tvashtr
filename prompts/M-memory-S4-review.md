# M-memory S4 — the memory WRITE-CONTROL surface

**Slice:** S4 of M-memory (a node's persistent, cross-run agentic memory). Builds on merged
S1 / S1b / S2 / S3 (`main` @ `f555c07`, alembic head `0026`). **BACKEND-ONLY — every FE surface is
S5.** Ratified design: Tvashtr-60 (PROJECTPLAN §17).

## Why this slice exists
S2 quarantines failed-run *negative* facts as `status='pending_review'` (the anti-backfire layer 3),
but there is currently **no way for a human to act on them** — the quarantine is a dead-end. S4
un-dead-ends it (promote / reject), adds an opt-in review-before-persist mode, and adds a deliberate
agent-remember capture. All three reuse S2's existing Consolidate machinery.

## Outcome — three capabilities, all owner-scoped
1. **promote / reject / (existing) delete** of memory rows.
2. A **per-owner review-before-persist mode** (default OFF).
3. A **deliberate agent-remember capture** (a node saves a fact mid-run).

---

## Part 1 — promote / reject / delete
- **`reject(owner, id)`**: a `pending_review` OR `active` row → `status='rejected'` +
  `invalid_at=now()`. This is a **TOMBSTONE, not a delete** — it suppresses re-proposal (see the
  Consolidate change below). Owner-scoped; return `None`→404 otherwise.
- **`promote(owner, id)`**: a `pending_review` OR `rejected` row → `active` **VIA Consolidate**, never
  a blind status flip. Re-run S2's consolidation treating the promoted row as a fresh candidate vs the
  current `active` in-scope facts:
  - same-sign duplicate (cosine ≥ `DUP_THRESHOLD`) already active → **confirm** the existing one (bump
    `confirmation_count`); do NOT create a duplicate (retire the promoted row as merged);
  - opposite-sign vs an active fact → **supersede** that active fact (`invalid_at` + `superseded_by` +
    `status='superseded'`) and activate the promoted row;
  - else → `status='active'`, `invalid_at=NULL`.
  Owner-scoped; `None`→404 otherwise.
- **`delete`** (existing `delete_memory`): UNCHANGED hard delete (true removal / privacy).
- **Endpoints:** `POST /api/memories/{id}/promote`, `POST /api/memories/{id}/reject` — owner-scoped,
  mirroring the existing `/api/memories` router + its pin sub-path pattern.
- **List for the FE:** extend `list_memories` so S5 can fetch `pending_review` + `rejected` rows (a
  status filter / include flag) WITHOUT breaking the existing active-only default.

## Part 2 — review-before-persist mode (per-owner, default OFF) — THE ONE MIGRATION
- New per-owner setting **`memory_review_mode`** (Boolean, NOT NULL, `server_default` false) on the
  `users` table, via a **NEW migration `0027`** (reversible, metadata-only). **Bump the freeze regex
  `2[0-6]`→`2[0-7]` as the LAST step.**
- **OFF (default):** unchanged — only failed-run negatives are quarantined (S2 layer 3); everything
  else lands `active`.
- **ON:** every write that would otherwise reach `active` lands `pending_review` instead — the S2
  auto-distilled positive/neutral/success facts AND the agent-remember captures (Part 3). Any
  supersession of an existing active fact is **DEFERRED** (the candidate lands `pending_review`; the
  deferred supersede is performed when it is later promoted — Part 1's promote already does this).
  Nothing reaches `active` without an explicit promote. The corroboration auto-promote (S2) is also
  suppressed under review mode (the corroborated row stays `pending_review`).
- Read the setting at run-end distillation (the S2 hook) AND in the agent-remember write path — both
  owner-scoped by the run's owner.

## Part 3 — agent-remember capture
**Semantics (FIRM):** a DELIBERATE capture → routes through the SAME Consolidate path as S2, landing
`status='active'` immediately — it **BYPASSES the failed-run triage (layer 1) + quarantine (layer 3)**
because a deliberate capture is trusted — UNLESS review mode is ON → `pending_review`. Default tier =
**repo** (the owner + the run's `repo_key`); the agent does NOT choose the tier. The agent supplies
`content` (required) + an optional `polarity` (one of the 6, default `context`). Respects the
tombstone-suppression + dedup (below). **Cap** deliberate captures per run to a small N (e.g. 5) to
prevent flooding.

**Channel — PREFER the clean, zero-repo-trace path; fall back only if forced:**
- **PRIMARY — a live internal "remember" tool** the node calls mid-run, executed HOST-side by the
  control plane (the Letta-canonical shape). Inject an internal MCP server into every run's
  `mcp_config` inside `node_tools.build_mcp_config` — which ALREADY has `run_id` and resolves the
  owner, so **NO signature change is needed**; the server resolves owner + `repo_key` from `run_id`.
  Reach it from the sandbox at `host.docker.internal:<control-plane-port>` (docker) / `localhost`
  (local adapter) — the same host-reach the LLM proxy already uses — authenticated by the `run_id`
  (+ a token) in the request header. The tool → Consolidate. **Zero repo trace.**
- **FALLBACK — only if the sandbox cannot reach the control plane:** a workspace capture file
  `.tvashtr/remember.jsonl` the agent appends via its EXISTING `FileEditorTool` (so NO `engines/`
  change); the S2 run-end hook reads it from the host-mounted worktree **before sandbox teardown** and
  routes each line through Consolidate (skip malformed lines). You MUST exclude `.tvashtr/` from the
  run-diff (`run_diff.py`) AND the ship/commit step so it never pollutes the reviewed diff.
- **Verify which channel actually works in the live gate; report which you used.**

## Consolidate change (shared by S2 distill, promote, and agent-remember)
Extend S2's consolidation so a new **same-sign** candidate matching (cosine ≥ `DUP_THRESHOLD`) a
`rejected` **tombstone** in scope is **DROPPED** (not re-proposed). This is what makes reject "stick"
(prevents the "you suggested this on Monday" re-proposal loop). Do NOT change S3 injection — it is
already `status='active'`-only, so a `rejected`/`pending_review` row is never injected; leave
`memory_retrieval.py` + `compile_context`'s memory rendering byte-identical.

---

## Invariants / do-not-touch (express AS evidence where possible)
- **S3 injection (`memory_retrieval.py`) + `compile_context`'s memory rendering: BYTE-IDENTICAL** — a
  `git diff main` on these must be empty. S4 changes only the WRITE side + reads for the FE.
- The executor's core run loop is **NOT restructured.** With the PRIMARY channel the internal-server
  injection lives in `node_tools`; the adapters' `Agent(...)` construction is UNCHANGED (no `engines/`
  touch). With the FALLBACK the agent uses its existing `FileEditorTool` (still no `Agent(...)` change)
  + `context_compiler` injects the capture protocol.
- Migrations `0001`-`0026` are FROZEN (the hook enforces it). Create the NEW `0027` only; bump the
  freeze LAST.
- Existing `memory.py` CRUD signatures + `/api/memories` behavior stay backward-compatible (extend,
  don't break).

## Acceptance / evidence (YOU run ALL of it, debug to green, echo each piece)
- **`make test`** (backend) green — new tests are MUTATION-REAL: promote-runs-consolidate (incl. a
  real supersede case that retires the contradicted active fact + a dup case that does NOT duplicate);
  reject-tombstones-and-suppresses-re-proposal (a re-distill of the same same-sign fact is DROPPED);
  review-mode-ON routes an otherwise-active fact to `pending_review` + defers the supersede;
  review-mode-OFF unchanged; the agent-remember write lands active/repo/optional-polarity (and pending
  under review mode).
- **`make lint`** clean; **`make build-frontend`** + **`make test-frontend`** green (S4 is
  backend-only — prove NO FE regression; vitest floor 296).
- **Migration:** `alembic upgrade head` reaches `0027`; `alembic downgrade -1` then `upgrade head`
  round-trips clean.
- **A NEW live gate `make memory-review-gate`** (model it on `memory-distill-gate`; LOCAL sandbox +
  the `.env` keys; NOT in `make test`) that on a REAL run, end-to-end: (a) an agent deliberately
  remembers a fact → it lands active/repo (via the verified channel); (b) with review mode ON, a
  distilled fact lands `pending_review`; (c) promote it → active (and a contradicting case retires the
  old active fact); (d) reject a pending fact → tombstone, and a re-distill of the same fact is
  suppressed. Echo each step's DB state.
- Report the branch + `READY_TO_MERGE` + **which agent-remember channel was used**.

## Stop conditions
- A SECOND / unknown problem needing a broad or unproven change → write `NEEDS_HUMAN` to `STATE.md` +
  stop.
- If the PRIMARY channel (live internal tool) can't reach the control plane after a bounded attempt,
  use the FALLBACK (workspace file). That is a KNOWN, contained pivot — **proceed, don't stop** — and
  note it in the report.
- Hard turn cap per `CLI-RULES.md`.
