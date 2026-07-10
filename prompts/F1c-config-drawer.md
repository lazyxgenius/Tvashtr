# F1c — the premium config drawer + drawer⇄modal toggle + model picker + run-view

**Milestone:** M-frontend, slice **F1c** (the canvas cluster's 3rd + final slice). This is the last
canvas slice; F2 (dashboard) / F3 (auth wizard) / F4 (landing) come after.

**One-line outcome:** reskin BOTH side panels into the design's premium **384px right drawer**, add a
**dock⇄pop-up toggle**, wire the **model picker** the node card's model chip opens, and reskin the
**run-view** — all FRONTEND-ONLY, on top of F0's already-present tokens.

You are reskinning the EXISTING, tested panels to the target LOOK in `design/Tvashtr Frontend
Overhaul/Canvas.dc.html` (the RIGHT DRAWER / MODAL block). The design mockup is the look, NOT a
rebuild — keep the real components, real API calls, real tests; change the chrome + wire the
affordances. Do NOT copy the mockup's role-based structure (see Decision 2 below).

---

## THE WALL (hard invariants — express as on-disk evidence)

This slice is a pure frontend reskin. The backend contract is untouched:

- `frontend/src/lib/api.ts` is **BYTE-IDENTICAL** to `main` — prove with an EMPTY `git diff main --
  frontend/src/lib/api.ts`. (No new endpoint, no new API call, no changed signature.)
- **No backend change at all** — EMPTY `git diff main -- backend/`. Alembic head stays **`0018`**;
  create NO migration.
- The reskin lives in **`frontend/src/panel.css`** (+ new/edited panel components). Do NOT restyle the
  node cards, chrome, or edges — `frontend/src/canvas.css` stays **BYTE-IDENTICAL** to `main` (EMPTY
  `git diff main -- frontend/src/canvas.css`). F1a's node recipes + F1b's chrome/edge recipes are
  frozen.
- The F1a/F1b canvas behavior does NOT regress: `TeamCanvas.test.tsx`,
  `TeamCanvas.authoring.test.tsx`, `TeamCanvas.affordances.test.tsx`, and `App.addDownstream.test.tsx`
  stay green (unchanged unless a legitimate DOM re-point is forced — if so, re-point, don't gut).
- "Extend never replaces": consume the design tokens from `frontend/src/design-system/tokens/
  extend.css` — do NOT edit any base token file. Everything F1c needs is ALREADY in `extend.css`:
  `--drawer-w: 384px`, `--shadow-drawer`, `--shadow-pop`, `--surface-overlay`, the keyframes
  `tv-pop-in` (drawer), `tv-modal-in` (modal), `tv-fade-in` (scrim), `tv-blink` (feed cursor), the
  warm scrollbars, and the reduced-motion guard. Consume them; do not redefine.

Floors: backend **328** pytest (FE-only, must not regress), vitest **172** (rises — set the new floor
in `STATE.md`; never below 172).

---

## GROUND TRUTH — the two live panels you are reskinning

Both panels today use the `.tv-panel` class family (a 400px push panel, `frontend/src/panel.css`).

1. **`frontend/src/panel/TeamNodePanel.tsx` — the AUTHOR panel** (shown when a node is selected on the
   editable team canvas). Edits an agent/completion node: a Capability segmented control, a Prompt
   textarea, a branch-worker Output-contract block, the **Slice-C provider/model picker** (a Provider
   `<select>` + an inline "Add a provider" form reusing `POST /api/providers` + a Model text input with
   datalist quick-picks + a same-model recommendation hint), a Save bar, and a read-only "Last run"
   brief. **It currently only handles agent/completion nodes.**

2. **`frontend/src/panel/SidePanel.tsx` — the RUN-view panel** (shown when a node is selected during a
   run). Renders the shared "Last run" brief (`components/LastRun.tsx`, styled `.tv-verdict*`) + a
   kind-specific body: a thinker (`kind === "completion"`) → `PrdView.tsx` (the live-editable shared
   spec); a worker (`kind === "agent"`, incl. a reviewer) → `EventFeed.tsx` (the action/observation
   feed).

App wiring (`frontend/src/App.tsx`): `authoring = runId === null`. In author mode it renders
`<TeamNodePanel>` (selection state `selectedNodeId`); in run mode `<SidePanel>` (selection state
`selectedRunNodeId`). The canvas (`frontend/src/canvas/TeamCanvas.tsx`, `onNodeClick` ~L400) currently
fires selection ONLY for `agent`/`completion` nodes and DESELECTS on gate/terminal.

---

## THE FOUR LOCKED DECISIONS (build exactly these)

### Decision 1 — the dock⇄pop-up toggle is STICKY, session-level
- Add a single `panelMode: "drawer" | "modal"` state in `App.tsx` (default `"drawer"`) + an
  `onTogglePanelMode`. Pass BOTH into whichever panel is showing (author or run). Flipping it is a
  session-wide viewing preference — it does NOT reset when you close a panel or select another node.
  It is NOT persisted to the backend and resets to `"drawer"` on reload (no backend field — the wall).
- **drawer mode:** the panel is a flex child of `<main>` as today — width `--drawer-w` (384px),
  `border-left` hairline, `box-shadow: var(--shadow-drawer)`, animation `tv-pop-in` (reduced-motion:
  none). Push layout (canvas shrinks).
- **modal mode:** the panel is `position: fixed`, centered, `width: min(560px, 92vw)`, `max-height:
  86vh`, `border-radius: 16px`, `box-shadow: var(--shadow-pop)`, animation `tv-modal-in .2s
  var(--ease-out)` — PLUS a fixed click-to-close scrim behind it (`inset: 0`, `background:
  color-mix(in srgb, var(--ink-900) 30%, transparent)`, animation `tv-fade-in`; clicking it closes
  the panel). In modal mode the canvas is full-width behind the scrim.
- **Header toggle button** (left of the ✕): icon + title flip with the mode — `#i-expand` / "Open as
  a pop-up" when docked, `#i-dock-right` / "Dock to the side" when popped. (Reuse the design's inline
  SVG `use` symbols, or the closest lucide icons already imported — Maximize2 / PanelRight or similar.)
- **UX:** a small expand icon in the drawer header; click it → the panel lifts out of the side into a
  centered pop-up over a dimmed canvas (click the dim area or the dock icon to snap it back). The
  choice holds for the rest of the session; a refresh starts docked.

**Recommended structure:** extract a shared shell `frontend/src/panel/DrawerShell.tsx` that renders the
drawer-or-modal chrome + the scrim + the header (a glyph badge + a display-font title + a subtitle +
the toggle + the close), taking `{ glyph, title, subtitle, panelMode, onTogglePanelMode, onClose,
children }`. Both `TeamNodePanel` and `SidePanel` wrap their body in it, so the toggle/mode logic lives
in ONE place. (If you keep them separate instead, both must still match pixel-for-pixel.)

### Decision 2 — the run-view keeps its CAPABILITY-based split (do NOT follow the mockup's roles)
The mockup splits the run-view by role (PM/Engineer/Reviewer). We do NOT — the Tvashtr-25 pivot
retired privileged roles (identity follows the prompt). Keep the LIVE split:
- a **thinker** (`kind === "completion"`) → `PrdView` (the live-editable shared spec), ANY thinker;
- a **worker** (`kind === "agent"`, incl. a reviewer) → `EventFeed` (its action/observation feed);
- EVERY node shows the shared "Last run" brief on top — for a reviewer, that brief IS its verdict
  history (approved / changes_requested + reasons). Reskin `components/LastRun.tsx`'s `.tv-verdict*`
  recipe + `PrdView` + `EventFeed` to the drawer look. Do NOT build a role-gated reviewer view.
- **One upgrade taken from the design:** the run-view drawer SUBTITLE becomes STATUS-based. Map the
  node's live run status → the label: `running → "Working now"`, `done → "Finished"`, `idle/unreached
  → "Not reached yet"`, `failed → "Failed"`, `stopped → "Stopped"` (fallback `"Inspector"`). Use the
  same status the node card already derives (`lib/status.ts` / the run graph) — do not invent a new
  source. (The author-view agent subtitle stays "Its prompt is its whole identity — edit, then run".)

### Decision 3 — the node card's model chip is the express lane to the Model field (author-mode only)
- The node card's model footer (`frontend/src/canvas/AgentNodeCard.tsx`, the
  `<button className="rf-node__model">` F1a left inert) gets an onClick — **author mode only** (read
  `editable` from `authoringContext`; in run mode it stays a static, non-clickable label).
- Clicking it: select that node AND open the author drawer **scrolled to + briefly highlighting** the
  Model section. Thread a new `onOpenModel(nodeId)` callback through `frontend/src/canvas/
  authoringContext.ts` (alongside the existing affordance callbacks) → `TeamCanvas` → `App`.
  `App` handles it by setting `selectedNodeId` + a focus signal it passes to `TeamNodePanel` (e.g. a
  `focusModel` prop, or a bumping nonce so re-clicking an ALREADY-open node still re-scrolls — handle
  that edge case). `TeamNodePanel` on that signal scrolls the Model field into view + adds a transient
  highlight class (fading outline), cursor ready.
- Reuse the EXISTING Slice-C picker as-is — the chip just opens the drawer focused on it. Do NOT build
  a second floating mini-picker on the canvas.
- Reskin the picker to the design's layout: a fixed-width (~130px) Provider `<select>` beside a
  flex-1 Model `<input>` (monospace), on the premium field surfaces. Keep the inline "Add a provider"
  form + the same-model recommendation hint working (same `POST /api/providers`, same behavior).
- **UX:** on the canvas, click the small `openai/gpt-4o` chip at the bottom of a card → the config
  drawer slides in with the Model field scrolled into view and briefly outlined. Clicking the rest of
  the card still opens the drawer at the top (prompt first) as before.

### Decision 4 — gate/terminal open the author drawer READ-ONLY (Path A; the wall holds)
DISK FINDING (verified this session): the node-update endpoint `PATCH /api/teams/{id}/nodes/{node_id}`
(`backend/tvashtr/routers.py`, `update_team_node`) **409-rejects gate/terminal nodes** ("control
primitives — no prompt/model to edit"), and a terminal's `terminal_kind` ("ship"/"stop") is written
ONLY at create-time into the node's `config` jsonb. So there is NO existing way to persist a ship↔stop
flip or gate-copy edit — that would need a backend change, which THE WALL forbids this slice.

Therefore, FRONTEND-ONLY:
- **Change the canvas selection filter** (`TeamCanvas.tsx`, `onNodeClick`): in AUTHOR mode (`editable`)
  a gate OR terminal click now fires `onSelectNodeId?.(node.id)` (today it deselects). **RUN mode is
  UNCHANGED** — gate/terminal stay non-selecting in a run; gate approvals stay in the left Tasks
  drawer. (Do not add a run-view gate/terminal drawer.)
- **`TeamNodePanel` branches on `node.kind`:** agent/completion → the existing editor; **gate** → a
  READ-ONLY view (subtitle "A human checkpoint"): show its title + description from `node.config`
  (read-only fields, no Save), with a quiet note that editing gate copy is a planned backend follow-on
  (mirror the mockup's `showConfigGate` block); **terminal** → a READ-ONLY view (subtitle "An endpoint
  of the flow"): show its Ship/Stop state + what it means (a disabled/read-only Ship·Stop indicator,
  NOT a working toggle — persisting it is deferred). Header glyph = the node's own card glyph
  (shield / package etc.).
- Persisting ship↔stop + gate-copy is a §15 BACKEND follow-on (not this slice). Do NOT delete+recreate
  a terminal to fake a flip.
- **UX:** clicking a gate or terminal now OPENS the premium drawer (today it opens nothing) — showing
  the gate's title/description or the terminal's Ship/Stop meaning, read-only, with a "editing this is
  coming" note. To actually change a terminal, delete it and drop the other from the palette, then
  reconnect the one arrow (F1b already supports this).

---

## FILE PLAN (self-decompose; this is the shape, not a script)
- `frontend/src/panel/DrawerShell.tsx` (new, recommended) — the shared drawer/modal chrome + scrim +
  header (glyph, title, subtitle, toggle, close).
- `frontend/src/panel/TeamNodePanel.tsx` — wrap in DrawerShell; reskin the picker to provider+model;
  add the read-only gate + terminal branches; the model-focus behavior.
- `frontend/src/panel/SidePanel.tsx` — wrap in DrawerShell; status-based subtitle; keep the
  capability-based body.
- `frontend/src/panel/PrdView.tsx`, `EventFeed.tsx`, `components/LastRun.tsx` — reskin to the drawer
  look (class/recipe changes only; behavior unchanged).
- `frontend/src/App.tsx` — `panelMode` state + `onTogglePanelMode` + the model-focus signal, threaded
  to the panels. No other structural change.
- `frontend/src/canvas/TeamCanvas.tsx` — selection filter (author-mode gate/terminal) + thread
  `onOpenModel`.
- `frontend/src/canvas/AgentNodeCard.tsx` — wire the model chip's onClick (author only). **No CSS
  change** (`.rf-node__model` already exists from F1a).
- `frontend/src/canvas/authoringContext.ts` — add the `onOpenModel` callback.
- `frontend/src/panel.css` — the reskin: `.tv-panel` → 384px drawer (`--shadow-drawer`, `tv-pop-in`);
  a modal variant (`--shadow-pop`, `tv-modal-in`) + a scrim (`tv-fade-in`); the header glyph badge +
  toggle recipes; the provider+model picker layout; the drawer-look run-view; the read-only
  gate/terminal blocks. Consume F0 tokens; additive only.

## TESTS (mutation-real; co-located `*.test.tsx`, vitest + RTL)
Re-point `panel/SidePanel.test.tsx` + `panel/TeamNodePanel.test.tsx` to the new DOM (don't gut — keep
the real behavioral assertions). Add:
- the toggle: clicking it flips drawer→modal (a scrim appears) and back; the mode STAYS across a
  close/reopen and across selecting a different node (sticky); a fresh mount starts docked.
- the gate/terminal read-only author view: selecting a gate opens the drawer showing its
  title/description read-only with NO Save control; a terminal shows Ship/Stop read-only (no working
  toggle); assert no `updateTeamNode`/PATCH is ever fired from these views.
- the model chip: in author mode, clicking `.rf-node__model` selects the node + the drawer opens
  focused on the Model field (assert the focus/scroll target or the highlight class); in run mode the
  chip has no click handler.
- the status-based run-view subtitle: a running node → "Working now"; a done node → "Finished"; an
  unreached node → "Not reached yet".
- FE-testing gotchas: user-event ⊥ vitest fake timers → prefer `fireEvent`; React Flow needs the
  `frontend/src/test/setup.ts` shims (already present).

## PLAYWRIGHT SELF-SIGN-OFF (you run it; screenshots per check)
Bring up the stack (`make backend` bg + `make frontend`), log in as the seeded operator, open a
library team with a branching shape (e.g. the seeded team with a PM / Engineer / Reviewer / a gate /
a Ship). Use targeted `browser_evaluate` on specific selectors + screenshots — the whole-canvas a11y
snapshot HANGS on React Flow, do NOT use it. Capture:
1. the author drawer (docked) on the node labeled **Engineer** — the premium 384px look.
2. the dock⇄pop-up toggle: click it → the centered pop-up over the dimmed scrim; click the scrim →
   back to docked.
3. the model chip: click the model chip on the **Engineer** card → the drawer opens with the Model
   field scrolled into view + highlighted.
4. selecting the **gate** node and the **Ship** node → the read-only drawer for each.
5. run-view: launch a short run (or open an existing run) → select a running/finished node → the
   status subtitle + the reskinned spec/feed.
Save screenshots under `scratchpad/f1c-screenshots/` and record the paths in `STATE.md`.

## DEFINITION OF DONE
`make test` green (≥328 backend), `make lint` clean, `make test-frontend` green (new vitest floor
≥172 recorded), `make build-frontend` (tsc-strict + vite) green, the Playwright screenshots captured,
the WALL diffs proven EMPTY (`api.ts`, `backend/`, `canvas.css`) with the alembic head still `0018`,
`STATE.md` updated with the branch + sha + floors + screenshot paths + `READY_TO_MERGE`, and the §4.7
8-section FINAL REPORT emitted. Echo each decisive evidence line into the transcript as you go.
