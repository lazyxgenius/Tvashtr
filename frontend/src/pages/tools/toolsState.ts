/**
 * The Tools list's view state for one visit to Toolkit › Tools: the search words and Status filter
 * (kept while you open a tool's detail page, so its breadcrumb returns to the same list), and the
 * ids of tools created during the visit (they float to the top of the list, newest first).
 * `ToolsPage` resets it when you leave for another page.
 */
import { useSyncExternalStore } from "react";

export type StatusFilter = "all" | "ready" | "needs_attention";

export interface ToolsViewState {
  query: string;
  status: StatusFilter;
  /** Tools created during this visit, newest first. */
  freshIds: string[];
}

const INITIAL: ToolsViewState = { query: "", status: "all", freshIds: [] };

let state: ToolsViewState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<ToolsViewState>): void {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function setToolsQuery(query: string): void {
  set({ query });
}

export function setToolsStatus(status: StatusFilter): void {
  set({ status });
}

/** A tool was just created (wizard, paste, duplicate, catalog): float it to the top. */
export function markToolFresh(id: string): void {
  set({ freshIds: [id, ...state.freshIds.filter((x) => x !== id)] });
}

/** Leaving Toolkit › Tools ends the visit. */
export function resetToolsView(): void {
  set(INITIAL);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useToolsView(): ToolsViewState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
