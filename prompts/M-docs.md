# M-docs — per-node document routing (work products become PLURAL)

> Brief for Claude Code. The `/goal` points here. Architect: Tvashtr-66. Branch off `main` @ `998bd9f`.
> Runs in an isolated **git worktree** + its **own Postgres DB** + its **own Vite port**.
> **LOCAL sandbox only — this milestone must NEVER start a Docker agent container** (see §7).

## 0. Objective (ONE outcome)

**A node can author its OWN named document, and the user can see and steer every document a run
produced.** Concretely, this must become possible and visible end-to-end:

> **PM writes the PRD → Architect *reads the PRD* and writes the Design Doc → Engineer reads *both*.**

## 1. Why (the vision gap — §1, verbatim)

§1 promises the work products are *"PRDs, designs, specs"* — **plural**, *"real, live-editable
documents… so the user steers continuously"* (J3). **Today there is exactly one document per run.**

Traced on disk by the architect:

- `models.py` → `Run.pm_document_id` is a single nullable FK. `Document` has `id/title/doc_type/
  created_at/updated_at` — **no `run_id`, no `name`**.
- `control_plane/team_run.py` → `is_entry = current == start_id`. **Only the graph root writes**:
  its pulled `REPORT.md` → `record_entry_spec_step` → creates the one `Mini-PRD` (`doc_type="prd"`)
  and sets `Run.pm_document_id`, or appends the next version. Every other agent node **reads that
  same one document** via `read_latest_prd_step(run_id)`. A non-entry node's `REPORT.md` is pulled
  and surfaced as a work-brief but **never versioned** (D2.4).

So a user can author research → PM → architect → engineering, but **only the root can author a
document**; the Architect's design doc has nowhere to live. That is the largest remaining
composability gap, and §1 names it directly. It is also the registered §15 item **"Per-node document
routing — let a node produce/consume a *specific* named document, not just the single shared spec."**

## 2. The design (RATIFIED — implement this, do not re-open it)

### D1 — Routing rides the EXISTING `agent_nodes.config` JSONB (no second migration)
Per the Tvashtr-63 precedent (the per-node remember toggle):
- `config["writes_to"]` — **one** document name (a string), or absent.
- `config["reads_from"]` — a **list** of document names, or absent.

**Name-based, NOT id-based.** Names are authored on the **team** (a template, reused across runs);
documents are created per **run**. The executor **finds-or-creates by `(run_id, name)`**.

### D2 — Write semantics
- Node has `writes_to: "<name>"` → its pulled `REPORT.md` becomes the **next version** of the run's
  document named `<name>` (find-or-create on `(run_id, name)`).
- Node has **no** `writes_to` → **exactly today's behavior**: the **entry** node writes the default
  document; a non-entry node writes nothing.
- The **default document name is `"spec"`** (keep `title="Mini-PRD"`, `doc_type="prd"`), and
  `Run.pm_document_id` keeps pointing at it. `pm_document_id` is **not** removed — the FE PRD panel
  and `read_latest_prd_step` depend on it. It points at the run's **first-created** document.

### D3 — Read semantics
- Node has `reads_from: ["a","b"]` → its compiled context includes those documents' **latest**
  versions — **one context part per document**, so the C2 token budget can still name the fattest
  part and the C6 run-inspector context-manifest stays legible per document.
- Node has **no** `reads_from` → **exactly today's behavior**: the single `spec` part rendered
  byte-for-byte as `\n\n--- PRD ---\n{spec}` from `read_latest_prd_step`.

### D4 — Emitting nodes CANNOT author a document (a real, load-bearing boundary)
`_resolve_pull_paths` gives an **emitting** node (one with a conditional out-edge — the Reviewer) a
**verdict-only** pull (`REVIEW_VERDICT.json`). That is the Slice-4 anti-clobber invariant: it is
**why** the Reviewer can no longer overwrite the worker's edit (§17 Tvashtr-34). Its `REPORT.md` is
therefore never pulled and there is nothing to version.

