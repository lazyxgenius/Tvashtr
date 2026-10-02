import { useCallback, useState } from "react";

import { getResume, type ResumeInfo, type ResumePoint } from "../../../lib/api/resume";

/**
 * Where a run can resume (GET /api/runs/{id}/resume), and which of its two views is open: the
 * "Resume run #12" panel (Prob-Pick) and the confirm dialog for one step (Prob-Confirm).
 */
export function useResume(runId: string | null) {
  const [info, setInfo] = useState<ResumeInfo | null>(null);
  const [pick, setPick] = useState(false);
  const [confirm, setConfirm] = useState<ResumePoint | null>(null);
  /** Open the panel ("pick") or the dialog for one step; rejects with why Resume isn't offered. */
  const open = useCallback(
    async (at: number | "pick") => {
      if (!runId) return;
      const next = await getResume(runId);
      if (!next.available) throw new Error(next.reason ?? "Resume isn’t available for this run.");
      setInfo(next);
      if (at === "pick") {
        setPick(true);
        return;
      }
      const point = next.points.find((p) => p.invocation_id === at && p.resumable && p.confirm);
      if (!point) throw new Error("This step can’t be resumed.");
      setConfirm(point);
    },
    [runId],
  );
  return {
    info,
    pick: pick && info !== null,
    confirm: info ? confirm : null,
    open,
    choose: setConfirm,
    closePick: () => setPick(false),
    closeConfirm: () => setConfirm(null),
  };
}
