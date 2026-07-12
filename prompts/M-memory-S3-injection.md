# M-memory S3 — read / injection (parallel batch with S2; SLOT 2)

**Context.** M-memory is `main` @ `60bdcb7`, alembic head **`0026`** (the `polarity` column landed), floors
**549 backend / 296 vitest**. This is the READ half of the memory loop: at run time, fold each node's
relevant remembered facts into its compiled instruction so the agent recalls prior lessons — hot
(pinned) + cold (pgvector top-K), tier-scoped, **active-only**, grouped by polarity into force-sections.
Runs in PARALLEL with S2 (the write half) in a separate worktree; the ONLY shared file is
`team_run.py`, and you touch a DIFFERENT arm than S2.

**ZERO migration. NO frontend (S5 reads what you record). Best-effort — a retrieval failure NEVER
crashes or changes a run.** If you think you need a migration or a new column, STOP: everything rides
S1's existing columns + the existing `context_manifest` JSONB.

---

## Seams (READ these first; follow the existing patterns exactly)

- **`control_plane/context_compiler.py::compile_context(...)`** — the pure assembler that builds a
  node's instruction from typed parts, with token-budget accounting (the budget check already names the
  fattest part). Add a new **optional** `memory=<retrieved facts> | None = None` parameter → a new
  `memory` ContextPart, rendered per "Rendering" below, accounted in the budget exactly like the other
  parts (a memory-part overflow names `memory`). When `memory` is None/empty → NO memory part is added
  (byte-for-byte today's output). Verify the real signature + the ContextPart shape before editing.
- **`control_plane/team_run.py::run_graph`** — the executor. In the **node-execution arm** (the
  completion/agent branch that compiles + runs a node), BEFORE compiling that node's context, call a NEW
  recorded `@DBOS.step` that returns the retrieved facts, and thread them into
  `compile_context(memory=…)`. MIRROR the existing recorded steps whose result feeds the compiler
  (e.g. the brownfield-grounding step / the latest-PRD read step). **You edit ONLY this arm — NOT the
  terminal/ship arm (that is S2's).** This is the one file shared with S2.
- **NEW module `control_plane/memory_retrieval.py`** (so `memory.py` stays import-only — do NOT modify
  the memory CRUD service):
  - `retrieve_for_node(owner_id, repo_key, authored_node_id, query, ...) -> list[fact]`.
  - **SCOPE** = the owner's `status='active'` memories in the tiers that apply to THIS node:
    **account** (`repo_key` NULL, `node_id` NULL) ∪ **repo** (`repo_key` == this run's repo_key) ∪
    **node** (`repo_key` == this run's repo_key AND `node_id` == this node's AUTHORED id). The authored
    id = the executing node's `cloned_from_node_id` (fall back to the node's own id if it is not a
    clone). A GREENFIELD run (repo_key NULL) ⇒ only account-tier applies. Owner-scoped ALWAYS.
  - **HOT** = every `pinned` row in scope — ALWAYS injected (never dropped by top-K or the budget).
  - **COLD** = pgvector **cosine top-K** over the NON-pinned in-scope rows, ranked by similarity to the
    query. K is a documented module constant (start **8**). Embed the query via the gateway with the RUN
    OWNER's key (`resolve_owner_api_key`), metered **ON the run** (`workflow_id=run_id`).
  - **BUDGET**: cap the injected total by a documented memory-token constant (start a modest slice of the
    input budget); when over, drop the LOWEST-similarity COLD facts first — NEVER drop hot.
  - Returns each fact with its `id`, `polarity`, `content` (for rendering + manifest recording).
  - The QUERY is a compact task representation available BEFORE the memory part is built (e.g. the run
    idea + this node's role/prompt + the PRD title) — NOT the compiled context (that would be circular).

## Rendering (inside compile_context's memory part)

Group the injected facts BY polarity into CAPS force-sections, only non-empty sections, in this order:
**MUST** (require) · **MUST NOT** (forbid) · **SHOULD** (prefer) · **SHOULD NOT** (avoid) · **MAY**
(allow) · **CONTEXT** (context). A one-line preamble frames it as the node's remembered lessons from
past runs. This grouped-by-force shape is the whole point of the polarity taxonomy — an agent reads a
MUST NOT list very differently from a neutral fact.

## Manifest (no migration)

Record the injected memory-ids in the invocation's EXISTING `context_manifest` JSONB: the memory part
joins the existing `parts` array as `{name: "memory", tokens: …}`, AND record the injected ids (with
their polarity) under a `memory` key on the manifest, so S5 can later show "what this node remembered."
`context_manifest` is existing JSONB — NO migration.

---

## Invariants (verify AS on-disk evidence)

- `git diff main` is **EMPTY** for: `gateway/*`, `control_plane/run_explain.py`, `models.py`,
  `routers.py` (S3 adds NO endpoint), `control_plane/memory.py` (you IMPORT it / read `NodeMemory`, you
  do NOT modify the CRUD service), and `config.py` (S3 uses documented module constants, NO new setting).
- **ZERO new migration** — head stays `0026`; every `0001`–`0026` byte-unchanged; do NOT touch the
  freeze hook.
- **Best-effort** proven: a test that forces the retrieval/embed to raise asserts the node runs with NO
  memory part and the run still completes.
- **Inert when empty** proven: with an empty in-scope memory set, a node compiles byte-for-byte as today
  (no empty memory part, no error).

## Acceptance (you run every check + debug to green; echo each)

1. Unit (offline, fake embed): `retrieve_for_node` returns the correct SCOPE (account/repo/node tiering
   incl. the `cloned_from_node_id` mapping; owner-isolation); HOT (pinned) always present; COLD ranked by
   similarity + capped at K; the budget drops COLD-not-HOT; empty scope → empty; a forced embed error →
   best-effort empty (NO raise).
2. `compile_context`: given memory facts → renders the polarity-grouped CAPS sections in the right order,
   only non-empty sections; given None/empty → NO memory part (assert byte-identical to today's output).
3. A NEW live gate (scripted, LOCAL sandbox + `deepseek/deepseek-chat`, NO docker; in-process TestClient
   OR backend `:8002` / Vite `:5175`): seed a few memories via the API for the run's owner/repo — incl. a
   `pinned` one and a node-tier one — run a `review_loop` to completion, and assert the executed node's
   `context_manifest` shows a `memory` part listing the injected ids (incl. the pinned one). Assert a cost
   row exists with `workflow_id=run_id` for the query embed (metered on-run). Needs `DEEPSEEK_API_KEY`
   (run) + `OPENAI_API_KEY` (embed); skips cleanly without them. Echo the manifest's memory ids.
4. `make test` green (the 549 floor rises); `make lint` clean; `make build-frontend` green;
   `make test-frontend` → 296 held.

## Stop conditions

- A code-proven, contained, regression-guarded fix may proceed; a second/unknown problem needing a broad
  or unproven change → `NEEDS_HUMAN` + the blocker to `STATE.md` and stop. Hard turn cap → `STATE.md` +
  stop.

## Branch + isolated environment

Branch **`m-memory-s3-injection`**. You are in a PARALLEL worktree — set up an ISOLATED environment and
NEVER touch the main database:
- Create your OWN database on the ALREADY-RUNNING pgvector Postgres container (do NOT start a second
  Postgres): a database named **`tvashtr_s3`**. Point THIS worktree's `.env` `DATABASE_URL` at
  `tvashtr_s3` (change only the database-name segment). Then `make migrate` (creates the full schema +
  the `vector` extension in YOUR database, at head `0026`).
- You MUST verify your `DATABASE_URL` names `tvashtr_s3`, NOT the main `tvashtr`, before running anything
  — running migrations/tests against the main DB would corrupt the operator's + S2's work.
- Use backend port **`:8002`** and Vite port **`:5175`** for any live/e2e target.
- Commit ONLY your own changed paths; do NOT push and do NOT checkout/merge `main`.
