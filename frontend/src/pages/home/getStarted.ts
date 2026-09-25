/**
 * The get-started checklist's shared state (TEAMS-56, TEAMS-70–74): whether the account has hidden
 * it (saved per account on the server) and whether Home is showing its first-time layout right now
 * (the shell hides the nav badges then). The account menu's "Show get-started checklist" and the
 * Home page read the same store.
 *
 * When Home shows the checklist (spec §4.6 Q13/14): the checklist isn't hidden and the account has
 * no runs yet. Once shown in this browser it stays until hidden, so a new user sees their progress
 * through steps 3 and 4 instead of the checklist vanishing at the first run.
 */
import { useSyncExternalStore } from "react";

import { getAccountPreferences, patchAccountPreferences } from "../../lib/api/teams";

export interface GetStartedState {
  /** null until the preference has loaded (or when it couldn't be loaded). */
  hidden: boolean | null;
  /** Home is showing the first-time layout. */
  firstTime: boolean;
}

const SHOWN_KEY = "tv.home.getStarted.shown";

let state: GetStartedState = { hidden: null, firstTime: false };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<GetStartedState>): void {
  const merged = { ...state, ...next };
  if (merged.hidden === state.hidden && merged.firstTime === state.firstTime) return;
  state = merged;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useGetStarted(): GetStartedState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Load the preference once (later calls share the first request). */
export function loadGetStarted(): Promise<void> {
  if (!loading) {
    loading = getAccountPreferences()
      .then((p) => set({ hidden: Boolean(p.get_started_hidden) }))
      .catch(() => {
        loading = null;
      });
  }
  return loading;
}

/** Was the checklist already shown in this browser (so it stays through steps 3 and 4)? */
export function checklistWasShown(): boolean {
  try {
    return window.localStorage.getItem(SHOWN_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberShown(shown: boolean): void {
  try {
    if (shown) window.localStorage.setItem(SHOWN_KEY, "1");
    else window.localStorage.removeItem(SHOWN_KEY);
  } catch {
    // storage blocked: the checklist then follows the no-runs rule only
  }
}

export function setFirstTime(active: boolean): void {
  if (active) rememberShown(true);
  set({ firstTime: active });
}

/** Hide or bring back the checklist. Optimistic; rolls back and rethrows when the save fails. */
export async function setGetStartedHidden(hidden: boolean): Promise<void> {
  const before = state.hidden;
  set({ hidden });
  rememberShown(!hidden);
  try {
    const saved = await patchAccountPreferences({ get_started_hidden: hidden });
    set({ hidden: Boolean(saved.get_started_hidden) });
  } catch (err) {
    set({ hidden: before });
    throw err;
  }
}

/** Test seam. */
export function __resetGetStartedForTests(): void {
  state = { hidden: null, firstTime: false };
  loading = null;
  listeners.clear();
  rememberShown(false);
}
