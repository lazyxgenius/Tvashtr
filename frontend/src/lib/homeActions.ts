/**
 * Actions that live on Home but can be asked for from anywhere in the dashboard — the N and T
 * shortcuts, the ⌘K palette and the get-started checklist. The Home page handles them with
 * `useHomeActionHandler`; asking from another page opens Home first and the action runs as soon as
 * Home mounts.
 */
import { useEffect, useRef } from "react";

import { navigate } from "./nav";

export type HomeAction =
  | { kind: "new-run"; teamId?: string }
  | { kind: "new-team"; templateKey?: string };

let handler: ((action: HomeAction) => void) | null = null;
let pending: HomeAction | null = null;

export function requestHomeAction(action: HomeAction): void {
  if (handler) {
    handler(action);
    return;
  }
  pending = action;
  navigate({ page: "home" });
}

/** Home registers itself here; a queued action (asked for from another page) runs on mount. */
export function useHomeActionHandler(fn: (action: HomeAction) => void): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    const h = (a: HomeAction) => ref.current(a);
    handler = h;
    if (pending) {
      const queued = pending;
      pending = null;
      h(queued);
    }
    return () => {
      if (handler === h) handler = null;
    };
  }, []);
}
