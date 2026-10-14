# M-memory S5a — the account Memory shelf (FE + one thin endpoint)

**Milestone.** The last M-memory slice is S5 — the 3 FE surfaces that make the memory the backend has been quietly building since S2 VISIBLE and controllable. S5 is split into **S5a (this brief) = the account Memory shelf** (the central management home), then **S5b = the two scoped views** (run-inspector Memory tab + per-node drawer Memory section). This brief is S5a only.

**Everything the shelf needs already exists on the backend** (M-memory S1–S4, `main` @ `ac67bef`, head `0027`): the owner-scoped `node_memories` store, the three-tier model, polarity, and the full endpoint set — EXCEPT one thing (the review-mode toggle endpoint) which this slice adds.

---

## Outcome
A **Memory shelf on the Dashboard** — the owner's central place to see, prune, pin, and author memories across all tiers, plus the review-mode control. Mounts as the 4th shelf after Providers / Secrets / Tools / Skills. This slice also builds the **shared fact-chip component** that S5b reuses.

---

## Ground yourself first (read these before writing code)
- `frontend/src/components/Dashboard.tsx` — mount the new shelf right after `<SkillsShelf />` (~line 422). Study the `tv-dash__panel` / `tv-dash__prov` shelf pattern.
- `frontend/src/components/ToolsShelf.tsx` — the model to MIRROR: a self-fetching `tv-dash__panel` section (fetch on mount → list of chips → add/edit form → delete → reload → error handling). Copy this shape.
- `frontend/src/lib/api.ts` — there is currently ZERO memory wiring here; every client fn below is new. Follow the `listToolLibrary` / `createToolLibraryItem` / `listSecrets` shapes.
- `backend/tvashtr/routers.py` — the existing memory endpoints live under the `# ---- Agentic memory (M-memory S1) ----` header (~line 1484): `POST /api/memories`, `GET /api/memories` (filters `repo_key`, `node_id`, `status`, `include_superseded`), `PATCH /api/memories/{id}`, `DELETE /api/memories/{id}`, `POST /api/memories/{id}/pin`|`/unpin`|`/promote`|`/reject`, and `GET /api/runs/{id}/memories`. Study `list_providers` / the provider endpoints as the pattern for the ONE new endpoint.
- `backend/tvashtr/models.py` — `NodeMemory` (tier encoding: repo_key null + node_id null = ACCOUNT; repo_key set + node_id null = REPO; both set = NODE) and its row fields. `User.memory_review_mode` (bool, already exists via mig 0027).
- The **frontend-design** skill — for the polarity-badge palette + chip styling. Reuse the `.tv-*` vocabulary; NO new rules in `index.css` (panel/dash CSS files only).

---

## What to build

### 1. The one backend endpoint (the only backend change)
`GET /api/memory/review-mode` → `{ "review_mode": bool }` and `PATCH /api/memory/review-mode` (body `{ "review_mode": bool }`) — reads/writes `users.memory_review_mode` for the current owner. Owner-scoped, mirroring the provider endpoints. **Distinct path** (`/api/memory/...`, singular) so it never collides with `/api/memories/{id}`. Add mutation-real backend tests (assert the column flips + the GET reflects the new value; a fresh user reads `false`).

### 2. The shared fact-chip component (build clean + export — S5b reuses it)
`MemoryFact` renders ONE memory row: the **content**, a colored **polarity badge** (MUST / MUST NOT / SHOULD / SHOULD NOT / MAY / CONTEXT — map from the `polarity` value require/forbid/prefer/avoid/allow/context), a **tier tag** (Account / This repo / Per-node — shown when a list mixes tiers), a **pin** toggle, a muted **"seen N×"** (confirmation_count) and **provenance** (source run + when). Action variants: **manage** (pin / edit-inline / delete-with-confirm), **pending** (Confirm / Discard), **archived** (read-only). Keep it presentational + reusable.

