/**
 * Desktop Home's ready card (DT-38–41): when it shows, and its data-driven chips (DT-39, OQ-24).
 * Pure helpers plus one hook; the card itself is DesktopReadyCard.tsx.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import type { TeamSummary } from "../../lib/api";
import { listRunsPage } from "../../lib/api/runs";
import { isDesktopApp } from "../../lib/desktopRepos";
import type { DesktopSetup } from "../../lib/desktopSetup";
import type { SubscriptionStatus } from "../../lib/engines";

export const READY_HEADING = "You’re set up. Give your team its first job.";
export const WELCOME_BACK_HEADING = "Welcome back. What’s next?";

/**
 * What the account's agents can run on: plans in use first, else the saved keys (display names of
 * providers that serve a model). Null when nothing can run — the fix lives in Engines (Launch-2).
 */
export function engineChip(plans: SubscriptionStatus[] | null, keyNames: string[]): string | null {
  const inUse = (p: string) => plans?.some((s) => s.provider === p && s.state === "connected");
  const claude = inUse("claude");
  const grok = inUse("grok");
  if (claude && grok) return "Claude and Grok plans connected";
  if (claude) return "Claude plan connected";
  if (grok) return "Grok plan connected";
  if (keyNames.length === 1) return `${keyNames[0]} key saved`;
  if (keyNames.length > 1) return `${keyNames.join(", ")} keys saved`;
  return null;
}

/** The setup's project: the folder, the GitHub repo, or nothing for "Decide at launch". */
export function targetChip(workspace: DesktopSetup["workspace"] | undefined): string | null {
  if (workspace?.kind === "folder") return workspace.displayPath;
  if (workspace?.kind === "github") return workspace.repo;
  return null;
}

/** The newest library team (the one setup just made). */
export function newestTeam(teams: TeamSummary[]): TeamSummary | null {
  let newest: TeamSummary | null = null;
  for (const t of teams) if (!newest || t.created_at > newest.created_at) newest = t;
  return newest;
}

/**
 * DT-38: Desktop Home shows the ready card while the account has no runs. Null while asking; false
 * on the website, and when the runs can't be read (the normal Home says what's wrong).
 */
export function useShowReadyCard(): boolean | null {
  const desktop = isDesktopApp();
  const [show, setShow] = useState<boolean | null>(desktop ? null : false);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    listRunsPage({ limit: 1 })
      .then((page) => {
        if (alive) setShow(Array.isArray(page.runs) && page.runs.length === 0);
      })
      .catch(() => {
        if (alive) setShow(false);
      });
    return () => {
      alive = false;
    };
  }, [desktop]);
  return show;
}

// Whether the ready card is on screen: the Shell's Home foot then introduces Domains, as DT-Ready
// draws it, instead of the shortcuts.
let readyCardShown = false;
const readyCardListeners = new Set<() => void>();

/** The ready card calls this while mounted. */
export function useMarkReadyCardShown(): void {
  useEffect(() => {
    const set = (v: boolean) => {
      readyCardShown = v;
      readyCardListeners.forEach((l) => l());
    };
    set(true);
    return () => set(false);
  }, []);
}

export function useReadyCardShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      readyCardListeners.add(l);
      return () => readyCardListeners.delete(l);
    },
    () => readyCardShown,
    () => false,
  );
}
