# Filler-A — Modal accessibility: a shared focus-trap for the scrim dialogs (FE-only)

## Mission
Every scrim-overlay dialog in the app declares it's modal but doesn't behave modally: focus can leak to the page behind it, Escape doesn't close it, and closing it doesn't return focus to whatever opened it. Add ONE shared focus-trap hook and wire it into the three scrim-modal surfaces so keyboard and screen-reader users stay inside the dialog and land back where they started.

This is a self-contained FRONTEND-ONLY task. It touches NO backend, NO Python, NO migration, NO `.css` file. It runs fully offline (no NIM, no backend needed for the vitest suite).

## The exact surfaces (there are THREE, and only three)
Read each before editing:

1. **`frontend/src/components/NewTeamDialog.tsx`** — renders `<div className="tv-scrim" onClick={onClose} aria-hidden />` + a `<div role="dialog" aria-modal="true" aria-label="New team">` card. Always modal. Has `onClose`.
2. **`frontend/src/components/Dashboard.tsx`** — the delete-confirm dialog (search for `confirmTeam &&`, ~line 428): the SAME `.tv-scrim` + `<div role="dialog" aria-modal="true">` pattern, closed via `setConfirmTeam(null)`. Always modal. (Dashboard already imports `useRef`/`useEffect`.)
3. **`frontend/src/panel/DrawerShell.tsx`** — the SHARED config-drawer chrome wrapped by BOTH the author panel (`TeamNodePanel`) AND the run-view panel (`SidePanel`), so fixing it here fixes both drawers. It has TWO modes (`panelMode: "drawer" | "modal"`). In `"modal"` mode it renders `<div className="tv-scrim" onClick={onClose} aria-hidden />` + the `<aside className="tv-panel tv-panel--modal" aria-label={ariaLabel}>` shell. Has `onClose`.

**NOT in scope — do NOT touch:** `frontend/src/components/LaunchPanel.tsx`. It is `role="dialog"` but a DOCKED panel with NO `.tv-scrim` and NO `aria-modal` — trapping focus in a non-modal docked panel is WRONG. Leave it exactly as is.

## The ONE rule that governs DrawerShell (critical)
DrawerShell's `"drawer"` (docked) mode is NOT a modal — it pushes the canvas aside and the canvas behind stays intentionally interactive. **Trap focus / set `aria-modal` / Escape-to-close ONLY in `"modal"` mode.** In docked mode the hook is inert and DrawerShell's behavior is byte-unchanged. (NewTeamDialog + the delete-confirm are always modal, so their trap is always active.)

## What to build

### 1. The shared hook — `frontend/src/lib/useModalDialog.ts` (new file)
A hook `useModalDialog(active: boolean, onClose: () => void)` returning a `ref` (a `RefObject<HTMLElement>`) to attach to the dialog's container element. Behavior, in a single effect keyed on `active`:

