/**
 * Unsaved edits on a page (the tool page's Connection card, TOOL-55): while `dirty`, leaving asks
 * first.
 *
 * - Moving to another address inside the app (the nav, a link, Back): the address is put back at
 *   once and `pending` holds where you were going; the page asks, then `leave()` goes there (in the
 *   same history entry) or `stay()` forgets it. The listener runs in the capture phase on `window`,
 *   before the app's own hashchange listener, and stops it — so the page never unmounts.
 * - Closing or reloading the tab: the browser's own "Leave site?" (`beforeunload`).
 * - Desktop: the window's close / reload / quit asks "Keep editing / Discard and close" through the
 *   bridge (`window.tvashtrDesktop.app.setUnsavedChanges`), optional-chained — older apps lack it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { navigate, parseRoute } from "../../lib/nav";

/** Tell Desktop whether closing / reloading the window should ask first (no-op on the website). */
function reportUnsaved(state: { dirty: boolean; agentName?: string }): void {
  const bridge = window.tvashtrDesktop;
  if (!bridge || typeof bridge !== "object") return;
  bridge.app?.setUnsavedChanges?.(state);
}

export function useLeaveGuard(
  dirty: boolean,
  what: string,
): { pending: string | null; leave: () => void; stay: () => void; release: () => void } {
  const [pending, setPending] = useState<string | null>(null);
  // Set by leave(): the next address change is the one we asked about.
  const leaving = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const here = window.location.hash;
    const onHash = (e: HashChangeEvent) => {
      const next = window.location.hash;
      if (leaving.current || next === here) return;
      e.stopImmediatePropagation();
      const url = new URL(window.location.href);
      url.hash = here;
      window.history.replaceState(window.history.state, "", url);
      setPending(next);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers show the prompt only when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("hashchange", onHash, true);
    window.addEventListener("beforeunload", onUnload);
    reportUnsaved({ dirty: true, agentName: what });
    return () => {
      window.removeEventListener("hashchange", onHash, true);
      window.removeEventListener("beforeunload", onUnload);
      reportUnsaved({ dirty: false });
    };
  }, [dirty, what]);

  const leave = useCallback(() => {
    if (pending === null) return;
    leaving.current = true;
    setPending(null);
    navigate(parseRoute(pending), { replace: true });
  }, [pending]);
  const stay = useCallback(() => setPending(null), []);
  /** Let the next move go without asking (the edits no longer matter, e.g. the thing was removed). */
  const release = useCallback(() => {
    leaving.current = true;
  }, []);

  return { pending, leave, stay, release };
}
