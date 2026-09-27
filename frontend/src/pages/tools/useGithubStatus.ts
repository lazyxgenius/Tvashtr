/**
 * The GitHub App card's state (TOOL-23, TOOL-25): `GET /api/github/status`, read on mount and again
 * whenever the window comes back (focus or visibility) after the user was sent to GitHub. When the
 * App went from not installed to installed, or its repo count changed, it toasts "GitHub App
 * installed on N repos." — also after a Desktop reload, from what the page saw before it left
 * (`githubReturn.ts`).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../../design-system/components";
import { type GithubStatus, getGithubStatus } from "../../lib/api/tools";
import { isDesktopApp } from "../../lib/desktopRepos";
import {
  type GithubSeen,
  forgetGithubReturn,
  rememberGithubReturn,
  takeGithubBefore,
} from "./githubReturn";
import { githubInstalledToast } from "./toolFormat";

/** Installed now, and it wasn't before or reaches a different number of repos. */
export function githubChanged(before: GithubSeen, next: GithubStatus): boolean {
  return next.installed && (!before.installed || next.repo_count !== before.repo_count);
}

export function useGithubStatus(): {
  /** null while loading, or when it couldn't be read. */
  status: GithubStatus | null;
  /** Call right before sending the user to GitHub (Install GitHub App, Choose repos). */
  leaveForGithub: () => void;
} {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // What the page saw before the user went to GitHub; null until they go.
  const before = useRef<GithubSeen | null>(null);
  const current = useRef<GithubStatus | null>(null);

  useEffect(() => {
    let live = true;
    // Desktop: back from GitHub after Electron reloaded the app. (A ref survives StrictMode's
    // second mount, which finds the key already taken.)
    before.current = takeGithubBefore() ?? before.current;

    const read = async () => {
      let next: GithubStatus;
      try {
        next = await getGithubStatus();
      } catch {
        return; // keep what we had; the card stays as it was
      }
      if (!live) return;
      current.current = next;
      setStatus(next);
      const seen = before.current;
      if (seen && githubChanged(seen, next)) {
        before.current = { installed: next.installed, repo_count: next.repo_count };
        toastRef.current({ message: githubInstalledToast(next.repo_count) });
      }
    };
    void read();

    const onReturn = () => {
      if (document.visibilityState === "hidden" || !before.current) return;
      forgetGithubReturn(); // still on this page: nothing to restore on a later boot
      void read();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      live = false;
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, []);

  const leaveForGithub = useCallback(() => {
    const now = current.current;
    const seen = { installed: now?.installed ?? false, repo_count: now?.repo_count ?? 0 };
    before.current = seen;
    // Desktop loads GitHub in this window, then reloads `/`: remember where to come back to.
    if (isDesktopApp()) rememberGithubReturn(seen);
  }, []);

  return { status, leaveForGithub };
}
