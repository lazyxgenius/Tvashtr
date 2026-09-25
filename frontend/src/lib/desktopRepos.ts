/**
 * The Desktop bridge's local-folder API (spec §4.6 / plan Phase 2: `repos.pickFolder`, `inspect`,
 * `recent.*`, `prepareRun`). The Desktop slice builds it in parallel, so every method is optional
 * here and every call is optional-chained: an older Desktop (or the website) simply has no folders
 * and the composer says so instead of pretending.
 */

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
