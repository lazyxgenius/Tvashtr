import { useCallback, useEffect, useRef, useState } from "react";

import { reportFetchOk } from "../../lib/backendStatus";
import { isEmbeddingFailure, type Memory } from "../../lib/api/memory";
import { listNodeMemories } from "../../lib/api/nodes";

export interface NodeMemories {
  state: "loading" | "error" | "ready";
  /** This agent's notes in use, oldest first. */
  active: Memory[];
  /** Its notes waiting for review. */
  pending: Memory[];
  /** The Memory tab's count (PANEL-16): active + waiting, 0 until they load. */
  count: number;
  retry: () => void;
  /** Make one change, then reload both lists. `null` when the change failed. */
  change: <T>(call: () => Promise<T>) => Promise<{ value: T } | null>;
  /** Counts the changes made here (a view of other notes reloads when it moves). */
  changes: number;
}

/**
 * One agent's own notes (its node-tier memories). The drawer's controller holds it, so the tab
 * count follows every Keep, Discard and Delete. Every change saves right away.
 */
export function useNodeMemories(nodeId: string): NodeMemories {
  const [state, setState] = useState<NodeMemories["state"]>("loading");
  const [active, setActive] = useState<Memory[]>([]);
  const [pending, setPending] = useState<Memory[]>([]);
  const [changes, setChanges] = useState(0);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        listNodeMemories(nodeId, "active"),
        listNodeMemories(nodeId, "pending_review"),
      ]);
      if (!live.current) return;
      setActive(a);
      setPending(p);
      setState("ready");
    } catch {
      if (live.current) setState("error");
    }
  }, [nodeId]);

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  const retry = useCallback(() => {
    setState("loading");
    void reload();
  }, [reload]);

  const change = useCallback(
    async <T>(call: () => Promise<T>): Promise<{ value: T } | null> => {
      try {
        const value = await call();
        await reload();
        if (live.current) setChanges((n) => n + 1);
        return { value };
      } catch (e) {
        // The app answered; only the embedding service behind it didn't.
        if (isEmbeddingFailure(e)) reportFetchOk();
        return null;
      }
    },
    [reload],
  );

  return {
    state,
    active,
    pending,
    count: state === "ready" ? active.length + pending.length : 0,
    retry,
    change,
    changes,
  };
}
