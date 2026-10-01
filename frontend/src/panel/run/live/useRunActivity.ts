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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pull = async () => {
      try {
        const next = await getRunActivity(runId, cursor.current);
        // A server without the Activity read (an older backend) answers something else: show
        // nothing new rather than break the run view.
        if (!alive || !Array.isArray(next?.agents) || !Array.isArray(next?.lines)) return;
        cursor.current = next.cursor;
        setActivity((prev) => mergeActivity(prev, next));
      } catch {
        // A missed poll is retried on the next tick; the view keeps what it showed.
      }
    };
    // The next poll is scheduled when the previous reply is in (review finding 1): a slow read on a
    // long run never stacks requests, and an older reply never lands after a newer one.
    const loop = async () => {
      await pull();
      if (alive && !terminal) timer = setTimeout(() => void loop(), ACTIVITY_POLL_MS);
    };
    void loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, terminal]);

  return activity;
}
