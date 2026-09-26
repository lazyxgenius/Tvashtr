/**
 * The agent drawer's unsaved-changes guard (PANEL-21). The page asks before it closes the drawer,
 * selects another node or goes Back to teams: `request(proceed)` runs `proceed` at once when the
 * draft is clean, otherwise it opens the "Save your changes to <Name>?" confirm and runs it after
 * Save or Discard. The page reaches the guard through `guardRef` (the drawer registers it while
 * mounted). Reloading or closing the tab asks too: the web through `beforeunload`, Tvashtr Desktop
 * through its bridge (its main process asks "Keep editing / Discard and close" on close and quit).
 */
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";

/**
 * Run `proceed` now, or once the user has saved or discarded their changes; `onStay` runs when they
 * keep editing instead (the canvas puts its ring back on this agent).
 */
export type LeaveGuard = (proceed: () => void, onStay?: () => void) => void;

export interface UnsavedGuard {
  /** The confirm is open. */
  asking: boolean;
  request: LeaveGuard;
  /** Close the confirm and stay. */
  keepEditing: () => void;
  /** Close the confirm and do what was asked (after the caller saved or discarded). */
  leave: () => void;
}

/** Tell Tvashtr Desktop (v5 bridge) whether an agent has unsaved edits; a no-op on the website. */
function reportUnsaved(state: { dirty: boolean; agentName?: string }): void {
  const bridge = typeof window === "undefined" ? undefined : window.tvashtrDesktop;
  if (!bridge || typeof bridge !== "object") return;
  bridge.app?.setUnsavedChanges?.(state);
}

export function useUnsavedGuard({
  dirty,
  agentName,
  guardRef,
}: {
  dirty: boolean;
  agentName: string;
  guardRef?: MutableRefObject<LeaveGuard | null>;
}): UnsavedGuard {
  const [asking, setAsking] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const staying = useRef<(() => void) | null>(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const request = useCallback<LeaveGuard>((proceed, onStay) => {
    if (!dirtyRef.current) {
      proceed();
      return;
    }
    pending.current = proceed;
    staying.current = onStay ?? null;
    setAsking(true);
  }, []);

  const keepEditing = useCallback(() => {
    const stay = staying.current;
    pending.current = null;
    staying.current = null;
    setAsking(false);
    stay?.();
  }, []);

  const leave = useCallback(() => {
    const proceed = pending.current;
    pending.current = null;
    staying.current = null;
    setAsking(false);
    proceed?.();
  }, []);

  // The page's handle on this drawer, cleared when the drawer goes.
  useEffect(() => {
    if (!guardRef) return;
    guardRef.current = request;
    return () => {
      if (guardRef.current === request) guardRef.current = null;
    };
  }, [guardRef, request]);

  // Web: the browser's own "Leave site?" prompt while there are unsaved changes. Desktop's main
  // process sees the refused unload (`will-prevent-unload`) and asks in its own words.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Desktop: tell the app, so closing the window or quitting asks first.
  useEffect(() => {
    reportUnsaved({ dirty, agentName });
  }, [dirty, agentName]);
  useEffect(
    () => () => {
      reportUnsaved({ dirty: false });
    },
    [],
  );

  return { asking, request, keepEditing, leave };
}
