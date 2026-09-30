/**
 * One provider sign-in, from the app's side: ask the server where to send the browser
 * (`POST …/oauth/start`), open that page (`connectSignIn.ts`), then poll the connection every two
 * seconds until `signin_pending` turns false (the callback page is the server's and never comes
 * back into the app). It also checks at once when the window gets focus again, and gives up after
 * ten minutes.
 *
 * A closed popup is never read as "cancelled": a provider page with a strict opener policy reads
 * as closed the moment it loads. Only Cancel cancels.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Connection,
  type ConnectionDetail,
  type ConnectorRefusal,
  connectorRefusal,
  getConnection,
  startSignIn,
} from "../../lib/api/connectors";
import { openSignIn, prepareSignInWindow } from "./connectSignIn";

const POLL_MS = 2000;
const CAP_MS = 10 * 60_000;

export type SignInOutcome =
  | { kind: "connected"; connection: ConnectionDetail }
  /** The provider or the user refused: the server's `last_error`. */
  | { kind: "failed"; message: string }
  /** Not finished within ten minutes (or the server's own ten). */
  | { kind: "timeout" }
  /** The sign-in couldn't be started, or its address couldn't be opened (`refusal` null). */
  | { kind: "refused"; refusal: ConnectorRefusal | null };

type State =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "waiting"; id: string; baseline: string | null; since: number; blocked: boolean };

export interface ConnectSignIn {
  /** `starting`: asking the server. `waiting`: the window is open. `blocked`: the browser blocked
   *  it ("Open the window again"). */
  phase: "idle" | "starting" | "waiting" | "blocked";
  /** Call in the click, before any `await`: opens the (blank) popup on the web. */
  prepare: () => void;
  /** Start the sign-in for a connection. `prepared` is a popup the caller already opened. */
  start: (connection: Connection, prepared?: Window | null) => Promise<void>;
  /** "Open the window again" (a click). */
  reopen: () => void;
  /** Stop waiting and close the window. No outcome is reported. */
  cancel: () => void;
}

export function useConnectSignIn(onOutcome: (outcome: SignInOutcome) => void): ConnectSignIn {
  const [state, setState] = useState<State>({ phase: "idle" });
  const popup = useRef<Window | null>(null);
  const address = useRef<string | null>(null);
  // A cancelled start's answer is dropped.
  const run = useRef(0);
  const report = useRef(onOutcome);
  report.current = onOutcome;

  const closeWindow = () => {
    popup.current?.close();
    popup.current = null;
  };

  const prepare = useCallback(() => {
    popup.current = prepareSignInWindow();
  }, []);

  const start = useCallback(async (connection: Connection, prepared?: Window | null) => {
    const mine = ++run.current;
    if (prepared !== undefined) popup.current = prepared;
    setState({ phase: "starting" });
    let refusal: ConnectorRefusal | null = null;
    try {
      const { authorize_url } = await startSignIn(connection.id);
      if (run.current !== mine) return;
      const opened = openSignIn(authorize_url, popup.current);
      if (opened !== "refused") {
        address.current = authorize_url;
        setState({
          phase: "waiting",
          id: connection.id,
          baseline: connection.last_error,
          since: Date.now(),
          blocked: opened === "blocked",
        });
        return;
      }
    } catch (e) {
      if (run.current !== mine) return;
      refusal = connectorRefusal(e);
    }
    closeWindow();
    setState({ phase: "idle" });
    report.current({ kind: "refused", refusal });
  }, []);

  const reopen = useCallback(() => {
    if (!address.current) return;
    popup.current = prepareSignInWindow();
    const opened = openSignIn(address.current, popup.current);
    setState((s) => (s.phase === "waiting" ? { ...s, blocked: opened === "blocked" } : s));
  }, []);

  const cancel = useCallback(() => {
    run.current++;
    closeWindow();
    setState({ phase: "idle" });
  }, []);

  const waiting = state.phase === "waiting" ? state : null;
  const id = waiting?.id;
  const baseline = waiting?.baseline ?? null;
  const since = waiting?.since ?? 0;
  useEffect(() => {
    if (id === undefined) return;
    let live = true;
    let busy = false;
    const finish = (outcome: SignInOutcome) => {
      live = false;
      popup.current = null;
      setState({ phase: "idle" });
      report.current(outcome);
    };
    const check = async () => {
      if (!live || busy) return;
      if (Date.now() - since >= CAP_MS) return finish({ kind: "timeout" });
      busy = true;
      try {
        const connection = await getConnection(id);
        if (!live || connection.signin_pending) return;
        if (connection.status === "connected" && connection.last_error === null) {
          finish({ kind: "connected", connection });
        } else if (connection.last_error && connection.last_error !== baseline) {
          finish({ kind: "failed", message: connection.last_error });
        } else {
          finish({ kind: "timeout" });
        }
      } catch {
        // A blip: the next check tries again, and the ten minutes still end it.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    const onReturn = () => {
      if (document.visibilityState !== "hidden") void check();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [id, baseline, since]);

  const phase = waiting ? (waiting.blocked ? "blocked" : "waiting") : state.phase;
  return { phase, prepare, start, reopen, cancel };
}
