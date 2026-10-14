# M-memory S5b — the two scoped Memory views (FE-only, no backend)

**Milestone.** The final M-memory FE slice: the two scoped windows onto the memory store, both **reusing S5a's exported `MemoryFact` chip + `lib/memory.ts` helpers** (do NOT re-build them). S5a (the account Memory shelf + the `/api/memory/review-mode` endpoint) is merged to `main` @ `dc73263`. This slice is **pure frontend** — no migration, no new/changed backend endpoint, and (critically) **no change to the run path** (the compile/retrieve/distill pipeline stays byte-identical, exactly as S5a kept it).

**Scope note:** the per-node agent-remember toggle is NOT in this slice (it's a §15-deferred later slice — it touches the run path). This slice is the two READ-oriented views only.

---

## Outcome
1. **A "Memory" tab in the run-inspector** (per-node, run-time) — what this node USED going in + what the run LEARNED, with inline Confirm/Discard for anything pending.
2. **A "Memory" section in the authoring drawer** (per-node, design-time) — this node's own private notes (its node-tier facts), manageable inline, with a link to the shelf for everything else.

---

## Ground yourself first (read before writing code)
- `frontend/src/panel/SidePanel.tsx` — the run-inspector tab host. A **worker** node's body has a segmented tab strip **Activity | Changes | Ask**; a **thinker** node's body has **Spec | Ask**. Add a **Memory** segment to both. Study how the existing segments are wired.
- `frontend/src/panel/ContextManifest.tsx` + wherever `LastRun` renders the per-round manifest — the selected node's invocations already carry `context_manifest` in the FE (`NodeInvocation.context_manifest` in `api.ts`). The injected-memory record is in that manifest's raw JSONB as `memory: [{id, polarity}]` but the FE `ContextManifest` type does NOT declare it yet — you'll extend the type.
- `frontend/src/panel/NodeChat.tsx` / `RunDiff.tsx` — sibling tab-content components; the model for a new Memory tab-content component.
- `frontend/src/panel/TeamNodePanel.tsx` — the authoring drawer. In the **agent/completion** branch, `SkillsSection` + `ToolsSection` mount (~line 786–793). The Memory section slots in beside them — BUT unlike those (which are controlled `value`/`onChange` pieces of the drawer's single Save), the Memory section is **independent-fetch + direct-mutate** (it hits the memory endpoints itself, like a mini-shelf). `node.id` here is the authored node id = `NodeMemory.node_id`.
- `frontend/src/lib/api.ts` — S5a's memory client is here (`listMemories`, `promoteMemory`, `rejectMemory`, `pinMemory`, etc. + `NodeMemoryRow`). REUSE them. Add ONE fn: `getRunMemories(runId)`.
- `frontend/src/components/MemoryFact.tsx` + `frontend/src/lib/memory.ts` — S5a's reusable chip (manage/pending/archived variants) + helpers (`POLARITY_META`, `TIER_LABEL`, `bucketMemories`, `reposOf`, `defaultRepo`). REUSE — do not duplicate.
- The **frontend-design** skill — match S5a's polarity-badge palette + chip styling; reuse the `.tv-*` panel vocabulary (no new global rules).

---

## What to build

### Surface 1 — the run-inspector Memory tab (`SidePanel.tsx`)
Add a **Memory** segment to the worker body (Activity | Changes | Ask | **Memory**) and the thinker body (Spec | Ask | **Memory**). Its content component has two zones:

- **"Used this run"** — the facts injected into THIS node's context. Read the selected node's per-round `context_manifest.memory` (`[{id, polarity}]`). Extend the FE `ContextManifest` type with `memory?: { id: string; polarity: string }[]`. Resolve each id → content CLIENT-SIDE via `listMemories({ include_superseded: true })` (build an id→row map; a used fact may since have been superseded or deleted → render "(no longer stored)" with just its polarity for an unresolved id). Render as `MemoryFact` in **read-only** (archived) variant, grouped by polarity force (reuse the force order from `lib/memory`).
- **"Learned this run"** — the durable facts this run TAUGHT. Add `getRunMemories(runId)` → `GET /api/runs/{id}/memories` (returns rows with content/polarity/status/tier). Render as `MemoryFact`; **pending** rows (`status === "pending_review"`) get the **pending** variant (Confirm = `promoteMemory` / Discard = `rejectMemory`). Filter to THIS node's invocations if the rows carry `source_invocation_id` — CHECK the actual row shape from `memory_distill.list_run_memories`; if the field isn't there, show the run-level list (same on every node's tab) and note it.
- Each zone gets an empty state.

### Surface 2 — the drawer Memory section (`TeamNodePanel.tsx`, agent/completion branch)
A "Memory" section beside Skills/Tools showing **this node's private notes**: `listMemories({ node_id: node.id })` → the node's node-tier facts across every repo it's learned on. Render as `MemoryFact` in **manage** variant (pin = `pinMemory`/`unpinMemory`, edit = `updateMemory`, delete = `deleteMemory` + confirm); **pending** rows get inline Confirm/Discard. If the node has facts on more than one repo, group/tag by repo (reuse `lib/memory`). Below the list: a **"Manage all memory →"** link to the Dashboard Memory shelf, and an **empty state** that teaches node memory ("This node has no private notes yet — as it runs, lessons specific to it appear here; shared repo-wide lessons live in the Memory shelf"). It is independent-fetch + direct-mutate — NOT wired into the drawer's Save button.

---

## Invariants / do-not-touch (checkable on disk)
- **NO migration** — head stays `0027`; no new `versions/` file; freeze stays `2[0-7]`.
- **NO backend change** — no new or edited endpoint; both views read the EXISTING `GET /api/memories` + `GET /api/runs/{id}/memories`. (Evidence: empty git diff across all of `backend/`.) `getRunMemories` is a FE client fn only.
- **NO run-path change** — `control_plane/context_compiler.py`, `control_plane/team_run.py`, `control_plane/memory_distill.py`, `control_plane/memory_retrieval.py` are byte-unchanged. (Evidence: empty diff on those four.)
- **REUSE, don't duplicate** — no second copy of the fact chip or the memory helpers; import `MemoryFact` + `lib/memory` + the S5a `api.ts` client.
- **The other tabs + drawer sections are unchanged** — Activity/Changes/Ask/Spec and the drawer's Skills/Tools/model/Save behavior stay green.

---

## Acceptance / evidence — run ALL yourself, debug to green, echo each
- `make lint` clean; `make build-frontend` + `make test-frontend` green (≥ the 334 floor + the new tests); `make test` green (backend UNCHANGED — a passing backend suite ≥636 is itself evidence you touched no backend).
- **Playwright self-sign-off, one screenshot per check** — GOTCHA: the run-inspector AND the authoring drawer render OVER the React Flow canvas, whose full-page accessibility snapshot chokes Playwright. Use **targeted `browser_evaluate` on specific selectors + screenshots**, NOT a whole-tree snapshot. Checks: (1) with a seeded/real completed run, open a worker node's inspector → the Memory tab renders with "Used this run" facts carrying polarity badges + a "Learned this run" list; (2) if a pending fact exists, Confirm moves it out of pending; (3) open the authoring canvas → open a node's config drawer → the Memory section renders the node's notes (or the empty state) + the "Manage all memory" link. Save a screenshot per check.
- Branch `feat/m-memory-s5b-views`; end with `READY_TO_MERGE` + the tip sha.

## Stop conditions
- A second/unknown problem needing a BROAD or UNPROVEN change → write `NEEDS_HUMAN` to `STATE.md` (what/why) + stop. A code-proven, contained, test-guarded fix MAY proceed.
- Hard cap: 60 turns.
