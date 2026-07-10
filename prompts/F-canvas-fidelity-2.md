# Canvas Fidelity — Pass 2: node/edge behavior + arrowheads (the canvas interior)

**What this is.** The 2nd fidelity pass — the canvas INTERIOR (nodes, edges, hover affordances), matched
to the design file. Pass 1 did the screen shell + the drawer; this pass does the node/edge behavior the
operator flagged live: the **+/trash disappear-delay** and **arrowheads on every edge**, plus the smaller
interior fidelity items. **The exact spec is** `design/Tvashtr Frontend Overhaul/Canvas.dc.html` — OPEN IT
and read the node markup (the `HOVER CONTROLS` block), the edge `<defs>` markers + the edge render, the
`onNodeEnter/onNodeLeave/onEdgeEnter/onEdgeLeave` handlers, and the `PALETTE`. Key facts are inline below.

**Frontend-only.** No backend, no API, no migration.

**BASE BRANCH:** branch `feat/canvas-fidelity-2` off **`feat/canvas-fidelity-1` @ `cfef09b`** (the shipped-
but-UN-MERGED Pass 1 tip), NOT off `main`. The stack is `main (e7e0c89) → F1c (e060eb9) → Pass 1
(cfef09b) → this`; all fast-forward to `main` **together** at the end. Verify that tip before branching.
Floors: vitest **183** (Pass 1's), backend **328**. Start FRESH loop-state for THIS brief (the existing
`.tvashtr/loop-state.md` is Pass 1's — overwrite it).

**Use the superpowers / dynamic-workflow skills where they help:** `systematic-debugging` when a check
fails, `test-driven-development` / `writing-plans` for the build, `verification-before-completion` before
you claim done, subagent/parallel dispatch for independent chunks.

---

## THE WALL (prove EMPTY vs main)
- `git diff main -- frontend/src/lib/api.ts` → EMPTY (no API change).
- `git diff main -- backend/` → EMPTY. Alembic head stays **0018**; NO migration.
- `git diff main -- frontend/src/components/Dashboard.tsx` → EMPTY (F2 owns the dashboard).
- **Do NOT regress the Pass 1 shell/drawer:** `git diff cfef09b -- frontend/src/App.tsx
  frontend/src/index.css frontend/src/panel.css` should be EMPTY (or, if you must thread a prop into
  `<TeamCanvas>`, minimal + explained) — this pass is the canvas interior, not the shell/drawer.
- **`canvas.css` IS in scope this pass** (the node/edge interior) — it is no longer frozen. Edit it here
  (and the canvas components). Tokens only; edit NO base token file; no ad-hoc hex.

Floors: backend **328** (FE-only), vitest **183** (rises — set the new floor in `STATE.md`; never <183).

---

## PART 1 — the +/trash "disappear delay" (a ~450 ms hover-out grace) — the operator's headline ask
GROUND TRUTH: the node hover affordances (`.rf-node__add` / `.rf-node__del` in
`frontend/src/canvas/AgentNodeCard.tsx`, revealed by the CSS rule `.rf-node:hover .rf-node__add {opacity:1}`
in `canvas.css`) hide the INSTANT the mouse leaves the node. The + sits ~10px to the RIGHT of the card
(`right:-34px`), so moving the mouse toward it crosses a gap that isn't "over the node" — the CSS `:hover`
drops and the button vanishes as you reach for it. Edges have the same problem (the midpoint trash).

DESIGN behavior (`Canvas.dc.html`): a JS hover model. `onNodeEnter` sets `hoverId` immediately (and
`clearTimeout`s the leave timer); `onNodeLeave` starts a **`setTimeout(… , 450)`** before clearing
`hoverId` — so the affordances stay RENDERED (and clickable) for ~450 ms after the mouse leaves, long
enough to move onto them. Same for edges (`onEdgeEnter` / `onEdgeLeave`, 450 ms).

FIX (match the design): drive the affordance reveal from React state with a mouse-leave grace, NOT CSS
`:hover`:
- In `TeamCanvas.tsx`, track `hoverNodeId` + `hoverEdgeId`. Use React Flow's `onNodeMouseEnter` /
  `onNodeMouseLeave` and `onEdgeMouseEnter` / `onEdgeMouseLeave` props. On enter → set the id +
  `clearTimeout`. On leave → `setTimeout(() => setHover…(null), 450)`. (One timer ref per axis; clear on
  unmount.) **AUTHOR mode only** (the affordances never show in a run — keep that gate).
- Thread `hovered` into each node's data (`hovered: hoverNodeId === node.id && editable`); `AgentNodeCard`
  renders the +/trash when `data.hovered` (rendered ⇒ `pointer-events:auto`), instead of the CSS-`:hover`
  reveal. For edges, the custom `WorkEdge`/`ReworkEdge` render their midpoint trash when the edge is the
  hovered one (pass the hovered-edge id via edge `data`, or a context).
- Remove the now-obsolete CSS `:hover` reveal rules for the affordances in `canvas.css` (the state now
  drives visibility). Keep the buttons' look; a short fade on show/hide is fine (reduced-motion still
  neutralizes it via the F0 guard).
