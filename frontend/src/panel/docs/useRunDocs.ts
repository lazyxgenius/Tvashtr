import { useEffect, useState } from "react";

import { listRunDocs, type RunDocs } from "../../lib/api/docs";

/**
 * One run's documents for the canvas (the toolbar count and the card chips). Refetches when `tick`
 * changes (a round finished) and keeps the last answer meanwhile, so the chips never blink; null
 * until the first answer for this run (or with no run).
 */
export function useRunDocs(runId: string | null, tick = ""): RunDocs | null {
  const [got, setGot] = useState<{ runId: string; docs: RunDocs } | null>(null);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    listRunDocs(runId).then(
      (docs) => live && setGot({ runId, docs }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [runId, tick]);
  return got?.runId === runId ? got.docs : null;
}
