# M-ledger — C6 (frontend): light up the run-inspector's per-round cost + context-manifest; fix the event feed

**Session B of a two-session parallel batch, running in a git WORKTREE off `main`. You are the
FRONTEND half.** A separate session builds the backend against the SAME wire contract below. Touch
ONLY `frontend/` files — do NOT touch any backend/Python file, do NOT add a migration, do NOT run
the backend or a database. You are ALREADY on your branch in this worktree — do NOT `git checkout`.
Your dev-server port is **5174**.

## Outcome
In the run-view inspector, surface — per node, per round — the round's cost (tokens in/out + $)
and, for worker rounds, the context-manifest table (each context part with its token size, the
budget, and a "spec offloaded to SPEC.md" flag). AND fix the worker event feed: once the backend
stops dropping later rounds, the feed must scope to the selected node, group its steps by round,
and key rows uniquely (today it keys by `seq`, which stops being unique). Build to the wire
contract below; the backend emits it — do NOT invent field names.

---

## WIRE CONTRACT  — identical in both briefs; the backend emits EXACTLY this (read it, don't invent field names)

**1. `GET /api/runs/{run_id}/graph`** — every object in each node's `invocations[]` gains two
ADDITIVE fields (existing `iteration`, `status`, `outcome`, `outcome_detail`, `started_at`,
`ended_at` stay as-is):
- `context_manifest`: object | null — `{ "parts": [ { "name": string, "tokens": integer }, ... ], "total_tokens": integer, "budget": integer, "handle_used": boolean }`. `null` for thinker /
  gate / terminal rounds.
- `cost`: object | null — `{ "prompt_tokens": integer, "completion_tokens": integer, "total_tokens": integer, "cost_usd": number }`. `null` when no cost row is linked (gates/terminals; a
  zero-usage reviewer round).

**2. `GET /api/spike/run-events/{run_id}`** — every object in `events[]` gains three ADDITIVE
fields (existing `seq`, `kind`, `payload`, `created_at` stay):
- `invocation_id`: integer | null — the invocation this event belongs to. `null` for legacy rows.
- `node_id`: string (UUID) | null — the node that invocation ran on. `null` for legacy rows.
- `iteration`: integer | null — that invocation's round number. `null` for legacy rows.

**3. NEW `GET /api/runs/{run_id}/trajectory`** — backend-only capture surface. **YOU DO NOT
CONSUME IT.** You consume (1) the `/graph` invocation fields and (2) the event fields only.

---

## The changes (frontend only)

### 1. Types — `lib/api.ts`
- Add `export interface ContextManifest { parts: { name: string; tokens: number }[]; total_tokens: number; budget: number; handle_used: boolean }` and
  `export interface InvocationCost { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost_usd: number }`.
- `NodeInvocation`: add `context_manifest: ContextManifest | null` + `cost: InvocationCost | null`.
- `RunEvent`: add `invocation_id: number | null` + `node_id: string | null` + `iteration: number | null`.
- Do NOT change any fetcher URL or the existing fields.

### 2. NEW `panel/ContextManifest.tsx`
- A small presentational component: given a `ContextManifest`, render a compact table of its
  `parts` (name + token count), the `total_tokens`, the `budget`, and — when `handle_used` — a
  muted "Spec offloaded to SPEC.md" note. Reuse existing `.tv-*` conventions; add classes to
  `panel.css` (NOT `index.css`).

### 3. `components/LastRun.tsx`
- Extend `LastRunRound` with OPTIONAL `context_manifest?: ContextManifest | null` and
  `cost?: InvocationCost | null` (import the types from `../lib/api`).
- Under each round, WHEN present, render a one-line cost summary (e.g.
  "1,240 in / 320 out · $0.0041") and, when `context_manifest` is present, the `<ContextManifest>`
  block.
- The AUTHORING caller (`TeamNodePanel`) passes NEITHER field → its render stays byte-identical.
  Verify `TeamNodePanel.test.tsx` still passes UNCHANGED.

### 4. `panel/SidePanel.tsx`
- `node.invocations` already flow into `<LastRun rounds={node.invocations} />` — since
  `NodeInvocation` now carries `context_manifest`+`cost`, the per-round data reaches `LastRun`
  automatically (confirm the types line up).
- Pass the selected `node` into `<EventFeed .../>` so the feed can scope to it.

### 5. `panel/EventFeed.tsx`
- Accept the selected `node`.
- After fetching events, FILTER to the selected node's events (`e.node_id === node.id`).
- GROUP the filtered events by `invocation_id` (round) in ascending order; render a small round
  header ("Round N") above each group's steps. A single-round node shows one group.
- KEY each row by `` `${e.invocation_id}:${e.seq}` `` (unique across rounds) — NOT `e.seq`.
- Keep the existing polling / terminal / auto-scroll behavior + the crash-recovery note.

---

## Acceptance / evidence (run it ALL yourself, debug to green, echo each into the chat)
- **vitest (rendering, from contract-shaped fixtures):**
  - `LastRun` / `ContextManifest`: a round WITH a `context_manifest` renders the parts+tokens+budget
    table and the cost line; a round WITHOUT renders neither; `handle_used:true` shows the SPEC.md
    note.
  - `EventFeed`: given fixture events across TWO invocations of the selected node PLUS events for a
    DIFFERENT node, assert (a) only the selected node's events show, (b) they're grouped under
    "Round 1"/"Round 2" headers, (c) row keys are unique (no React duplicate-key warning).
  - `SidePanel`: re-point its test to the node→EventFeed pass-through + the LastRun manifest render
    (re-point, do NOT gut).
  - `api.test.ts`: the new fields type-check / round-trip.
- `make test-frontend` all green (re-baseline the vitest floor first; report old→new count).
- The FE production build is green (the Makefile's frontend-build target).
- **Self-sign-off screenshot (real pixels, stubbed data):** bring the FE up on port 5174; using
  Playwright, intercept the run-`/graph` + `/spike/run-events` calls to return contract-shaped
  fixtures (a worker node that looped 3 rounds, with per-round manifests + costs + multi-round
  events); open the run inspector for that worker node; capture a screenshot showing the round
  list, per-round cost, the manifest table on a worker round, and the round-grouped feed. Assert
  (via `browser_evaluate` on the SPECIFIC selectors — NOT a full-tree accessibility snapshot, which
  chokes on the React Flow canvas) that the manifest table + round headers are present.
- **Invariants as evidence:** `git diff --name-only main` shows ONLY `frontend/` files (NO
  backend/Python/migration). `git diff main -- frontend/src/panel/TeamNodePanel.test.tsx` is EMPTY.
- Commit on your branch; commit only your own changed paths (leave living docs + `prompts/*.md`
  untracked). End with `READY_TO_MERGE`.

## Stop conditions
Write `NEEDS_HUMAN` to `STATE.md` and stop on an external blocker or a second unknown problem
needing a broad/unproven change; a contained, test-guarded change inside this scope → proceed. Hard
cap: 40 turns.
