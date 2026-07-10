# Canvas Fidelity — Pass 1: the screen chrome (header + toolbar + rail) + the drawer

**What this is.** A faithful reconciliation of the Tvashtr **canvas screen shell** + the **config drawer**
to the design file. The F1 canvas work reskinned the canvas *interior* (nodes/edges/drawer) but never
built the design's screen shell (header, toolbar, the left side), and the drawer shipped with a CSS
class collision. This pass fixes all of that. **The exact spec is the design file** —
`design/Tvashtr Frontend Overhaul/Canvas.dc.html`. OPEN IT and read the `HEADER`, `TOOLBAR`, `MAIN`
(the left-side comment), and `RIGHT DRAWER` sections. The key measurements are also inline below.

**Frontend-only.** No backend, no API, no migration. This pass touches the **app shell** (`App.tsx` +
app-level CSS in `index.css`) and the **drawer** (`panel.css` + `TeamNodePanel.tsx`). It does NOT
touch the canvas interior (nodes/edges/affordances = a later pass) — so `canvas.css` stays frozen.

Self-decompose the steps. Branch `feat/canvas-fidelity-1` off `main`.

---

## THE WALL (prove on disk, all EMPTY vs main)
- `git diff main -- frontend/src/lib/api.ts` → EMPTY (no API change).
- `git diff main -- backend/` → EMPTY (frontend-only). Alembic head stays **0018**; create NO migration.
- `git diff main -- frontend/src/canvas.css` → EMPTY (the node/edge interior is a later pass; the shell
  CSS lives in `index.css`, the drawer CSS in `panel.css`).
- `git diff main -- frontend/src/components/Dashboard.tsx` → EMPTY (team delete / template-create are
  deferred to F2 — do NOT change the dashboard here).
- Consume the DS tokens (`design-system/tokens/`); edit NO base token file. No ad-hoc hex.

Floors: backend **328** pytest (must not regress — FE-only), vitest **179** (rises — set the new floor
in `STATE.md`; never below 179).

---

## GROUND TRUTH — what the live app renders today (to change)
`frontend/src/App.tsx` renders the whole canvas screen:
- A **header** (`<header>`): the Tvashtr mark + "Tvashtr" + "the living canvas" on the left; on the
  right the raw **user email + a "Log out" button + `<BackendDot/>`** (the green dot). An optional
  "← Dashboard" button sits on the LEFT of the header when `onBackToDashboard` is set.
- A **toolbar** row: a `.tv-seg` **Single run | A/B compare** toggle, then the **Run this team** button
  (author) / Edit + Cancel + `<RunBanner>` (run), then a line of **hint text** ("Drag from a node's
  edge to wire it…"), then the validity warning.
- The **MAIN** flex row: in author mode the **`<TeamsRail>`** ("Your teams" + team list + "New team")
  on the left; in run mode the `<TasksDrawer>` on the left; the canvas in the middle; the right panel.

The design (`Canvas.dc.html`) is different on all three of the header, toolbar, and left side. Match it.

---

## PART A — remove the author-mode team rail
The design's `MAIN` comment says it in words: **"team library lives on the Dashboard."** In AUTHORING
there is NO left rail — the canvas is full-width. A left panel appears ONLY during a run (the tasks
drawer, which stays as-is this pass).
- In `App.tsx`, stop rendering `<TeamsRail>` in the author branch. The canvas viewport takes the full
  width while authoring. (`TeamsRail.tsx` may stay in the tree unused, or be removed from this screen —
  your call; do NOT delete the component file if other things import it.)
- Team selection now comes ONLY from the dashboard (the existing `teamId` / `onOpenTeam` flow — already
  wired). The toolbar's back arrow (Part C) returns to the dashboard. Do NOT add team management to the
  dashboard here (F2 owns that; the dashboard already lists/opens/creates teams).
- Remove any now-dead rail handlers from `App.tsx` (`handleSelectTeam`, etc.) only if they become truly
  unused — don't leave lint errors.

## PART B — the header (match the design)
Design header, right side = a single **avatar button** that opens a **profile menu** (NOT the raw email
+ Log out text). Specs from `Canvas.dc.html`:
- **Avatar button:** 34×34, `border-radius:50%`, `border:1px solid var(--coral-200)`, `background:
  var(--coral-100)`, `color:var(--coral-700)`, display font 15px — showing the user's **initial** (first
  letter of `user.email`, uppercased). Click toggles the menu.