### 3. The shelf (`frontend/src/components/MemoryShelf.tsx`), top → bottom
1. **Header** — icon + "Memory" + one sub-line: what your agents have learned across runs; prune it, pin what matters, control how new memories are reviewed.
2. **Review-mode switch** — "Review new memories before they apply" (GET/PATCH the new endpoint). A one-line helper: OFF = memories apply automatically (only a failed run's cautions wait); ON = every new memory waits below until you confirm.
3. **Pending inbox** (rendered only when non-empty) — `GET /api/memories?status=pending_review`, each row a fact chip with **Confirm** (`/promote`) + **Discard** (`/reject`). Show a count.
4. **Add a memory** form — content + a **tier** picker (Account / This repo) + a **polarity** picker (the 6 forces) → `POST /api/memories`. For "This repo", a repo field (free-text repo path, or a select of repos the owner already has facts for) → `repo_key`. (Node-tier authoring is S5b's drawer — the shelf covers Account + Repo.)
5. **Live facts**, from ONE `GET /api/memories` (active) fetch, bucketed CLIENT-SIDE into an **Account** section (repo_key null), a **This repo** section, and **Per-node** sections (grouped by node_id). A **repo selector** governs the This-repo + Per-node sections (default: the repo with the most facts, or most-recent; an "All repos" option shows everything grouped by repo). Each fact = a `MemoryFact` in **manage** mode (pin `/pin`+`/unpin`, edit → `PATCH`, delete → `DELETE` + confirm).
6. **"Show archived"** expander — superseded + rejected rows (`?include_superseded=true` and `?status=rejected`), read-only. For audit.
7. **Empty state** — teaches the concept (agents haven't learned anything yet; as they run, useful facts about your repos appear here).

### 4. `api.ts` additions
A `NodeMemoryRow` type (id, content, polarity, repo_key, node_id, pinned, status, confirmation_count, source_run_id, valid_from, invalid_at, superseded_by, created_at — match the API rows) + fns: `listMemories({repo_key?, node_id?, status?, include_superseded?})`, `createMemory(...)`, `updateMemory(id, {content?, polarity?, pinned?})`, `deleteMemory(id)`, `pinMemory(id)`, `unpinMemory(id)`, `promoteMemory(id)`, `rejectMemory(id)`, `getReviewMode()`, `setReviewMode(bool)`.

---

## Invariants / do-not-touch (checkable on disk)
- **NO migration.** Head stays `0027`; no new file under `backend/alembic/versions/`; the freeze hook regex stays `2[0-7]`. (Evidence: `alembic heads` = 0027.)
- **The memory distillation / retrieval / injection PIPELINE is byte-unchanged** — `control_plane/memory_distill.py`, `control_plane/memory_retrieval.py`, and the memory-injection logic in `control_plane/context_compiler.py` + `control_plane/team_run.py` are untouched (this slice only READS the existing endpoints + adds the ONE review-mode endpoint). (Evidence: empty git diff on those four files.) The review-mode endpoint reads/writes the already-existing `users.memory_review_mode` column via a small additive helper — that's the ONLY memory-write-path touch.
- **`memory_remember_enabled` is NOT this slice** — do not add any remember toggle to the shelf; leave `config.py` untouched. (Remember control is a per-node switch in S5b.)
- **The other shelves + Dashboard behavior are unchanged** — the Memory shelf mounts additively; the existing Dashboard tests stay green.

---

## Acceptance / evidence — run ALL of it yourself, debug to green, echo each into the chat
- `make test` — the new review-mode endpoint tests pass; full backend suite green (≥ the 634 floor + the new tests).
- `make lint` — clean.
- `make build-frontend` + `make test-frontend` — the new MemoryShelf + fact-chip tests pass; full vitest suite green (≥ the 296 floor + the new tests).
- `make memory-review-gate` — still PASSES (proves the promote/reject backend the Pending inbox drives).
- **Playwright self-sign-off, one screenshot per check** (the Dashboard is NOT a React Flow canvas, so a normal snapshot is fine here): log in → open the Dashboard → the Memory shelf renders (with the empty state if empty); (1) add an Account-tier fact via the form → it appears with its polarity badge; (2) pin it → pin persists across a reload; (3) edit its text → persists; (4) toggle review-mode ON → the switch reflects ON and survives a reload; (5) with review-mode ON, seed/produce a pending fact → it shows in the Pending inbox with Confirm/Discard, and Confirm moves it into the live facts; (6) delete a fact → it's gone. Save a screenshot per step under the run's artifacts.
- Branch `feat/m-memory-s5a-shelf`; end with a `READY_TO_MERGE` line + the tip sha.

## Stop conditions
- A second or unknown problem that needs a BROAD or UNPROVEN change → write `NEEDS_HUMAN` to `STATE.md` (with what/why) and stop. A code-proven, contained, test-guarded fix MAY proceed.
- Hard cap: 60 turns.
