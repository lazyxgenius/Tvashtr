/**
 * The GitHub App round trip's memory (TOOL-25, TOOL-69). On Desktop, Electron loads GitHub in the
 * main window and then reloads `/`, so the page and what it knew are gone. Before leaving, the
 * Browse tab writes where to come back to (`tv:return`) and the App state it saw
 * (`tv:github-before`). On boot, Workspace's `useGithubReturn()` goes back to that address, and the
 * Browse tab compares a fresh status with the one it saw ("GitHub App installed on N repos.").
 * The website opens GitHub in a new window and keeps the page, so it only re-reads on focus.
 */
import { useEffect } from "react";

import { navigate, parseRoute } from "../../lib/nav";

export const RETURN_KEY = "tv:return";
export const BEFORE_KEY = "tv:github-before";
export const BROWSE_HASH = "#/toolkit/tools/browse";

/** What the Browse tab saw of the App before the user went to GitHub. */
export interface GithubSeen {
  installed: boolean;
  repo_count: number;
}

/** Session storage, or null where it's blocked (private windows, sandboxed previews). */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function take(key: string): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const value = s.getItem(key);
    s.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

/** Desktop, right before GitHub replaces the page: come back to Browse and remember `seen`. */
export function rememberGithubReturn(seen: GithubSeen): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RETURN_KEY, BROWSE_HASH);
    s.setItem(BEFORE_KEY, JSON.stringify(seen));
  } catch {
    // Storage full or blocked: the round trip still works, it just lands on Home.
  }
}

/** The address to come back to after GitHub (read once; null when there is none). */
export function takeGithubReturn(): string | null {
  const hash = take(RETURN_KEY);
  return hash && hash.startsWith("#/") ? hash : null;
}

/** What the page saw before it left for GitHub (read once; null when there is none). */
export function takeGithubBefore(): GithubSeen | null {
  const raw = take(BEFORE_KEY);
  if (!raw) return null;
  try {
    const seen: unknown = JSON.parse(raw);
    if (typeof seen !== "object" || seen === null) return null;
    const { installed, repo_count } = seen as Record<string, unknown>;
    if (typeof installed !== "boolean" || typeof repo_count !== "number") return null;
    return { installed, repo_count };
  } catch {
    return null;
  }
}

/** The page is still here (GitHub opened elsewhere): nothing to restore on a later boot. */
export function forgetGithubReturn(): void {
  take(RETURN_KEY);
  take(BEFORE_KEY);
}

/** Opens a GitHub page: a new window on the website; Desktop's shell loads it in this window. */
export function openGithub(url: string): void {
  window.open(url, "_blank", "noopener");
}

/** Workspace: back from GitHub after a reload → the page we left, once. */
export function useGithubReturn(): void {
  useEffect(() => {
    const hash = takeGithubReturn();
    if (hash) navigate(parseRoute(hash), { replace: true });
  }, []);
}