- **Profile menu** (on click): a 236px card — `padding:7px; border-radius:13px; border:1px solid
  var(--border-hairline); background:var(--surface-card); box-shadow:var(--shadow-pop); animation:
  tv-pop-in .14s var(--ease-out)`, anchored `right:0; top:calc(100% + 9px)`, with a full-screen
  click-catcher behind it to dismiss. Contents: a row with a 36px avatar + the user's **email**
  (ellipsis), a hairline divider, then a **Log out** row (a logout icon + "Log out") that calls
  `onLogout`. (The design mock shows a name + email; we only have the email — show the email as the
  primary line; skip the invented name.)
- Keep the left side (mark + "Tvashtr" + "the living canvas") as-is.
- The green backend dot **moves OUT of the header** to the toolbar's right cluster (Part C) — so
  `<BackendDot/>` no longer renders in the header.

## PART C — the toolbar (match the design)
Design toolbar = `display:flex; align-items:center; gap:14px; padding:9px 20px; border-bottom:1px solid
var(--border-hairline); background:var(--surface-card); flex-wrap:wrap`. Left-to-right:
1. **Back-to-dashboard arrow** (always, when `onBackToDashboard` is set — it is, coming from the
   dashboard): a 36×36 square button, `border:1px solid var(--border-hairline); background:
   var(--surface-card); color:var(--text-secondary); border-radius:8px`, an arrow icon flipped
   horizontally (`transform:scaleX(-1)` — points left). Calls `onBackToDashboard`. (This REPLACES the
   header's "← Dashboard" text button — remove that from the header.)
2. **Author mode:** the **Run this team** button — `height:36px; padding:0 18px; border-radius:8px;
   background:var(--accent); color:var(--accent-contrast)`, a play glyph + "Run this team". Then the
   **Single run | A/B compare** toggle — a pill group `gap:2px; padding:3px; background:var(--panel-300);
   border:1px solid var(--border-hairline); border-radius:999px`; each item a 26px pill; the ACTIVE one
   `color:var(--coral-700); background:var(--surface-card); border:1px solid var(--coral-200)`, the
   inactive `color:var(--text-secondary)`, no border. (Order: **Run first, then the toggle** — the
   reverse of today.)
3. **Run mode:** keep the existing Edit this team + Cancel run + run banner controls; restyle to match
   the design's run-mode toolbar (`Canvas.dc.html`, the `isRun` block) — a bordered "Edit this team", a
   danger-tinted "Cancel run", and the status banner.
4. **Right cluster** (`margin-left:auto; display:flex; align-items:center; gap:14px`): the **spend**,
   always shown — `<span style="font-family:var(--font-code)">${cost}</span>` (the run's total cost, or
   **$0.00** when nothing is running) — then a 1px×18px hairline divider, then the **green status dot**
   (the `<BackendDot/>`, moved here): an 8px sage dot `box-shadow:0 0 0 3px var(--sage-100)`.
   - **OMIT the grid icon** the design shows in this cluster (it's a static icon with a mismatched
     tooltip and no function) — operator-confirmed.
5. **Remove the always-on hint text** ("Drag from a node's edge…") — the design has no such line.
6. Keep the **validity warning** (why Run is disabled) as a functional element, but styled compact and
   unobtrusive so it doesn't fight the clean toolbar (e.g. a small inline warning under/next to Run when
   `!teamRunnable`). Don't drop it — it's the only signal for a blocked launch.

Put the new shell CSS in `index.css` (a `.tv-topbar` / `.tv-toolbar` / `.tv-avatar` / `.tv-avatarmenu`
family, or similar) — NOT in `canvas.css` (frozen) and NOT in `panel.css` (the drawer). Tokens only.

## PART D — the drawer (fix the collision + align to the design)
1. **THE COLLISION (root cause, confirmed):** the drawer's Model row uses the class **`.tv-picker`**
   (`panel.css` ~L446 + `TeamNodePanel.tsx`), but `.tv-picker` is ALREADY owned by the canvas's floating
   "add a node" popover in `canvas.css` (`position:absolute; z-index:16; width:228px; max-height:62%`).
   Both stylesheets load, so the drawer's Model row inherits "detach and float" and escapes to the
   bottom of the window (the floating box), leaving only the MODEL heading + Save in the drawer. **FIX:**
   rename the drawer's Model-row classes to a unique, non-colliding name — `.tv-picker` → **`.tv-modelrow`**,
   `.tv-picker__provider` → **`.tv-modelrow__provider`**, `.tv-picker__model` → **`.tv-modelrow__model`**
   — in BOTH `panel.css` AND `TeamNodePanel.tsx`. Do NOT touch `canvas.css`'s `.tv-picker` (that's the
   node popover, correct as-is). Result: the provider `<select>` (130px) + the model `<input>` (flex-1)
   sit INLINE, side by side, under the MODEL heading, inside the drawer body.
