/**
 * The nav badges (Home "4", Engines "2 to fix", Toolkit "1 missing", …) — one shared store so every
 * page shows the same numbers. Each area registers a loader that fetches its own counts
 * (`registerBadgeLoader`); `refreshBadges()` runs them all, and a page that just changed something
 * can call it again or push a count it already knows with `publishBadges`.
 */
import { useSyncExternalStore } from "react";

/** Counts shown as nav badges. Anything undefined is simply not shown. */
export interface NavBadges {
  /** Home: items in "Needs you". */
  home?: number;
  /** Engines: (team × surface) pairs that can't run yet. */
  enginesToFix?: number;
  /** Engines › Overview shows "New" before anything is set up. */
  enginesFirstTime?: boolean;
  /** Engines › Subscriptions: "{connected} of {total}". */
  subscriptions?: { connected: number; total: number };
  /** Engines › API keys: saved keys. */
  apiKeys?: number;
  tools?: number;
  skills?: number;
  /** Toolkit › Memory: memories waiting in the Inbox ("N new"). */
  memoryInbox?: number;
  /** Toolkit › Secrets: referenced secrets with no value ("N missing"). */
  secretsMissing?: number;
}

export type BadgeLoader = () => Promise<Partial<NavBadges>>;

let badges: NavBadges = {};
const listeners = new Set<() => void>();
const loaders = new Map<string, BadgeLoader>();

/** Merge counts into the badges (e.g. right after a save that changed them). */
export function publishBadges(partial: Partial<NavBadges>): void {
  badges = { ...badges, ...partial };
  listeners.forEach((l) => l());
}

/** Register (or replace) the loader for one area, keyed by area name. */
export function registerBadgeLoader(area: string, loader: BadgeLoader): void {
  loaders.set(area, loader);
}

/** Run every loader; a failing area keeps its last counts. */
export async function refreshBadges(): Promise<void> {
  await Promise.allSettled([...loaders.values()].map(async (load) => publishBadges(await load())));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNavBadges(): NavBadges {
  return useSyncExternalStore(
    subscribe,
    () => badges,
    () => badges,
  );
}

/** Test seam: clear badges and loaders between tests. */
export function __resetWorkspaceStatusForTests(): void {
  badges = {};
  loaders.clear();
  listeners.clear();
}
