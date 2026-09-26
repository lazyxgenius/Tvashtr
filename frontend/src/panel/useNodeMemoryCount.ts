import { useEffect, useState } from "react";

import { listMemories } from "../lib/api";

/** The Memory tab count (PANEL-16): this agent's active notes plus the ones waiting for review.
 *  0 while loading or when the notes can't be read (the tab then shows no count). */
export function useNodeMemoryCount(nodeId: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCount(0);
    Promise.all([
      listMemories({ node_id: nodeId }),
      listMemories({ node_id: nodeId, status: "pending_review" }),
    ])
      .then(([active, pending]) => {
        if (cancelled) return;
        const n =
          (Array.isArray(active) ? active.length : 0) +
          (Array.isArray(pending) ? pending.length : 0);
        setCount(n);
      })
      .catch(() => {
        if (!cancelled) setCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);
  return count;
}
