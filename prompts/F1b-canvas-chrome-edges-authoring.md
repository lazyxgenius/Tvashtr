# F1b — M-frontend, canvas cluster slice 2: canvas chrome + edges/handles + the n8n authoring affordances

**Milestone:** M-frontend → F1 (canvas cluster) → **slice F1b**. **FRONTEND-ONLY. NO migration. The backend contract is the WALL** (`frontend/src/lib/api.ts` byte-untouched, no new endpoint, alembic head stays `0018`).

Authoritative brief for the F1b `/goal`. Read in full, then execute. F1a already shipped the node CARDS; F1b is everything AROUND them: the board chrome, the edges/handles, and the inline authoring affordances. The right config drawer, the drawer↔modal toggle, and wiring the (currently inert) model footer are **F1c — do NOT build them here.**

## Outcome
Reskin the canvas chrome (board surface, zoom/fit controls, minimap, dotted background), the edges (forward / branch / reject / escalation / the rework loop-back arc, the coral "work-flowing" animation on active edges, the drag-to-connect ghost line), and the handles (drag-to-connect dots) to the design's premium n8n look — AND add the inline authoring affordances over the EXISTING node/edge CRUD: a hover **"+"** on a thinker/worker node that adds the next node downstream, a hover **trash** on a node and on an edge to delete it, and the relocated + restyled add-to-canvas palette. Everything the app already does keeps working; the graph still renders, nodes still drag, edges still route, tests stay green.