**So:** `writes_to` is honored on **non-emitting** nodes only (thinkers *and* workers both pull
`REPORT.md`). On an emitting node, `writes_to` must **not** silently do nothing — record a
`RunWarning` (the existing seam that already surfaces tool/skill resolution warnings on
`GET /api/runs/{id}/graph` → `resolution_warnings`) naming the node and the reason, and skip it.
**Do NOT widen the reviewer's `pull_paths`** to "fix" this — see the fence.

*(This boundary costs the target journey nothing: PM, Architect and Engineer are all non-emitting.)*

### D5 — Migration `0028` (the batch's ONLY migration)
Additive, on `documents`:
- **`run_id`** — FK → `runs.id`, **`ondelete="CASCADE"`**, nullable, indexed. This also closes the
  registered *"orphaned PM documents on run teardown"* leak: deleting a run now reaps its documents.
- **`name`** — Text, nullable.

Nullable at the DB level so the additive migration applies to a DB with pre-existing rows. Head
becomes `0028`. **Bump the freeze hook regex `2[0-7]` → `2[0-8]` as the LAST step**, only after the
migration is final. The hook currently allows `0028` — do not touch it before then.

### D6 — The invariant that decides this milestone
**No `writes_to` / `reads_from` anywhere ⇒ every existing team behaves BYTE-IDENTICALLY.** Same
document, same versions, same compiled context string, same routing labels, same edges. Prove it
(see §5.4). Defaults are what make this milestone safe to merge.

## 3. UX — what the user actually sees (build this; it is not optional)

Without the UI the second document is invisible — built but unusable — and J3 steering dies. The
legibility half **is** the milestone.

1. **Node config drawer** gains two fields, in the existing drawer idiom:
   - **"Writes to"** — a single document-name text field, placeholder showing the default (`spec`).
   - **"Reads from"** — the document names this node reads (empty ⇒ the shared spec).
   Empty/absent by default, so an untouched team looks and behaves exactly as today. Follow the
   Tvashtr-63 precedent for conditional display and for seeding the default OFF/empty.
2. **Run view**: the single PRD panel becomes a **document picker** — one entry per document the run
   produced (by name), each opening the **existing TipTap live editor**, so J3 mid-run steering now
   works across **all** documents, not just the PRD. Reuse the existing editor + versions surface;
   do not build a second editor.

## 4. Suggested shape (you self-decompose; this is orientation, not orders)

Backend: migration `0028` → `documents/service.py` find-or-create by `(run_id, name)` →
`team_run.py` write routing (generalize `record_entry_spec_step`) + read routing →
`context_compiler.py` one part per read document → the authoring/config validation path →
the run payload exposing the run's documents → FE drawer fields → FE run-view picker →
freeze bump LAST.

## 5. Acceptance / evidence (echo EACH into the chat as it completes)

You run every check yourself and debug to green. Do **not** hand the operator commands to run.

1. `make migrate` clean; alembic head prints **`0028`**; the freeze regex bumped to `2[0-8]`
   **as the last commit**.
2. `make test` — **≥ 669** backend (state the new floor). `make test-frontend` — **≥ 365**.
   `make lint` clean. `make build-frontend` clean.
3. **Mutation-real tests, not smoke.** Including:
   - a node with `writes_to` versions **its own** named document (assert the document's name,
     `run_id`, version count and content);
   - a node with `reads_from` gets **those** documents in its compiled context (assert the manifest
     part names + that a document it does *not* read is **absent**);
   - `writes_to` on an **emitting** node records a `RunWarning` and writes nothing;
   - `documents.run_id` CASCADE actually reaps a run's documents on run delete.
4. **The D6 byte-identity proof.** A test asserting that with no `writes_to`/`reads_from` set, the
   compiled context for a node is **byte-for-byte** the pre-change string, and the entry node's
   document create/version path is unchanged. This is the merge-blocking invariant.