2. **COLLISION SWEEP:** confirm no OTHER class name is shared between `panel.css` and `canvas.css`
   (and `index.css`). Echo the check into the transcript (e.g. the intersection of the `.tv-*` class
   names in `panel.css` vs `canvas.css` must be EMPTY after the rename). Rename any others found.
3. **Align the author drawer to the design** (`Canvas.dc.html`, the `showConfigAgent` block): the prompt
   section heading is **"System prompt"** (not "Prompt"); its hint reads like the design's **"Its whole
   identity. The run appends the idea and the live PRD on top."**; keep the section order Capability →
   System prompt → (Output contract, reviewer only) → Model (inline row) → Save → Last run; match the
   design's spacing/labels. Everything else in the drawer (the capability toggle, the contract block,
   the inline add-a-provider, the recommendation hint, Save, the Last-run brief, the read-only
   gate/terminal views, the run-view, the dock⇄pop-up toggle + scrim) is already built — keep it working,
   just fix the collision + the copy/labels.

---

## TESTS (mutation-real; co-located `*.test.tsx`, vitest + RTL)
Re-point the existing `App.test.tsx` tests to the new shell DOM (the header/toolbar/rail changed) — do
NOT gut the real assertions (the sticky-toggle test, the gate read-only drawer test, etc. must still
pass, adjusted for the new structure). Add:
- **No author rail:** in author mode, the "Your teams" rail is ABSENT (assert the rail's text/testid is
  not in the document while authoring); in run mode the tasks drawer still renders.
- **Header avatar menu:** the header shows an avatar button (the email's initial), no raw email text +
  no "Log out" button until the avatar is clicked; clicking it reveals the email + a "Log out" control
  that calls `onLogout`.
- **Toolbar:** author mode shows Run this team + the Single/A-B toggle (Run before the toggle) + the
  back arrow + the spend ("$0.00" with no run) + the status dot; the old hint line is gone.
- **Drawer Model row not floated:** the provider `<select>` and the model `<input>` are both inside the
  drawer body (same panel container), and the class `tv-picker` no longer appears on the drawer's model
  row (the new `tv-modelrow` is present). Assert the provider+model still compose `node.model` on Save
  (keep the existing Slice-C assertion green).
- FE gotchas: prefer `fireEvent` over user-event with fake timers; React Flow needs the existing
  `src/test/setup.ts` shims.

## PLAYWRIGHT SELF-SIGN-OFF (you run it; a screenshot per check → `scratchpad/canvas-fidelity-1/`)
Bring up the stack (`make backend` bg + `make frontend`), log in as the seeded operator
(`operator@tvashtr.local` / `tvashtr-dev`), open a team from the dashboard. Targeted `browser_evaluate`
on specific selectors + screenshots — NOT the whole-canvas a11y snapshot (it HANGS on React Flow).
Capture, and eyeball each against `Canvas.dc.html`:
1. The **author canvas**: full-width, **NO left "Your teams" rail**, the new header (avatar top-right)
   + the new toolbar (back arrow, Run, Single/A-B toggle, and on the right the spend + green dot).
2. The **profile menu** open (click the avatar): the email + a Log out row.
3. A node's **author drawer** open on the **Engineer** node: the Model row is a clean **inline
   provider-select + model-input under the MODEL heading — NO floating box anywhere on the page**, and
   the prompt heading reads "System prompt".
4. The collision-sweep result (paste the empty-intersection check into the transcript).
Record the screenshot paths in `STATE.md`.

## DEFINITION OF DONE
`make test` green (≥328 backend — quote the passed line), `make lint` clean, `make test-frontend` green
(new vitest floor ≥179, recorded + quoted), `make build-frontend` (tsc-strict + vite) green, the
Playwright screenshots captured, the WALL diffs proven EMPTY (`api.ts`, `backend/`, `canvas.css`,
`Dashboard.tsx`) with head still `0018`, the panel↔canvas class-collision intersection EMPTY, `STATE.md`
updated with the branch + sha + floors + screenshot paths + a `READY_TO_MERGE` line, and the §4.7
8-section FINAL REPORT emitted. Echo each decisive evidence line into the transcript as you go.
