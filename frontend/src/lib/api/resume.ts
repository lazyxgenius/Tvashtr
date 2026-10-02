/**
 * M3 — Resume from here (`docs/superpowers/plans/api/resume.md`, ruling R8): where a failed, stopped
 * or stalled run can pick up again, and starting that new run. The words are made server-side.
 */
import { apiRequest } from "./runs";

/** The Prob-Confirm dialog for one resume point. */
export interface ResumeConfirm {
  title: string;
  step_label: string;
  kept: { text: string; at: string | null }[];
  runs_again: string[];
  skips_cost_usd: number;
  skips_s: number;
}

/** One step of the run, in the order it ran (agent steps and gates). */
export interface ResumePoint {
  invocation_id: number;
  node_id: string;
  origin_node_id: string | null;
  label: string;
  /** "agent" | "gate". */
  kind: string;
  iteration: number;
  title: string;
  text: string;
  at: string;
  cost_usd: number | null;
  /** "kept" | "suggested" (the step that failed or stalled). */
  state: string;
  resumable: boolean;
  confirm?: ResumeConfirm | null;
}

export interface ResumeInfo {
  run_id: string;
  number: number | null;
  next_number: number | null;
  available: boolean;
  reason: string | null;
  /** The run is still running with a Stalled step: Resume stops it first. */
  stops_run: boolean;
  points: ResumePoint[];
}

export function getResume(runId: string): Promise<ResumeInfo> {
  return apiRequest<ResumeInfo>("GET", `/api/runs/${encodeURIComponent(runId)}/resume`);
}

/** Start the resumed run. Refusals (409 / 422 / 429) throw `ApiDetailError` with the detail. */
export function resumeRun(
  runId: string,
  invocationId: number,
): Promise<{ run_id: string; number: number | null }> {
  return apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/resume`, {
    invocation_id: invocationId,
  });
}