5. **A LIVE end-to-end proof of the objective.** Drive a real 4-node team
   **PM → Architect → Engineer** (LOCAL sandbox) where the PM writes `prd`, the Architect
   `reads_from: ["prd"]` + `writes_to: ["design"]`, the Engineer `reads_from: ["prd","design"]` —
   and assert **two distinct documents exist on the run**, each with real content, and that the
   Architect's compiled context provably contained the PM's PRD. Add it as a `make` target in the
   existing live-gate idiom (LOCAL sandbox, skips cleanly without a key). **This is the milestone's
   real proof — the unit tests alone do not prove the journey.**
6. **Playwright self-sign-off with a screenshot per check** (isolated ports — backend `:8001`,
   Vite `:5174`): the drawer's two new fields render + persist; the run view's document picker
   lists **both** documents and each opens live-editable in TipTap. Use targeted
   `browser_evaluate` on specific selectors + screenshots — **a full-page accessibility snapshot
   chokes on the React Flow canvas.**
7. Branch name + `READY_TO_MERGE` + the mandatory 8-section FINAL REPORT (CLI-RULES §4.7), once.

## 6. FENCE — explicitly OUT of scope (do NOT implement)

If you believe any of these is a real hole, **SAY SO IN THE REPORT — do not implement it.**

- **Do NOT widen the Reviewer's / any emitting node's `pull_paths`.** The verdict-only pull is the
  Slice-4 anti-clobber invariant (§17 Tvashtr-34). Making an emitting node author a document is
  registered as deferred. Leave `_resolve_pull_paths`'s emitting arm alone.
- **Do NOT** remove or repurpose `Run.pm_document_id`, and do not rename `pm_document_id` →
  `spec_document_id` (a registered §15 cosmetic rename — not this milestone).
- **Do NOT** add document **permissions**, sharing, section-level locks, or CRDT (all registered).
- **Do NOT** add a second migration. `0028` is the batch's only one. Never edit a frozen migration
  (`0001`–`0027`) — the PreToolUse hook will block you, correctly.
- **Do NOT** touch `backend/tvashtr/engines/`, the reaper / `sandbox_cache.py`, `config.py`'s
  sandbox default, or the Makefile's `brownfield-*` recipes.
- **Do NOT** add a dependency.
- **Do NOT** change routing/outcome labels or edge semantics. The authored topology is the router
  (the Tvashtr-25 pivot); documents ride it, they do not re-route it.
- **Do NOT** make a thinker route, or add doc-driven branching.
- **Do NOT** `git push` (there is no remote) and do not `git reset --hard`.

## 7. Sandbox rule (batch safety — NON-NEGOTIABLE)

A **second Claude Code session is running a LIVE Docker agent run** (M-rung2) on the same host at
the same time.

- **This milestone must run LOCAL sandbox only** (`TVASHTR_AGENT_SANDBOX=local`). Never start a
  Docker agent container; never run any `brownfield-*` / `*-docker` / `tools-e2e` / `skills-e2e`
  target.
- `make test` is **safe** to run: `main.py::_lifespan`'s boot sweep now spares any container whose
  entry is in the **host-global** registry `~/.tvashtr/live_containers.json` with a live pid
  (M-reaper + M-reaper-S2, `998bd9f`). **Do not** touch that registry, its path, or the sweep.
- If you ever find yourself about to run `docker`, **STOP** — you would kill the other session's
  live run.

## 8. Stop conditions

- **A code-proven, contained, regression-guarded fix → you MAY proceed.**
- **A second/unknown problem needing a broad or unproven change → STOP**, write `NEEDS_HUMAN` to
  `STATE.md` with the diagnosis, and report. Do not improvise a broad fix.
- **If the D6 byte-identity invariant cannot be held, STOP and report** — do not "mostly" hold it.
- Hard turn cap: **80**.

## 9. Notes

- `prompts/CLI-RULES.md` **§2 is STALE** — it claims alembic head `0014`; the real head is `0027`
  (`0028` after this milestone). Ignore that claim. §3.11's "hard walls" claim is also stale.
- Commit only your own changed paths. Leave `prompts/*.md`, `PROJECTPLAN.md`, `HANDOVER.md`,
  `design/` and the untracked deep-dive `.md` files alone — the architect owns those.
- `.env` contains live secrets. **Never echo a key value** into the chat, a log, or a commit.
