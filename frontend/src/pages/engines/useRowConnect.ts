/**
 * An Overview row's Connect on Tvashtr Desktop (ENG-16, EnF-OvConnect): the bridge opens the
 * vendor's sign-in in Terminal and the row's Desktop cell says "Checking…" until the CLI reports
 * the result (the main process asks it again when the window regains focus, and pushes it). Then
 * the row flashes and the toast names the teams that can now run on this computer.
 *
 * The cell stops checking when the CLI says connected (toast + flash), not installed or failed (the
 * cell says so), or — asked again after the Terminal opened — still not signed in (the user came
 * back without finishing: the cell offers Connect again). The website never gets here: its row
 * button is "Open in Desktop" (OQ-2).
 *
 * A row's Refresh ("Couldn’t check Grok", ENG-13) re-checks the same way: "Checking…" until the
 * bridge answers, then the answer (connected: the Refresh toast and the flash; a failure: "Couldn’t
 * check Grok. Try again.").
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../../design-system/components";
import { toSubscriptionStatus } from "../../lib/api/engines";
import type {
  SubscriptionCardState,
  SubscriptionProviderId,
  SubscriptionStatus,
} from "../../lib/engines";
import { enginesBridge } from "./engineBridge";
import { rowsCoveredBy } from "./engineModel";
import { useEngines } from "./enginesData";
import {
  CONNECT_FAILED,
  refreshFailed,
  refreshToast,
  rowConnectedToast,
  terminalOpenedToast,
} from "./subscriptionModel";

interface Pending {
  /** Waiting for the bridge to open Terminal, then for the sign-in there; or for a re-check. */
  phase: "starting" | "signing-in" | "refreshing";
  from: SubscriptionCardState | null;
  /** When the CLI was asked at Connect: a later "not signed in" is the user coming back. */
  since: string | null;
}

type PendingMap = Partial<Record<SubscriptionProviderId, Pending>>;

function without(map: PendingMap, sub: SubscriptionProviderId): PendingMap {
  const next = { ...map };
  delete next[sub];
  return next;
}

/** A status checked after `since` (the cached status and the Connect's own push are not). */
function checkedAfter(at: string | null, since: string | null): boolean {
  if (!at) return false;
  if (!since) return true;
  return Date.parse(at) > Date.parse(since);
}

export interface RowConnect {
  /** Subscriptions whose rows say "Checking…". */
  checking: SubscriptionProviderId[];
  connect: (sub: SubscriptionProviderId) => void;
  refresh: (sub: SubscriptionProviderId) => void;
}

/** `onConnected(providers)`: the rows to flash once the subscription is connected. */
export function useRowConnect(onConnected: (providers: string[]) => void): RowConnect {
  const { subs, inputs, setSubscription } = useEngines();
  const toast = useToast();
  const [pending, setPending] = useState<PendingMap>({});
  const subsRef = useRef(subs);
  subsRef.current = subs;
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  useEffect(() => {
    for (const [sub, p] of Object.entries(pending) as [SubscriptionProviderId, Pending][]) {
      // A re-check ends with the bridge's answer (below), whatever the status says meanwhile.
      if (p.phase === "refreshing") continue;
      const s = subs.find((r) => r.provider === sub);
      if (!s) continue;
      if (s.connected) {
        setPending((m) => without(m, sub));
        toast({ message: rowConnectedToast(inputs, s, p.from) });
        onConnected(rowsCoveredBy(inputs, sub));
      } else if (s.state === "error" || s.state === "needs_install") {
        setPending((m) => without(m, sub));
      } else if (p.phase === "signing-in" && checkedAfter(s.checked_at, p.since)) {
        setPending((m) => without(m, sub));
      }
    }
  }, [pending, subs, inputs, toast, onConnected]);

  const connect = useCallback(
    (sub: SubscriptionProviderId) => {
      const from = subsRef.current.find((s) => s.provider === sub)?.state ?? null;
      setPending((m) => ({ ...m, [sub]: { phase: "starting", from, since: null } }));
      void (async () => {
        let next: SubscriptionStatus | null;
        try {
          next = toSubscriptionStatus(await enginesBridge()?.connect?.(sub));
        } catch {
          next = null;
        }
        if (!next) {
          setPending((m) => without(m, sub));
          toast({ message: CONNECT_FAILED, tone: "error" });
          return;
        }
        setSubscription(next);
        if (next.connected || next.state === "error" || next.state === "needs_install") return;
        const since = next.checked_at;
        setPending((m) => {
          const p = m[sub];
          return p ? { ...m, [sub]: { ...p, phase: "signing-in", since } } : m;
        });
        toast({ message: terminalOpenedToast(sub) });
      })();
    },
    [setSubscription, toast],
  );

  const refresh = useCallback(
    (sub: SubscriptionProviderId) => {
      const prev = subsRef.current.find((s) => s.provider === sub) ?? null;
      setPending((m) => ({ ...m, [sub]: { phase: "refreshing", from: null, since: null } }));
      void (async () => {
        let next: SubscriptionStatus | null;
        try {
          next = toSubscriptionStatus(await enginesBridge()?.refresh?.(sub));
        } catch {
          next = null;
        }
        setPending((m) => without(m, sub));
        if (!next) {
          toast({ message: refreshFailed(sub), tone: "error" });
          return;
        }
        setSubscription(next);
        const message = prev ? refreshToast(prev, next) : null;
        if (message) toast({ message });
        if (next.connected) onConnected(rowsCoveredBy(inputsRef.current, sub));
      })();
    },
    [setSubscription, toast, onConnected],
  );

  return { checking: Object.keys(pending) as SubscriptionProviderId[], connect, refresh };
}