- UX: hover a node/edge → its +/trash appear at once; move the mouse away and they linger ~0.45s (so you
  can slide onto the + or the trash and click it) before fading. No more vanishing-as-you-reach.

## PART 2 — arrowheads on EVERY edge — the operator's headline ask
GROUND TRUTH: `WorkEdge.tsx` + `ReworkEdge.tsx` already render whatever `markerEnd` they're given. In
`TeamCanvas.tsx` (the edges `useMemo`, ~L269–344) `markerEnd` is a `let` that starts UNDEFINED and is set
ONLY on the reject/escalation branches (and the rework edge gets one ~L296). So a **plain forward `work`
edge gets NO `markerEnd` → no arrowhead** (the common Engineer→Reviewer edge in the operator's screenshot).

DESIGN (`Canvas.dc.html`): EVERY edge has an end arrowhead (`marker-end` on every path), a small filled
triangle, colored by state — done→sage, active/rework→coral, forward→neutral (border-strong), branch→a
muted border/ink mix. (The design defines `ar-neutral`/`ar-coral`/`ar-sage`/`ar-branch` markers.)

FIX: give the forward `work` edges a state-colored `markerEnd` too, and confirm the branch + rework ones
already match:
- Forward `work` edge: set `markerEnd = { type: MarkerType.ArrowClosed, color, width, height }` with
  `color` by state — **`--border-strong`** normally, **`--coral-500`** when flowing (`rf-edge--flow`),
  **`--sage-500`** when done (`rf-edge--done`). (`ArrowClosed` is the filled triangle that matches the
  design's marker.) Read the CSS-var values via a small helper or hardcode the token's resolved value ONLY
  if React Flow can't take a `var()` in the marker color — prefer resolving from the DS tokens, no new hex.
- Reject/escalation branch edges: keep their arrowhead; make its color the muted branch tone (match
  `--branch-stroke` / the design's `ar-branch`).
- Rework edge (~L296): keep its coral arrowhead (match `ar-coral`).
- Size the markers to read like the design (~7×7). Verify EVERY edge on the canvas now ends in an
  arrowhead pointing INTO its target.
- UX: every connection now clearly shows direction — a small arrowhead into the receiving node, colored to
  the edge's state (grey normally, coral while work flows, green when done, muted on a branch).

## PART 3 — the "+" affordance on EVERY node kind
The design shows the "+" (add-downstream) on hover for ALL node kinds; the live app
(`AgentNodeCard.tsx`, `NodeAffordances`, `canAdd = kind === "agent" || "completion"`) shows it only on
Thinker/Worker. Show it on gate/terminal too (the trash already shows on all kinds). Keep the existing
downstream-add behavior + the kind picker. UX: hovering a gate or a Ship/Stop now also offers the "+" to
add the next node after it.

## PART 4 — the palette (secondary; open-on-hover + styling)
The design's top-left "Add to canvas" palette opens on **hover** (`onMouseEnter`) and reads as a clean
2×2 of Thinker / Worker / Gate / Terminal. The live palette (`NodePalette.tsx`) opens on **click**.
- Make it open on hover (keep click working too) and align its styling to the design's compact card.
- **KEEP Ship + Stop as SEPARATE palette items** (do NOT collapse to a single "Terminal"). Rationale
  (decide-from-the-vision): authoring your own terminals means being able to add BOTH a Ship and a Stop;
  a single "Terminal" would default to one kind, and changing ship↔stop is a deferred backend item (§15) —
  so a single item would strand the Stop endpoint. This is a deliberate, flagged deviation from the mock's
  4-item palette; the single-Terminal item rides with the future ship↔stop-editing backend slice.
- UX: hovering the top-left "+" opens the add menu; it still offers Thinker / Worker / Gate / Ship / Stop
  (+ presets) so you can drop any endpoint kind.

## PART 5 — small caption/icon fidelity
- The Reviewer card caption is **"Checks against the spec"** in the design; the live `ROLE_BLURB.reviewer`
  is "Checks the work against the spec" — align it to the design's shorter copy.
- Eyeball the node glyphs against the design's close-ups; fix any obvious glyph mismatch (e.g. the Ship
  icon) using the same lucide set already imported. Do NOT change the card layout/pills (those matched).

---

## TESTS (mutation-real; co-located `*.test.tsx`, vitest + RTL)
Keep the Pass 1 + F1c tests green (re-point only if the DOM genuinely shifted). Add:
- **Hover grace (Part 1):** with fake timers — entering a node marks it hovered (its + / trash render);
  after `mouseLeave`, the affordances are STILL rendered before 450 ms elapses, and are GONE after
  advancing past 450 ms. (Assert the +/trash presence across the timer boundary — this fails on the
  pre-fix CSS-only code.) Prefer `fireEvent` + `vi.useFakeTimers()`.
- **Arrowheads (Part 2):** the forward `work` edge object now carries a `markerEnd` (ArrowClosed) with the
  neutral color; a flowing edge → coral; a done edge → sage. (Assert the built edge objects' `markerEnd` —
  fails on the pre-fix code where the forward edge's `markerEnd` was undefined.)
- **"+" on all kinds (Part 3):** a gate node and a terminal node, when hovered (author mode), expose the
  add "+" affordance (previously absent).
- **Reviewer caption (Part 5):** the Reviewer card renders "Checks against the spec".
- FE gotchas: user-event ⊥ fake timers → prefer `fireEvent`; React Flow needs the existing
  `src/test/setup.ts` shims.

## PLAYWRIGHT SELF-SIGN-OFF (you run it; a screenshot per check → `scratchpad/canvas-fidelity-2/`)
Bring up the stack (`make backend` bg + `make frontend`), log in as the seeded operator
(`operator@tvashtr.local` / `tvashtr-dev`), open a team from the dashboard. Targeted `browser_evaluate` +
screenshots (NOT the whole-canvas a11y snapshot — it HANGS). Capture + eyeball vs `Canvas.dc.html`:
1. **Arrowheads:** a screenshot of the authoring canvas showing arrowheads at the end of the forward edges
   (into the receiving nodes), the branch edge, and the rework arc — every edge ends in an arrowhead.
2. **Hover grace:** hover a node, screenshot the +/trash visible; then (via `browser_evaluate` dispatching
   mousemove off the node, or measuring) confirm the affordances remain in the DOM within the grace window
   and clear after it. A screenshot with the + visible while the pointer is between the node and the +.
3. **"+" on a gate + a Ship** on hover.
4. The **palette open on hover** with its items.
Record the screenshot paths in `STATE.md`.

## DEFINITION OF DONE
`make test` green (≥328 backend — quote the passed line), `make lint` clean, `make test-frontend` green
(new vitest floor ≥183, recorded + quoted), `make build-frontend` (tsc-strict + vite) green, the Playwright
screenshots captured, the WALL diffs proven EMPTY (`api.ts`, `backend/`, `Dashboard.tsx`; and `App.tsx` /
`index.css` / `panel.css` unchanged vs `cfef09b`) with head still `0018`, `STATE.md` updated with the
branch + sha + floors + screenshot paths + a `READY_TO_MERGE` line, and the §4.7 8-section FINAL REPORT
emitted. Echo each decisive evidence line into the transcript as you go.