## Reference (read first)
Extract `design/Tvashtr Frontend Overhaul.zip` to a scratch dir OUTSIDE the repo (e.g. `/tmp/tvashtr-design`). The chrome/edge/affordance recipe is in **`Canvas.dc.html`**:
- **Board + background** (~line 156): the pan/zoom board; the dotted background = `radial-gradient(circle, var(--line-400) 1.1px, transparent 1.3px)`, 26px grid, opacity ~.55.
- **Edges** (~lines 160–183): styled SVG paths + markers (neutral / coral / sage / branch arrowheads); an ACTIVE edge gets a coral marching-dash overlay (`animation: tv-flow …`) — F0 shipped the `tv-flow` keyframe. A coral dashed **ghost** path renders while dragging a new connection.
- **Handles** (~lines 240–242): a right-side connect dot (`cursor:crosshair`) + a passive left dot; ~11–13px circles, `--surface-card` fill, `1.5px solid --border-strong`.
- **Node hover controls** (~lines 244–256): the **"+"** on the node's right ("Add a downstream node") and the **trash** at the node's top-right ("Delete node"), revealed on hover.
- **Edge hover delete** (~lines 184–185 + the `edgeDeletes` geometry ~line 912): a trash button at the edge MIDPOINT, **nudged UP ~30px when the edge has a label** so it clears the label (this is the operator's edge-delete placement tweak — implement it).
- **Palette** (~lines 256–268): a compact **top-left "+"** that opens a small "Add to canvas" popover.
- **Zoom controls** (~lines 271–276): bottom-left rounded card, 32×32 buttons — zoom-in (+), zoom-out (−), fit.
- **Minimap** (~lines 278–283): bottom-right rounded card, ~190×120, `--surface-card`, `--border-hairline`, `--shadow-sm`.
- **Node picker** (~lines 285–297) + **edge role editor** ("How do they connect?", ~lines 299–320): the two overlays.

Do NOT stage or commit anything under `design/`.

**F0 already shipped these — consume them, don't redefine:** `--surface-board`, `--shadow-sm`, the edge stroke tokens `--rework-stroke` / `--branch-stroke` (already in `canvas.css`), the keyframes `tv-flow` (edge flow), `tv-pop-in` (popovers). All colours resolve to DS tokens — no ad-hoc hex. If a genuinely new token is unavoidable, ADD it to `design-system/tokens/extend.css` only ("extend never replaces" — never touch the 5 base token files).

## The one ratified design decision — how the inline "+" behaves
Node-anchored (NOT n8n edge-splice), because our edges carry roles/conditions that don't cleanly split:
- Hover a **thinker or worker** node → a coral **"+"** appears on its right edge. (NOT on gates or terminals — a terminal is an ending; a gate's outgoing routing is approved/rejected, which stays on drag-to-connect. A plain forward edge from a thinker/worker is always valid.)
- Click "+" → a small **kind picker** popover opens next to the node (reuse the palette's menu — see below).
- Pick an item → a new node is created **just to the right of the source, same y** (gap ~90–100px), **auto-connected with a plain forward (`role: "forward"`) edge** from the source to it, and — for a thinker/worker — the new node is **auto-selected** (which opens the EXISTING side panel; the premium drawer is F1c). Gate/Terminal: created + forward-edged, not auto-selected.
- Branch and loop-back edges are NOT offered by "+"; they stay on the existing drag-to-connect → "How do they connect?" editor.

## The palette + the inline picker menu (reuse existing content — do NOT drop features)
Reuse the EXACT menu the current `NodePalette` already offers, for BOTH the relocated top-left palette AND the inline "+" picker:
- **Add (blank primitives):** Thinker, Worker, Gate, **Ship**, **Stop**.
- **Presets:** PM, Architect, Engineer, Reviewer.
- **Keep Ship and Stop as SEPARATE items — do NOT collapse them into one "Terminal".** `CreateNodeBody.terminal_kind` is required, and editing a terminal's kind after drop lives in F1c's drawer — so in F1b the only way to choose ship-vs-stop is at add time. (The design mockup's single "Terminal" item is a mockup simplification; keep the real two.)
- The **top-left palette "+"** adds a FREE node (the existing `handleAddNode` path — auto-position via `nextDropPosition`, no edge). The **inline node "+"** adds a downstream node + forward edge (the new `handleAddDownstream` path). Same menu, two placements, two behaviours.

## Do — the work (self-decompose the exact file split; this is the required behaviour + surface)

### Chrome, edges, handles — `canvas.css` (the `.react-flow__*` / `.rf-edge*` / handle rules — these are F1b's; F1a touched ONLY the `.rf-node*` rules)
- Restyle `.react-flow` board surface (consume `--surface-board`), `.react-flow__background-pattern.dots circle` (the design's dotted grid), `.react-flow__controls` + `.react-flow__controls-button` (+ hover + svg) to the bottom-left rounded card with +/−/fit, and `.react-flow__minimap` + `.react-flow__minimap-mask` to the bottom-right premium card.
- Restyle the edges: `.react-flow__edge-path` base; `.rf-edge--flow` = the coral "work-flowing" animation (React Flow renders ONE path per edge — animate that single `.react-flow__edge-path`'s `stroke-dasharray` with the `tv-flow` keyframe; the design's separate overlay path is a mockup convenience); `.rf-edge--done`; `.rf-edge--reject` / `.rf-edge--escalation` (the muted branch look, `--branch-stroke`); `.rf-edge--rework` + `.rf-edge-rework__label` (the calm dashed arc + "changes requested" pill). **KEEP every `.rf-edge--*` class name and the "changes requested" label text unchanged** — the canvas tests assert on them (see Invariants). Optional: a subtle one-shot edge draw-in — include ONLY if you can guarantee it fires once per edge and never re-fires on the per-poll refetch; otherwise skip it (a flickering redraw every poll is worse than none).
- Restyle `.react-flow__handle` (+ `:hover`, `.rf-node__hidden-handle`) to the design's connect dots.
- ADD the node-affordance rules (`.rf-node__add`, `.rf-node__del`, or your names) + the hover-reveal, and the edge-delete button style. Node affordances are hidden by default and revealed on `.rf-node:hover` (pure CSS — the buttons live inside the node DOM). **Do NOT alter F1a's existing node-card recipes** (`.rf-node`, `.rf-node__glyph/__titles/__role/__caption/__meta/__cap/__engine/__model/__bar/__eyebrow/__round`, the status overlays) — F1b only ADDS node-affordance rules.

### Node affordances — the node component (`AgentNodeCard.tsx`, the single `agentNode` type that dispatches by kind)
- Render the hover **"+"** (thinker/worker only) and the hover **trash** (all kinds), shown only when `editable` and revealed on hover (CSS). Thread the callbacks in via node `data` (or a small React context from `TeamCanvas`): the "+" signals the canvas to open the add-picker for THIS node id; the trash calls the existing delete-node handler for this id. Keep F1a's card anatomy/status rendering intact.

### Canvas wiring — `TeamCanvas.tsx`
- **Edge hover-delete:** give the non-rework edges (currently `type:"default"`) a custom edge component (mirror how `ReworkEdge` already renders a midpoint label via `EdgeLabelRenderer`) that draws the styled path + arrowhead + a hover-revealed **trash** at the path midpoint, nudged up ~30px when the edge has a label. Add the same hover trash to `ReworkEdge`. NOTE: `EdgeLabelRenderer` portals the button OUT of the edge group, so plain CSS `:hover` on the edge won't reach it — track a `hoveredEdgeId` in canvas state via `onEdgeMouseEnter`/`onEdgeMouseLeave` (or an invisible wide hit-path per the design) and show the trash only on the hovered edge, editable-only. Clicking it calls the existing `onDeleteEdges([id])`.
- **Inline "+" picker:** render a small kind-picker overlay (like `EdgeRoleEditor`) when a node's "+" is clicked, positioned near that node; on pick, call a new `onAddDownstream(fromId, body)` prop. Style with `tv-pop-in`.
- **Ghost / connection line:** style React Flow's connection line (the drag-to-connect preview) as the coral dashed ghost (`connectionLineStyle` / the `.react-flow__connectionline` rule).
- Keep the geometry router (`pickHandles`), the rework/reject/escalation classification, the entry computation (`entryNodeIds`), and selection-by-id all exactly as they are.

### Parent orchestration — `App.tsx`
- Add `handleAddDownstream(fromId, body)`: guard team present; compute the new position (source node's `position.x` + its rendered width + ~90–100px, same `y`); `await createTeamNode(currentTeamId, { ...body, position })`; capture the returned node's `id`; `await createTeamEdge(currentTeamId, { source_node_id: fromId, target_node_id: newId, role: "forward" })`; `await loadTeam(currentTeamId)`; then, if the added kind is thinker/worker, `setSelectedNodeId(newId)`. Reuse the existing `setEditBusy` / error handling shape. Pass `onAddDownstream` into `<TeamCanvas>`. The existing `handleAddNode` (free palette add) stays unchanged.

### Palette — `NodePalette.tsx`
- Relocate to the design's top-left "+" popover (the current bottom tray → a compact "+" that opens the "Add to canvas" panel), restyle to the premium look, keep BOTH groups (Add primitives incl. Ship + Stop, and Presets). Export/share its menu definition so the inline "+" picker uses the SAME items (single source of truth).

### Edge role editor — `EdgeRoleEditor.tsx`
- Restyle the "How do they connect?" modal + the node picker to the design's card look (`tv-pop-in`, `--surface-card`, `--shadow-pop`). Behaviour unchanged (Then → / When it outputs… → / Rework loop with its bounded exit).

## Invariants (prove each on disk; quote the proof in the FINAL REPORT)
- `frontend/src/lib/api.ts` byte-untouched: `git diff main -- frontend/src/lib/api.ts` EMPTY. No new endpoint, no changed API signature.
- The 5 base token files byte-untouched: `git diff main -- frontend/src/design-system/tokens/{colors,fonts,typography,spacing,base}.css` EMPTY. (Any new token → `extend.css` only.)
- The F1a node-card recipes intact: the canvas tests `TeamCanvas.test.tsx` still pass unchanged — they assert `.rf-edge--rework` / `.rf-edge--reject` (exactly one each), the "changes requested" label, the derived status text ("Working…", "Done", "Awaiting approval", "Shipped"), and selection-by-id. Keep those class names + that label text.
- NO backend change, NO migration: `git diff --name-only main` lists ONLY paths under `frontend/src/`; nothing under `backend/`, no `alembic/versions/*`; alembic head stays `0018`.
- Nothing under `design/` staged or committed.

## Acceptance / evidence (run each yourself, debug to green, echo the decisive line per §4.3a)
- `make test-frontend` — vitest green, floor **167 does not regress** (quote "N passed"). ADD mutation-real tests: (a) the `handleAddDownstream` orchestration — asserts `createTeamNode` was called with a position and the picked body, THEN `createTeamEdge` was called with `{ source_node_id, target_node_id: <new id>, role: "forward" }`, THEN the new node id is selected (for a thinker/worker) — i.e. proves the forward EDGE is created, not just the node; (b) the node hover-trash calls delete-node with the right id; (c) the edge hover-trash calls delete-edge with the right id. Any existing test whose DOM/class output legitimately changed is RE-POINTED and re-read to confirm it still asserts real behaviour — never gutted.
- `make build-frontend` — tsc-strict + vite clean (quote final line).
- `make lint` — clean (quote result).
- `make test` — backend suite still green (FE-only change; prove no regression; quote "=== N passed ===", floor 328).
- **Playwright self-sign-off** (headless; targeted `browser_evaluate` on specific selectors + screenshots — **NEVER a whole-canvas a11y snapshot; it HANGS on React Flow**). Bring up the stack (`make backend` bg + `make frontend`), log in via the existing e2e seed/login, open an authoring team, and capture:
  1. the restyled chrome — the bottom-left zoom/fit controls, the bottom-right minimap, the dotted board (screenshot);
  2. hover a thinker/worker node → the "+" and trash appear (screenshot); click "+" → the kind picker → pick **Worker** → a new node appears to the right, joined by a forward edge, and the side panel opens on it (screenshot before + after);
  3. hover an edge → the trash appears at its midpoint (and, on a labelled edge, clears the label) → click it → the edge is gone (screenshot before + after);
  4. the rework loop-back arc renders as the calm dashed "changes requested" arc, and an active edge carries the coral flow animation — assert the `.rf-edge--rework` and `.rf-edge--flow` classes + the flow keyframe are applied via `browser_evaluate` (a static screenshot can't show motion);
  5. the top-left palette "+" opens the "Add to canvas" popover showing BOTH groups incl. Ship + Stop (screenshot).
  Confirm nodes still drag and the graph still renders with no layout break. Compare against `design/Canvas.dc.html`. Record every screenshot path in `STATE.md` and quote them.
- Write `READY_TO_MERGE: branch=feat/f1b-canvas-chrome-edges, sha=<sha>, frontend=<N> passing` to `STATE.md` and echo it.

## Branch & discipline
Branch `feat/f1b-canvas-chrome-edges`. Commit only your own changed paths under `frontend/src/`; never push, never merge — the operator fast-forward-merges. Leave `PROJECTPLAN.md`, `HANDOVER.md`, `STATE.md` sections you don't own, and any `prompts/*.md` untouched by your commits.

## Completion & stop
MET when all acceptance items are green in the transcript, the new affordance tests are shown asserting real behaviour (esp. the forward-edge creation), the invariant proofs are quoted, the screenshots are recorded, and the §4.7 FINAL REPORT (8 sections) is written. A clean SUCCESS is the expected terminal. If you hit a SECOND or unknown problem needing a broad or unproven change, STOP and write `NEEDS_HUMAN` to `STATE.md` — a recorded `NEEDS_HUMAN` WITH the FINAL REPORT is a valid, goal-met terminal (don't loop re-arguing it). A code-proven, contained, regression-guarded fix to a single identified cause may proceed. End with the §4.7 FINAL REPORT (all 8 sections).
