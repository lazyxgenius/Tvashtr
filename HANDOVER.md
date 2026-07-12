# HANDOVER — Tvashtr (architect chat) → Tvashtr-60

**You are Tvashtr-60.** Read this file and `PROJECTPLAN.md` at the project root FIRST (PROJECTPLAN is
large — copy it to the container, `grep -nE '^#{2,3} '` for the section index, then `sed -n 'X,Yp'`
targeted reads; never load it whole). Don't start work until you've read both. State your chat name
in your opening message.

---

## 0. WHERE WE ARE (as of the close of Tvashtr-59)

- `main` @ **`f555c07`**, alembic head **`0026`**, test floors **597 backend / 296 vitest**, lint clean,
  working tree otherwise clean (only the usual uncommitted `PROJECTPLAN.md` / `HANDOVER.md` doc edits +
  any untracked `prompts/*.md` briefs — see §6 closeout).
- Postgres is the **pgvector image** (`pgvector/pgvector:pg16`) on host **:5433**, database `tvashtr`,
  at head `0026`. `.env` holds the operator's provider keys: **OpenAI** (the only one doing embeddings —
  `text-embedding-3-small`, dim 1536), **xAI**, **DeepSeek**. Agent model `deepseek/deepseek-chat`.
- **M-memory** (the third legibility layer — a node's agent-facing cross-run recall) is **4 of ~6 slices
  merged**: S1 (substrate) + S1b (polarity) + S2 (anti-backfire distillation = the WRITE) + S3
  (injection = the READ). **Remaining: S4 + S5** (see §3).

## 1. WHAT M-MEMORY IS + THE RATIFIED DESIGN (Tvashtr-58 §17; carry forward verbatim)

A node's persistent, cross-run memory. Six ratified decisions:
- **D1 — three tiers**, encoded by which scoping columns are set on `node_memories`: **account** `(owner)`
  = `repo_key` NULL + `node_id` NULL; **repo** `(owner,repo)` = `repo_key` set + `node_id` NULL;
  **node** `(owner,repo,node)` = both set. `repo_key` = the run's `repo_path` string (single-operator).
  `node_id` = the AUTHORED origin node (a PLAIN uuid, NOT an FK — matches `cloned_from_node_id`, because
  authored nodes are deletable/re-addable so a dangling value must simply match nothing). Invalid combo
  (`repo_key` NULL + `node_id` set) → 422.
- **D2 — auto-distill at run-end** via Extract→Consolidate (never silent), + an agent-remember tool +
  a review mode. (S2 shipped the run-end distillation; the agent-remember tool + review-MODE are still
  open — S4 owns the human-facing review/promote surface.)
- **D3 — read = hot (pinned) + cold (pgvector top-K)** injected via `compile_context`. (S3 shipped this.)
- **D4 — bi-temporal supersede-not-delete** + event-driven invalidation + `confirmation_count`.
- **D5 — new `node_memories` table, pgvector, NO graph DB.**
- **D6 — three FE surfaces**: a memory drawer, a run-inspector tab, an account shelf. (S5 — not built.)

**Polarity taxonomy (S1b — 6 values, RFC-2119).** Every memory row carries one `polarity` (a CHECK
constraint restricts the DB to these): `require` (MUST) · `prefer` (SHOULD) · `allow` (MAY, mostly
user-authored exceptions) · `context` (neutral fact — the DEFAULT) · `avoid` (SHOULD NOT) · `forbid`
(MUST NOT). S2 captures it; S3 renders it grouped into CAPS force-sections.

**The 5 anti-backfire layers (S2 — the operator's key concern: a genuine failure must NOT mark
everything "don't-do").** All ride S1's existing columns — NO schema beyond `polarity`:
1. **Failure-cause TRIAGE** — an environmental terminal (over_budget/over_context/rate-limit/infra/engine
   error/cancelled) writes ZERO negatives; the SAFE DEFAULT for an unexplained failure is
   "environmental" (no negatives). Only genuinely agent-attributable failures (reviewer rejection, a
   failing test/build in the trail) may yield negatives.
2. **Evidence-required** — every `avoid`/`forbid` must cite a concrete failure signal or is dropped.
3. **Failed runs PROPOSE, don't IMPOSE** — a negative from a non-success run is written
   `status='pending_review'` (quarantined from S3's active-only injection) until a 2nd run corroborates
   (auto-promote) OR the user confirms. Success/positive/neutral facts go `active` immediately.
4. **Fact cap** — ≤5 facts/run, strongest-force first.
5. **Self-correction** — a later success that contradicts an active `avoid` supersedes it.

## 2. AS-BUILT — S1/S1b/S2/S3 (the code S4/S5 build against)

**Table `node_memories`** (S1, migration `0025`; S1b `0026` added `polarity`): `id, owner_id (FK users),
repo_key (nullable), node_id (nullable plain uuid), content, polarity (default 'context', CHECK on the
6), embedding vector(1536) (nullable), valid_from, invalid_at (nullable), superseded_by (nullable uuid),
confirmation_count (default 1), source_run_id (nullable), source_invocation_id (nullable), pinned
(default false), status ('active'|'superseded'|'pending_review', default 'active'), created_at,
updated_at`. HNSW cosine index on embedding.

**S1 — `control_plane/memory.py`**: tier derivation (`memory_tier`/`is_valid_tier`), owner-scoped CRUD
(`create_memory`/`list_memories`/`get_owned_memory`/`update_memory`/`set_pinned`/`delete_memory`),
`_embed_content` (manual path → gateway `embed`, `api_key=None` → `.env`, metered OFF-ledger
`workflow_id=None`), `_to_dict`. Endpoints `/api/memories` (POST/GET/PATCH/DELETE + pin). S1b added the
`MemoryPolarity` Literal + `is_valid_polarity` + `InvalidPolarityError`→422; create/update validate
polarity BEFORE embed; a polarity-only PATCH never re-embeds.

**S2 — `control_plane/memory_distill.py`** (NEW; `memory.py` imported not modified). `distill_run(run_id)`
= load run → `classify_terminal` (layer 1) → `_assemble_run_trail` (REUSES `run_explain.build_system_
prompt` read-only, per executed node, bounded) → `_fetch_in_scope` → distiller LLM
(`_run_distiller`, model = new setting `memory_distiller_model` default `openai/gpt-4o-mini`, metered
ON-run with the owner's key via `resolve_owner_api_key`) → `_gate` (layers 1/2/4) → `_consolidate_and_
write`. **Consolidation is CODE-authoritative by embedding cosine** (`DUP_THRESHOLD=0.85`; the LLM's op
is advisory): same-sign→confirm (+ promote a corroborated pending fact from a DIFFERENT run to active);
opposite-sign vs an ACTIVE fact→supersede (`invalid_at`+`superseded_by`+`status='superseded'`) + add;
else→add. **Best-effort** (per-fact sessions; the DBOS step swallows all). `list_run_memories` backs the
endpoint. Wired in `team_run.py::run_graph` **ship arm** after `finalize_run_step` as
`@DBOS.step distill_run_memory_step` (lazy-imports the module; never touches the run's terminal status).
`GET /api/runs/{run_id}/memories` (routers.py, owner-scoped) returns this run's `active`+`pending_review`
facts. Constants: `FACT_CAP=5`, `DUP_THRESHOLD=0.85`, `MAX_EXISTING_FACTS=40`, `MAX_TRAIL_NODES=6`,
`MAX_TRAIL_CHARS=24000`. **Defect fixes already in** (from adversarial review): bare status `rejected`
is NOT an agent marker (human-gate reject ≠ agent fault); corroboration requires same-sign (a neutral
can't promote a quarantined negative).

**S3 — `control_plane/memory_retrieval.py`** (NEW). `retrieve_for_node(owner, repo_key,
authored_node_id, query, *, embed_query, k=8, token_budget=2000)`: scope = owner's `status='active'` rows
in account ∪ repo ∪ node tiers (`_scope_filter`; greenfield repo_key NULL → account only); HOT = all
pinned in-scope (always); COLD = pgvector `cosine_distance` top-K over non-pinned+embedded, ranked to the
query; `_apply_budget` keeps HOT + best COLD under the budget (drop lowest-similarity COLD, never HOT).
**Best-effort** (`try/except → []`). A `has_cold` probe means `embed_query` (injected) is called ONLY
when cold candidates exist → empty scope + greenfield + the offline suite are network-free +
byte-identical. `embed_query_metered` = the run-path closure (owner key, metered ON-run). `memory_query`
= idea + node_prompt + PRD-title (pure). Wired in `team_run.py::run_graph` **node-execution arm** as
`@DBOS.step retrieve_memory_step` (resolves owner/repo_path/`cloned_from_node_id`; lazy owner-key embed
closure), threaded into `agent_run_step` → `compile_context(memory=…)`. `context_compiler.compile_
context` gained an optional `memory=` param → a rendered memory ContextPart AFTER `node_prompt` (only
non-empty polarity sections, order MUST/MUST NOT/SHOULD/SHOULD NOT/MAY/CONTEXT); `manifest()` records the
injected ids+polarity under a `memory` key in the invocation's existing `context_manifest` JSONB (NO
migration — **S5 reads this key**). None/empty ⇒ byte-identical to pre-S3. Constants `COLD_TOP_K=8`,
`MEMORY_TOKEN_BUDGET=2000`.

Live gates (both LOCAL sandbox + deepseek + gpt-4o-mini/openai, NO docker, NOT in `make test`):
`make memory-distill-gate` (S2), `make memory-injection-check` (S3), plus `make memory-smoke` (S1).

## 3. IMMEDIATE NEXT STEPS (in order)

1. **S4 — human confirm/promote surface + the review MODE (D2).** The place a user reviews the
   quarantined `pending_review` negatives from failed runs and promotes/rejects them, plus (D2) the
   agent-remember tool and a review-before-persist toggle. Backend-first (endpoints:
   promote a pending fact → active; reject → delete/supersede; maybe a review-mode setting), then its FE
   likely folds into S5. **Design this first (one question at a time, vision-grounded, pair each decision
   with its UX consequence) and get sign-off before writing the `/goal`.**
2. **S5 — the three FE surfaces (D6):** the memory drawer, the run-inspector "what this run taught / what
   this node remembered" tab (reads `GET /api/runs/{id}/memories` + `context_manifest.memory` — both
   already exist), the account shelf. Editable/deletable/pinnable per D4/D6.
3. **Mv gate** — a NON-founder shipping real value on their own repo remains the real value gate; no
   amount of shipping resolves it. Keep it visible.

Cadence question for S4/S5: S4 is smaller (backend + a bit of FE); S5 is FE-heavy. Could be one combined
slice or S4-then-S5. Decide from the vision, not effort.

## 4. STANDING OPERATOR DIRECTIVES (the operating contract — inherit ALL of this)

**Role.** You are ARCHITECT/PLANNER ONLY. ALL implementation goes through **Claude Code (CC)** via a
`/goal`. Architect-direct edits allowed ONLY: the two living docs (`PROJECTPLAN.md`, `HANDOVER.md`),
`prompts/*.md` briefs, trivial doc/typo fixes, and **mechanical merge-conflict resolution** (a union of
two already-authored changes — resolve directly, e.g. via `Filesystem:edit_file`). No "diagnostics are
architect-direct" carve-out — diagnose yourself, but the FIX goes through a `/goal`.

**The disk audit is the control point — NEVER rubber-stamp CC's report.** There is no git CLI in the
MCP: reconstruct git state from `.git` plumbing (`refs/heads/<b>`, `logs/refs/heads/<b>`, `config` for
no-remote) and byte-verify via the git object walk. **The object-walk method (this session's tool):**
copy loose objects from `.git/objects/<2>/<38>` with `Filesystem:copy_file_user_to_claude` → inflate in
the container (`/mnt/user-data/gitwalk/inflate.py`, or `python3 -c "zlib.decompress"`, strip the
`blob/tree/commit <len>\0` header) → diff trees top-down to get the exact changed-file set + confirm
byte-invariants (identical blob sha ⇒ byte-identical) + descend to read new files. Worktree dirs
(siblings) are OUTSIDE Filesystem scope, but their committed objects live in the SHARED `.git/objects`,
so the object-walk audits worktree branches too, pre-merge.

**Every CC launch = 3 fully-copyable blocks, EVERY time (even if unchanged):** (1) the shell
`cd <dir> && claude --dangerously-skip-permissions`; (2) the FULL init prompt verbatim; (3) the FULL
`/goal` verbatim. Never say "same as before" or point at a file for the init/goal text. The DETAILED
brief lives in `prompts/*.md` (referenced BY the `/goal`); the init + `/goal` are always inline.

**Init prompt must tell CC:** read `prompts/CLI-RULES.md` + `prompts/CLI-SETUP.md` + `HANDOVER.md`;
bypass = only PreToolUse hooks fire (the no-push + migration-freeze guards); don't push / don't checkout
main; run `make setup` + bring up its DB + migrate; run ALL verification (`make test`/`lint`/`build-
frontend`/`test-frontend` + the live gate) and debug to green — never hand verification back; use
ultracode/dynamic-workflows/superpowers; echo evidence; after a ≤5-line summary STOP + WAIT for the
`/goal`; end with a FINAL REPORT (CLI-RULES §4.7). `/goal` ≤4000 chars, lean, points at the brief; scope
= one full bounded milestone. Bug-fix `/goals`: reproduce-first (a failing regression proven on current
code). Stop clauses: distinguish "a second/unknown problem needing a broad/unproven change → STATE.md +
stop" from "a code-proven, contained, regression-guarded fix → may proceed."

**Guardrails (survive bypass — they're PreToolUse hooks):** `.claude/hooks/protect-no-push.sh` (blocks
`git push` / `git reset --hard`; a structural shell-token matcher — intact) and
`.claude/hooks/protect-migrations.sh` (blocks Edit/Write to frozen migrations — regex currently
`00(0[1-9]|1[0-9]|2[0-6])` = 0001-0026). Never edit a frozen migration; create a NEW one, and only then
bump the freeze regex as the LAST step of that slice.

**Merge discipline.** FF-only, operator-runs, give ALL commands as copyable text (cd, checkout main,
`merge --ff-only <b>`, `log --oneline -N`, `branch -d <b>`), state the expected tip sha + the "stop if
FF refused" note. **Parallel batches** = two DIFFERENT features, each its own git worktree + its own
Postgres **database** (`tvashtr_sN`) on the shared pgvector container + its own ports (slot 1 = backend
`:8001`/Vite `:5174`, slot 2 = `:8002`/`:5175`), ≤1 migration across the batch. Merge protocol: FF the
first branch; **cherry-pick** the second onto main (resolve the union in the MAIN checkout, which IS in
Filesystem scope), `git add` + `GIT_EDITOR=true git cherry-pick --continue`, `make test` green on the
merged main, then `git worktree remove` + `git branch -d` (first) / `-D` (cherry-picked second, its SHA
isn't in history) + optionally `dropdb`.

**Design decisions.** Decide from (a) the §1 vision + (b) the Tvashtr-25 pivot (blank prompt-driven
agents; the user authors their own team), NEVER from effort. One design question at a time, decide
directly (no option menus except genuine strategic forks), get explicit sign-off before the next. **Pair
every decision with its concrete user-facing UX consequence on the canvas/UI — every time.**

**Comms.** The operator is TERSE: "go"/"proceed"/"merged"/"done" = ratify + advance; "By the way" = a
short answer. Give multi-step PROCEDURES ONE STEP AT A TIME (they run it, report, then the next) —
especially apt for conflict-prone merges. Simple plain language. Analogies help. Always hand over
copyable artifacts; never make them scroll back / reconstruct. Handover PROACTIVELY as context fills
(the operator saying "handover" = an immediate trigger).

**Tools.** `Filesystem:*` = the OPERATOR's disk (`/Users/adimac/Desktop/Tvashtr`, capital T
load-bearing). `bash_tool`/`str_replace`/`create_file`/`view` = Claude's CONTAINER only (never the
operator disk). `Filesystem:edit_file` uses exact substring match — `dryRun:true` first; anchor on the
conflict block (tab-free lines) not huge recipe lines. `Filesystem:write_file` for full rewrites (but
NOT the Makefile — its recipes are TAB-indented; edit surgically instead). PROJECTPLAN.md is large — copy
to container, grep sections, sed ranges; §17 is append-only.

**Two chat sequences (standing):** "Tvashtr-X" (main build) + "Tvashtr Sidechat-X" (open-ended
Q&A/planning; NOT part of the `/goal` build loop). Both share project memory. State which + the number
on opening from the operator's message.

## 5. GOTCHAS (this session, not already above)

- **`createdb` collation mismatch** on the pgvector container (template stamped 2.41, OS provides 2.36 →
  `template database "template1" has a collation version mismatch`). Fix (safe — empty template):
  `docker compose exec postgres psql -U tvashtr -d postgres -c "ALTER DATABASE template1 REFRESH
  COLLATION VERSION;"` (+ same for `postgres`), then `createdb` works. New DBs created after are
  internally consistent.
- **Parallel-batch overlap this batch:** the ONLY shared code file was `team_run.py` (S2 = ship arm, S3 =
  node-exec arm — the union AUTO-MERGED cleanly). The Makefile also conflicted (both added a `.PHONY`
  target + re-added S1's `memory-smoke`) — a trivial union resolved in main. Map overlap before writing
  parallel `/goals`, but overlap is not forbidden (resolve at merge).
- **Filesystem MCP was intermittently unresponsive** this session (4-min timeouts on copy/read, ~every
  1-2 calls at worst; a full Cmd+Q + reopen of Claude Desktop cleared it, single reads are most
  reliable). If it wedges: tell the operator to fully quit + reopen Desktop, then resume; batch reads
  where possible; the object-walk copies are the risky calls.
- **CC's commit trailer** is `Co-Authored-By: Claude Opus 4.8 (1M context)` — harmless, in the message.
- Both S2 and S3 ran 5-agent adversarial reviews and found+fixed REAL defects with regression tests
  before reporting — a good signal, but the disk audit still verified the high-stakes items independently.

## 6. DOCS CLOSEOUT (do at the end of THIS handover)

`PROJECTPLAN.md` §17 has the S1b/S2/S3 as-built entry + the header date is bumped (done this session).
The untracked `prompts/M-memory-S1b-polarity.md`, `prompts/M-memory-S2-distillation.md`,
`prompts/M-memory-S3-injection.md` briefs + the doc edits get committed by the OPERATOR with the command
the architect provides (there's no git CLI in the MCP). These don't affect anything already merged.