- **On activate** (`active === true`): capture `document.activeElement` as the element to restore later. Focus the first focusable descendant of the container; if there are none, set `tabIndex = -1` on the container and focus it.
- **While active**: a `keydown` listener (on the container) that:
  - **Escape** → `event.preventDefault()` + `onClose()`.
  - **Tab** → compute the focusable descendants in DOM order (a standard selector: `a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])`, filtered to visible/enabled). If `Shift+Tab` and focus is on the first (or outside) → focus the LAST + `preventDefault()`. If `Tab` and focus is on the last (or outside) → focus the FIRST + `preventDefault()`. (This is the wrap; jsdom won't tab natively, so the handler must implement the wrap explicitly — this is what makes it testable.)
- **On deactivate / unmount** (cleanup): remove the listener; restore focus to the captured element IF it is still in the document and is an `HTMLElement` (guard for null / detached).

Keep it pure React + DOM (no deps). Document it briefly.

### 2. Wire it into the three surfaces
- **NewTeamDialog**: `const dialogRef = useModalDialog(true, onClose);` attach `ref={dialogRef}` to the `role="dialog"` card. (Always active.)
- **Dashboard delete-confirm**: `const confirmRef = useModalDialog(confirmTeam != null, () => setConfirmTeam(null));` attach `ref={confirmRef}` to the delete-confirm `role="dialog"` card. (Active only while the dialog is mounted — passing `confirmTeam != null` is belt-and-suspenders since the block is conditionally rendered.)
- **DrawerShell**: `const shellRef = useModalDialog(isModal, onClose);` attach `ref={shellRef}` to the `<aside>` shell. ALSO add `role="dialog"` + `aria-modal={isModal || undefined}` to the `<aside>` **only in modal mode** (docked mode keeps NO role/aria-modal — unchanged). Because the same `<aside>` renders in both modes, gate the added attributes on `isModal` (e.g. spread `{...(isModal ? { role: "dialog", "aria-modal": true } : {})}`).

Do NOT change any dialog's visual markup, classes, copy, or existing behavior beyond attaching the ref + (DrawerShell only) the two conditional ARIA attributes.

## Hard invariants (checkable on disk)
1. **FE-only.** `git diff main -- backend/` is EMPTY. No Python, no migration, no `alembic/` change.
2. **No `.css` file touched.** `git diff main -- '*.css'` is EMPTY (reuse existing classes / attributes; ARIA needs no CSS). This keeps the parallel Filler-B session collision-free.
3. **Only these files change:** the new `frontend/src/lib/useModalDialog.ts` (+ its test), `NewTeamDialog.tsx`, `Dashboard.tsx`, `DrawerShell.tsx`, and the dialog test files. Nothing else. In particular do NOT touch `ToolsShelf.tsx`, `ToolsSection.tsx`, `LaunchPanel.tsx`, or any shared stylesheet (the other parallel session owns ToolsShelf).
4. **DrawerShell docked mode is byte-unchanged** — a docked-mode render produces the same DOM as main (no role, no aria-modal, no trap). Prove it in a test.
5. Branch `feat/a11y-modal-focus-trap` off CURRENT `main` (`adf1f32`, not `2c13d56` — main advanced one docs commit; verify with `git log -1` before work). Never push. Never merge to main.
6. Commit only your own changed files. Leave `prompts/`, `PROJECTPLAN.md`, `HANDOVER.md` alone.

## Acceptance / evidence (echo each into chat as it completes)
- `npm run build` (tsc + vite build) clean — no type errors.
- `npm run test` (vitest) all green, count ≥ 252 + the new tests below, all mutation-real:
  1. **Hook unit test** (`useModalDialog.test.ts(x)`, a tiny harness component): on mount focus moves into the container; `Tab` on the last focusable wraps to the first and `Shift+Tab` on the first wraps to the last (assert `document.activeElement`); `Escape` calls the `onClose` spy; on unmount focus is restored to a button that was focused before mount.
  2. **NewTeamDialog**: Escape calls `onClose`; focus is inside the dialog after render. (Extend `NewTeamDialog.test.tsx`.)
  3. **Delete-confirm**: opening it moves focus in; Escape triggers the close (`setConfirmTeam(null)` path). (Extend `Dashboard.test.tsx`.)
  4. **DrawerShell modal vs docked**: in `panelMode="modal"` the `<aside>` has `role="dialog"` + `aria-modal="true"` and Escape calls `onClose`; in `panelMode="drawer"` the `<aside>` has NEITHER attribute and Escape does NOT close (byte-unchanged docked behavior). (New `DrawerShell.test.tsx`.)
- **Playwright self-sign-off** (bring up the stack on the ports/DB from the launch note — no NIM needed; capture a screenshot per check):
  - Open a team, pop the node config drawer into modal mode → screenshot; press Tab a few times and confirm the focus ring stays within the drawer (screenshot); press Escape → drawer closes (screenshot).
  - Open the New-team dialog → Tab stays inside → Escape closes (screenshots).
  If bringing up the backend is heavy, you MAY intercept the API with Playwright route mocks to reach the dialogs — but the screenshots are required.
- `STATE.md` maintained; final line `READY_TO_MERGE` + the branch tip sha.

## Stop conditions
- This task has NO external-service dependency. If `npm install` / the toolchain / a port is genuinely broken after reasonable retries → write `NEEDS_HUMAN` to `STATE.md` with the exact failure; the offline suite must still be green first.
- Any change that would require touching a backend file, a stylesheet, or `LaunchPanel.tsx` → STOP and write `NEEDS_HUMAN` (it means the plan was wrong; do not expand scope).
- Hard cap: 30 turns.
