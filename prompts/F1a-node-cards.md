# F1a — M-frontend, canvas cluster slice 1: the node cards + status fix

**Milestone:** M-frontend → F1 (canvas cluster) → **slice F1a** — the node cards themselves. **FRONTEND-ONLY. NO migration. The backend contract is the WALL.**

Authoritative brief for the F1a `/goal`. Read in full, then execute.

## Outcome
Reskin the three canvas node variants (agent/thinker/worker card, gate, terminal) to the design's premium n8n look — glyph + title + caption + round badge, a capability + engine + status-pill row, a clickable model footer row, the start-node coral bar + "Start · entry" eyebrow, and the running/done/failed status overlays — and fold in the `deriveNodeStatus` never-reached fix. Every existing screen and the canvas layout keep working; only the node cards change look. Canvas chrome (zoom controls, minimap, background, edges, handles/connection) is F1b — do NOT touch it here.

## Reference (read first)
Extract `design/Tvashtr Frontend Overhaul.zip` to a scratch dir OUTSIDE the repo (e.g. `/tmp/tvashtr-design`). The node recipe is in `Canvas.dc.html`, the AGENT/THINKER/WORKER block and the GATE/TERMINAL blocks (~lines 190–242): the card anatomy, the start left-bar + "Start · entry" eyebrow, the clickable model footer row (CPU glyph + mono model, hairline-separated via `--border-faint`), and the running (`tv-breathe` inset glow) / done (sage check badge, `tv-stamp`) / failed (red × badge) overlays. Do NOT stage or commit anything under `design/`.

**F0 already shipped these tokens/keyframes — consume them, don't redefine:** `--shadow-node` / `--shadow-node-hover`, `--glow-running` / `--glow-soft`, `--surface-board`, and the keyframes `tv-breathe`, `tv-stamp`, `tv-pop-in`. All node colours resolve to DS tokens — no ad-hoc hex.

## Do — four files

### 1. `canvas.css` — restyle the NODE rules only
Lift `.rf-node` (+ `--running` / `--done` / `--failed` / `--stopped` / `--idle`), `.rf-node__head` / `__glyph` / `__role` / `__kind` / `__round` / `__model` / `__foot`, `.rf-gate` (+ states) / `.rf-gate__*`, and `.rf-terminal` (+ kind/states) / `.rf-terminal__*` to the design recipe:
- Card: ~14px radius, 1.5px border, status-tinted fill, `--shadow-node` at rest → `--shadow-node-hover` on hover.
- Running: an inset glow overlay animated with `tv-breathe` (the coral "alive" beat). Done: a sage check badge top-right (`tv-stamp`). Failed: a red × badge top-right.
- The new **model footer row**: a top hairline (`--border-faint`) with a CPU glyph + mono model text (ellipsis, nowrap).
- Keep the authoring flag styles (`.rf-node--invalid` red ring, `.rf-node--orphan` dim). The dead `.rf-node--paused` may be removed (no agent node reads paused).
- Do NOT touch the canvas-chrome / edge / handle rules in this file (F1b).

### 2. `AgentNodeCard.tsx` — restructure to the design anatomy
- `AgentCard`: head = glyph box + (start eyebrow if `isEntry`) + title + caption + optional round badge; then the capability + optional engine + **`<StatusPill>`** row (move the pill up out of the old `.rf-node__foot`); then the clickable model footer row (CPU glyph + `d.model`). The start coral left-bar + "Start · entry" eyebrow render ONLY when `d.isEntry`. The model row is a button but its click opens nothing yet (the picker is F1c) — render it inert / no-op.
- Add `isEntry?: boolean` to `AgentNodeData`.
- `GateCard` / `TerminalCard`: keep structure, restyle via the new CSS.
- Icons stay lucide-react (map the design glyphs to the existing Lucide set; add a CPU icon, e.g. `Cpu`, for the model row).

