import { useCallback, useEffect, useState } from "react";

import { type Compare, getCompare } from "../../lib/api/compare";

/** R15: a running compare is read every 2 s. */
export const COMPARE_POLL_MS = 2000;

const ended = (c: Compare) => c.status === "finished" || c.status === "stopped";

/**
 * One compare, polled every 2 s until it ends. The next read is scheduled when the previous reply
 * is in (never two at once), and `refresh` (after Stop / Restore) starts a fresh chain whose answers
 * are the only ones kept — an older read that lands late is dropped.
 */
export function useCompare(id: string): {
  compare: Compare | null;
  failed: boolean;
  refresh: () => void;
} {
  const [compare, setCompare] = useState<Compare | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    setCompare(null);
  }, [id]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loop = async () => {
      try {
        const next = await getCompare(id);
        if (!alive) return;
        setCompare(next);
        setFailed(false);
        if (ended(next)) return;
      } catch {
        if (!alive) return;
        setFailed(true); // retried on the next tick; the view keeps what it showed
      }
      timer = setTimeout(() => void loop(), COMPARE_POLL_MS);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, round]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);
  return { compare, failed, refresh };
}
