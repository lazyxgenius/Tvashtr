/**
 * What has unsaved edits right now (an agent's draft, a live edit of the shared spec). Tvashtr
 * Desktop keeps ONE flag for its close / quit guard, so each source reports here and the bridge
 * hears the OR: an edit that ends never clears another that is still open. A no-op on the website.
 */
const dirty = new Map<symbol, string | undefined>();

export function reportUnsaved(source: symbol, state: { dirty: boolean; agentName?: string }): void {
  dirty.delete(source);
  if (state.dirty) dirty.set(source, state.agentName);
  const bridge = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  if (!bridge || typeof bridge !== "object") return;
  // The newest dirty source names the prompt.
  const names = [...dirty.values()];
  bridge.app?.setUnsavedChanges?.(
    names.length > 0 ? { dirty: true, agentName: names[names.length - 1] } : { dirty: false },
  );
}