### 3. `TeamCanvas.tsx` — compute + pass `isEntry` (the ONLY change here)
In the node-data assembly (`toNodeData` / the `graph.nodes.map`), compute the entry set: a node is the entry if **no forward edge targets it** — i.e. no edge with `conditions?.loop_limit == null` has `target_node_id === n.id` (loop-back / rework edges, which carry `loop_limit`, do NOT disqualify). Set `isEntry` on each node's `AgentNodeData`. Pure FE computation over the existing `graph.nodes` + `graph.edges` — NO backend change, no new payload field.

### 4. `lib/status.ts` — the `deriveNodeStatus` never-reached fix (+ reproduce-first test)
Today a not-yet-reached node (`backendStatus === "idle"`) folds to `failed` / `stopped` when the run/workflow is terminal, so nodes the walk never reached wrongly read red. Fix: apply the failed/stopped override ONLY when `backendStatus === "running"` (a node actually in-flight when the run died); an `idle` node stays `idle` regardless of run/workflow terminal state. `done` / `failed` / `stopped` from the backend still pass straight through.
Add a **reproduce-first** vitest regression (in the existing status test file) that FAILS on the current code and passes after: idle node + failed run → `idle` (was `failed`); idle node + cancelled/over_budget run → `idle` (was `stopped`); running node + failed run → still `failed`; done node stays `done`.

## Invariants (prove each on disk; quote in the FINAL REPORT)
- `frontend/src/lib/api.ts` byte-untouched: `git diff main -- frontend/src/lib/api.ts` EMPTY.
- The F0 files not regressed: `git diff main -- frontend/src/design-system/tokens/extend.css frontend/src/index.css` EMPTY (F1a consumes F0 tokens; it doesn't edit them).
- NO backend change, NO migration: `git diff --name-only main` lists ONLY paths under `frontend/src/`; nothing under `backend/`, no `alembic/versions/*`; alembic head stays `0018`.
- Nothing under `design/` staged or committed.

## Acceptance / evidence (run each yourself, debug to green, echo the decisive line per §4.3a)
- `make test-frontend` — vitest green; the floor rises from 165 by the new `deriveNodeStatus` regressions (quote "N passed"). Confirm the new regression FAILS on the pre-fix `deriveNodeStatus` (paste the failing run), then passes after the fix. Any node-card test whose DOM/class output legitimately changes is RE-POINTED and re-read to confirm it still asserts real behaviour — never gutted.
- `make build-frontend` — tsc-strict + vite clean (quote final line).
- `make lint` — clean (quote result).
- **Playwright self-sign-off** (headless; targeted `browser_evaluate` on specific node selectors + screenshots, **NEVER a whole-canvas a11y snapshot — it hangs**): open a team canvas (use the existing e2e/seed login + a seeded team the M-accounts / authoring tests use); screenshot the node variants — a thinker card, a worker card (engine chip present), the entry node showing the coral bar + "Start · entry", a gate, a terminal; then seed/drive a run and screenshot a running node (breathing glow), a done node (sage check), and a failed run showing the broken node red WHILE an unreached downstream node stays neutral (the fix, visible); also confirm the round-N badge, the model footer row, and the invalid/orphan flags still render. Nodes still drag; the graph still renders; NO layout break. Compare against `design/Canvas.dc.html`. Record every screenshot path in `STATE.md` and quote them.
- Write `READY_TO_MERGE: branch=feat/f1a-node-cards, sha=<sha>, frontend=<N> passing` to `STATE.md` and echo it.

## Branch & discipline
Branch `feat/f1a-node-cards`. Commit only your own changed paths; never push, never merge — the operator fast-forward-merges. Leave `PROJECTPLAN.md`, `HANDOVER.md`, and any `prompts/*.md` untouched.

## Completion & stop
MET when all acceptance items are green in the transcript, the reproduce-first regression is shown failing-then-passing, the invariant proofs are quoted, and the §4.7 FINAL REPORT (8 sections) is written. A clean SUCCESS is the expected terminal. If you hit a SECOND or unknown problem needing a broad or unproven change, STOP and write `NEEDS_HUMAN` to `STATE.md` — a recorded `NEEDS_HUMAN` WITH the FINAL REPORT is a valid, goal-met terminal (don't loop re-arguing it). A code-proven, contained, regression-guarded fix to a single identified cause may proceed. End with the §4.7 FINAL REPORT (all 8 sections).
