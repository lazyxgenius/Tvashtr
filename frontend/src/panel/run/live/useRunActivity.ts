import { useEffect, useRef, useState } from "react";

import { getRunActivity, type RunActivity } from "../../../lib/api/activity";
import { mergeActivity } from "./liveFormat";

/** R15: the run view polls every 2 s. */
export const ACTIVITY_POLL_MS = 2000;

/**
 * The run's Activity, polled every 2 s while the run is in flight (one last read when it ends),
 * each poll asking only for lines newer than the last cursor.
 */
export function useRunActivity(runId: string | null, terminal: boolean): RunActivity | null {
  const [activity, setActivity] = useState<RunActivity | null>(null);
  const cursor = useRef<string | null>(null);

  useEffect(() => {
    setActivity(null);
    cursor.current = null;
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const pull = async () => {
      try {
        const next = await getRunActivity(runId, cursor.current);
        if (!alive) return;
        cursor.current = next.cursor;
        setActivity((prev) => mergeActivity(prev, next));
      } catch {
        // A missed poll is retried on the next tick; the view keeps what it showed.
      }
    };
    void pull();
    if (terminal) return () => void (alive = false);
    const timer = setInterval(() => void pull(), ACTIVITY_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId, terminal]);

  return activity;
}
