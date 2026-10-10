/**
 * The Desktop bridge's local-folder API (spec §4.6 / plan Phase 2: `repos.pickFolder`, `inspect`,
 * `recent.*`, `prepareRun`). The Desktop slice builds it in parallel, so every method is optional
 * here and every call is optional-chained: an older Desktop (or the website) simply has no folders
 * and the composer says so instead of pretending.
 */

import { displayNameForSubscription, type SubscriptionProviderId } from "./engines";

export interface DesktopFolder {
  path: string;
  displayPath: string;
  branch?: string | null;
  available?: boolean;
}

export type DesktopInspect =
  | {
      is_git: true;
      current_branch: string | null;
      branches: string[];
      tracked_file_count: number;
      subpaths: { path: string; file_count: number }[];
      remote_url?: string | null;
    }
  | { is_git: false; error: string };

export interface DesktopReposBridge {
  pickFolder?: () => Promise<{ path: string; displayPath: string } | null>;
  inspect?: (path: string) => Promise<DesktopInspect>;
  recent?: {
    list?: () => Promise<DesktopFolder[]>;
    add?: (path: string) => Promise<unknown>;
    remove?: (path: string) => Promise<unknown>;
  };
  prepareRun?: (opts: {
    path: string;
    baseRef: string;
    label: string;
  }) => Promise<{ snapshot_id: string }>;
}

/** True inside Tvashtr Desktop (set on <html> by the Electron preload). */
export function isDesktopApp(): boolean {
  return document.documentElement.dataset.tvashtrDesktop === "true";
}

/** M-desk-2 (E2): where a Desktop action runs, as the server routes it: the subscriptions its
 *  models route to and whether every model is on one (read with `?desktop_target=1`). */
export interface DesktopRoutes {
  subscriptions: string[];
  all: boolean;
}

/** `?desktop_target=1` (or `&…`) on a read from Tvashtr Desktop; nothing on the website. */
export const desktopQuery = (sep: "?" | "&" = "?") =>
  isDesktopApp() ? `${sep}desktop_target=1` : "";

/** "your Claude subscription", "your Claude and Grok subscriptions". */
export function subscriptionsText(ids: readonly string[]): string {
  const names = [...new Set(ids)]
    .sort()
    .map((id) => displayNameForSubscription(id as SubscriptionProviderId) ?? id);
  if (names.length === 1) return `your ${names[0]} subscription`;
  return `your ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} subscriptions`;
}

/** E2's rule: the subscription words when every model of the action is on a fresh subscription
 *  (each route `all`); else null — mixed, not fresh, or the website keep today's words. */
export function onSubscriptions(...routes: (DesktopRoutes | null | undefined)[]): string | null {
  if (routes.some((r) => !r?.all || r.subscriptions.length === 0)) return null;
  return subscriptionsText(routes.flatMap((r) => r?.subscriptions ?? []));
}

/** M-desk-4 (H1): a money figure as the Desktop says it. Work that ran on subscriptions (the
 *  server's `ran_on`, read from the Desktop) names them: all of it "on your Claude subscription",
 *  mixed "$0.12 + your Claude subscription". Key-only work and the website: `money` as given. */
export function spendText(money: string, ran: DesktopRoutes | null | undefined): string {
  if (!isDesktopApp() || !ran?.subscriptions.length) return money;
  const subs = subscriptionsText(ran.subscriptions);
  return ran.all ? `on ${subs}` : `${money} + ${subs}`;
}

/** The bridge's `repos` namespace, or null (website, or a Desktop build without it). Spec §6 also
 *  names `dialog.pickFolder()`; it is used as a fallback for the folder picker. */
export function desktopRepos(): DesktopReposBridge | null {
  const bridge = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  if (!bridge || typeof bridge !== "object") return null;
  const b = bridge as unknown as {
    repos?: DesktopReposBridge;
    dialog?: { pickFolder?: DesktopReposBridge["pickFolder"] };
  };
  if (b.repos) return b.repos;
  if (b.dialog?.pickFolder) return { pickFolder: b.dialog.pickFolder };
  return null;
}

/** "~/code/trade_mcp" for a path under the home folder (the bridge usually sends it already). */
export function folderLabel(folder: { path: string; displayPath?: string }): string {
  if (folder.displayPath) return folder.displayPath;
  const m = /^\/(?:Users|home)\/[^/]+(\/.*)?$/.exec(folder.path);
  return m ? `~${m[1] ?? ""}` : folder.path;
}
