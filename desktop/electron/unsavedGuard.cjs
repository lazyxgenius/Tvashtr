/**
 * Unsaved agent edits on window close / reload / quit (panel.md §4 item 1, PANEL-21).
 *
 * Electron never shows the browser's own "Leave site?" prompt, so the renderer reports its state
 * with `tvashtrDesktop.app.setUnsavedChanges({dirty, agentName})` and the main process asks with a
 * native dialog: "Keep editing" (default, Esc) or "Discard and close".
 */
const KEEP_EDITING = 0;
const DISCARD = 1;

/** @param {unknown} raw @returns {{ dirty: boolean, agentName: string | null }} */
function normaliseUnsaved(raw) {
  const r = raw && typeof raw === "object" ? /** @type {any} */ (raw) : {};
  const name = typeof r.agentName === "string" ? r.agentName.replace(/\s+/g, " ").trim() : "";
  return { dirty: r.dirty === true, agentName: name ? name.slice(0, 80) : null };
}

/** @param {{ agentName: string | null }} state */
function unsavedDialogOptions(state) {
  return {
    type: /** @type {const} */ ("question"),
    buttons: ["Keep editing", "Discard and close"],
    defaultId: KEEP_EDITING,
    cancelId: KEEP_EDITING,
    noLink: true,
    message: state.agentName
      ? `You have unsaved changes to ${state.agentName}.`
      : "You have unsaved changes to an agent.",
    detail: "If you close now, those changes are lost.",
  };
}

function createUnsavedGuard() {
  let state = normaliseUnsaved(null);
  return {
    set(raw) {
      state = normaliseUnsaved(raw);
    },
    get: () => ({ ...state }),
    isDirty: () => state.dirty,
    clear() {
      state = normaliseUnsaved(null);
    },
    /**
     * May the window close / the app quit? Asks only when dirty.
     * @param {(options: ReturnType<typeof unsavedDialogOptions>) => number} ask
     *   shows the dialog and returns the clicked button index
     */
    confirmDiscard(ask) {
      if (!state.dirty) return true;
      if (ask(unsavedDialogOptions(state)) !== DISCARD) return false;
      state = normaliseUnsaved(null);
      return true;
    },
  };
}

module.exports = {
  createUnsavedGuard,
  normaliseUnsaved,
  unsavedDialogOptions,
  KEEP_EDITING,
  DISCARD,
};
