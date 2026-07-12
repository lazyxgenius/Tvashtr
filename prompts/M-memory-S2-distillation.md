# M-memory S2 — write / distillation, with the 5 anti-backfire layers (parallel batch; SLOT 1)

**Context.** M-memory is `main` @ `60bdcb7`, alembic head **`0026`** (the `polarity` column landed),
floors **549 backend / 296 vitest**. This is the WRITE half of the memory loop: at run END, a recorded
step reads the run's OWN trail + outcome and distils LABELED memory facts (tier + polarity + provenance)
— learning from BOTH successes AND failures, with five safeguards so a failed run can't poison memory.
Runs in PARALLEL with S3 (the read half) in a separate worktree; the ONLY shared file is `team_run.py`,
and you touch a DIFFERENT arm than S3 (you: the terminal/ship arm; S3: the node-execution arm).

**ZERO migration** — everything rides S1's EXISTING columns (`status` / `confirmation_count` /
`source_run_id` / `source_invocation_id` / `superseded_by` / `invalid_at` / `pinned`) + the `polarity`
column from S1b. **NO frontend (S5). Best-effort — distillation NEVER un-ships or crashes a run.** If you
think you need a column, STOP: you don't.

---

## Seams (READ these first; follow the existing patterns)

- **`control_plane/team_run.py::run_graph`** — the executor. In the **terminal/ship arm**, AFTER the
  run-finalize step, call a NEW recorded `@DBOS.step distill_run_memory_step(run_id)`. MIRROR how the
  existing terminal steps (e.g. the finalize step) are recorded. Wrap it BEST-EFFORT: any failure is
  logged + swallowed — the run is already finalized, and distillation must NOT change the run's terminal
  status. **You edit ONLY the terminal arm — NOT the node-execution arm (that is S3's).** This is the one
  file shared with S3.
- **`control_plane/run_explain.py`** — CALL its EXISTING bounded run-trail assembler (the same one that
  powers the "Ask the node" / Mode-A endpoint + the per-node work-brief) READ-ONLY, to get the run's node
  trail for the distiller. Do NOT modify `run_explain.py` (invariant: byte-identical). Find the real
  function name in the file.
- **NEW module `control_plane/memory_distill.py`** (so `memory.py` stays import-only):
  - `distill_run(run_id)`: load the run (owner_id, `repo_path` → `repo_key`, terminal status/outcome),
    assemble the bounded trail (via `run_explain`), fetch the existing in-scope memories (capped), call
    the distiller LLM, apply the anti-backfire gating (below), consolidate, and write.
  - **DISTILLER LLM** — a CHEAP NON-REASONING model via a NEW setting `memory_distiller_model` default
    **`openai/gpt-4o-mini`** (a reasoning model over-thinks a bounded extraction). Given (the run
    OUTCOME + the bounded trail + the existing in-scope facts as text), it emits a BOUNDED list of
    candidate operations, each: `{op: ADD|UPDATE|DELETE|NOOP, target_id?, content, tier:
    account|repo|node (+ which node for node-tier), polarity: one of the 6, evidence?, rationale}`.
    Prompt it for outcome-conditioned do/don't PAIRING (where a fix is evident, emit the matching
    positive) + RFC-2119 polarity. Metered **ON the run** (`workflow_id=run_id`) with the RUN OWNER's key
    (`resolve_owner_api_key`) — the "off-ledger" note in `memory.py` is the MANUAL path; the run-scoped
    distill path meters on the run.

  - **THE 5 ANTI-BACKFIRE LAYERS — apply AFTER the LLM proposes, BEFORE writing:**
    1. **FAILURE-CAUSE TRIAGE.** Classify the terminal. If ENVIRONMENTAL / not-the-agent's-fault
       (`over_budget`, `over_context`, rate-limit/provider/infra error, engine error, `cancelled`), DROP
       every `avoid`/`forbid` candidate — write ZERO negatives (neutral/positive facts may still be
       written). Only genuinely agent-attributable failures (reviewer-`rejected`, a specific test/build
       error visible in the trail) may yield negatives. This directly kills the "a genuine error marks
       everything don't-do" failure mode.
    2. **EVIDENCE-REQUIRED.** Every `avoid`/`forbid` MUST carry an `evidence` citation tied to the
       failure (a reviewer reason, the failing test, the error line). Drop any negative without it.
    3. **FAILED RUNS PROPOSE, THEY DON'T IMPOSE.** A negative (`avoid`/`forbid`) distilled from a FAILED
       run is written `status='pending_review'` (NOT active) — quarantined from S3's injection (S3 injects
       `active` only). It promotes to `active` ONLY when a 2nd run corroborates it (see consolidation) OR
       the user confirms (S4/S5). Facts from a SUCCESSFUL run — and neutral/positive facts generally —
       are written `status='active'` immediately.
    4. **FACT CAP.** Cap facts written per run to a documented constant (start **5**) — keep the
       highest-signal. A run teaches a few lessons, not fifty.
    5. **SELF-CORRECTION.** Consolidation (below) supersedes a contradicted fact — a later success that
       contradicts an earlier `avoid` supersedes it.

  - **CONSOLIDATION (Extract→Consolidate on the gated candidates):**
    - **NOOP** — a near-duplicate active fact already exists → do nothing.
    - **UPDATE/confirm** — the candidate re-affirms an existing fact → bump its `confirmation_count`; if
      that existing fact was `pending_review` and this run corroborates it → PROMOTE to `active` (this is
      how a recurring failure's negative auto-activates on its 2nd occurrence).
    - **DELETE/supersede** — the candidate CONTRADICTS an existing active fact → set the old row's
      `invalid_at=now()`, `superseded_by=<new id>`, `status='superseded'`, and ADD the new fact.
    - **ADD** — a genuinely new fact → embed the content (gateway, owner key, metered on-run), insert
      with `owner_id`, `repo_key`, `node_id` (the AUTHORED node for node-tier), `content`, `polarity`,
      `status` per layer 3, `confirmation_count=1`, `source_run_id=run_id`, `source_invocation_id` (if
      attributable to one invocation).
  - The distiller decides each fact's TIER: repo_key = the run's `repo_path` (NULL greenfield → account-
    tier only); node-tier maps the trail's node → its AUTHORED id.
  - **BEST-EFFORT throughout** — any failure (LLM/embed/DB) is caught + logged, the run's terminal status
    is untouched, and partial writes are fine (each fact write is independent).
- **NEW endpoint `GET /api/runs/{run_id}/memories`** (`routers.py`) — owner-scoped; returns the memories
  with `source_run_id` == this run (`active` + `pending_review`), each with polarity/status/content/tier.
  Backs the "this run taught N things" view. (S3 does NOT touch `routers.py`.)

---

## Invariants (verify AS on-disk evidence)

- `git diff main` is **EMPTY** for: `gateway/*`, `control_plane/context_compiler.py` (S2 does NOT touch
  the compiler — that is S3), `control_plane/run_explain.py` (called read-only, NOT modified), and
  `models.py` (rides existing columns — NO new column).
- **ZERO new migration** — head stays `0026`; every `0001`–`0026` byte-unchanged; do NOT touch the freeze
  hook.
- **Best-effort** proven: a test that forces the distiller to raise asserts the run still reaches its
  terminal status and is unaffected (no partial corruption).

## Acceptance (you run every check + debug to green; echo each)

1. Unit (offline: fake distiller LLM + fake trails + fake embed) — the anti-backfire matrix, each
   mutation-real:
   - a SUCCESSFUL run's facts land `status='active'`;
   - an ENVIRONMENTAL failure (`over_budget`/`over_context`/engine-error) writes ZERO `avoid`/`forbid`
     (layer 1) EVEN IF the fake LLM proposes negatives;
   - an agent-attributable failure (reviewer-`rejected`) writes negatives as `pending_review` (layer 3),
     each carrying evidence;
   - an `avoid`/`forbid` WITHOUT evidence is dropped (layer 2);
   - a 2nd corroborating run PROMOTES a `pending_review` negative to `active` + bumps
     `confirmation_count`;
   - a contradicting success SUPERSEDES an existing active `avoid` (`invalid_at` + `superseded_by` +
     `status='superseded'`) and adds the new fact (layer 5 / DELETE);
   - a near-duplicate → NOOP (no duplicate row);
   - the per-run fact cap holds (layer 4);
   - tier/owner correctness (repo_key from `repo_path`; node-tier → authored node; greenfield → account-
     tier only; owner-isolation);
   - distillation failure is best-effort (forced raise → run terminal unaffected).
2. `GET /api/runs/{id}/memories`: returns this run's taught facts (active + pending), owner-scoped
   (owner B → empty/404); polarity + status present.
3. A NEW live gate (scripted, LOCAL sandbox + `deepseek/deepseek-chat`, NO docker; in-process TestClient
   OR backend `:8001` / Vite `:5174`): run a `review_loop` to COMPLETION, then assert
   `GET /api/runs/{id}/memories` returns ≥1 `active` LABELED fact distilled from the real trail, AND a
   cost row exists with `workflow_id=run_id` for the distill call (metered on-run). Needs
   `DEEPSEEK_API_KEY` (run) + `OPENAI_API_KEY` (distill + embed); skips cleanly without them. Echo the
   learned facts.
4. `make test` green (the 549 floor rises); `make lint` clean; `make build-frontend` green;
   `make test-frontend` → 296 held.

## Stop conditions

- A code-proven, contained, regression-guarded fix may proceed; a second/unknown problem needing a broad
  or unproven change → `NEEDS_HUMAN` + the blocker to `STATE.md` and stop. Hard turn cap → `STATE.md` +
  stop.

## Branch + isolated environment

Branch **`m-memory-s2-distillation`**. You are in a PARALLEL worktree — set up an ISOLATED environment
and NEVER touch the main database:
- Create your OWN database on the ALREADY-RUNNING pgvector Postgres container (do NOT start a second
  Postgres): a database named **`tvashtr_s2`**. Point THIS worktree's `.env` `DATABASE_URL` at
  `tvashtr_s2` (change only the database-name segment). Then `make migrate` (creates the full schema +
  the `vector` extension in YOUR database, at head `0026`).
- You MUST verify your `DATABASE_URL` names `tvashtr_s2`, NOT the main `tvashtr`, before running anything.
- Use backend port **`:8001`** and Vite port **`:5174`** for any live/e2e target.
- Commit ONLY your own changed paths; do NOT push and do NOT checkout/merge `main`.
