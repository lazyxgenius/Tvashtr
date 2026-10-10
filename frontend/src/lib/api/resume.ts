/**
 * M3 — Resume from here (`docs/superpowers/plans/api/resume.md`, ruling R8): where a failed, stopped
 * or stalled run can pick up again, and starting that new run. The words are made server-side.
 */
import { desktopQuery, type DesktopRoutes } from "../desktopRepos";
import { apiRequest } from "./runs";

/** The Prob-Confirm dialog for one resume point. */
export interface ResumeConfirm {
  title: string;
  step_label: string;
  kept: { text: string; at: string | null }[];
  runs_again: string[];
  skips_cost_usd: number;
  skips_s: number;
  /** M-desk-4 (H2): read from the Desktop, where the skipped steps and the re-run ones ran. */
  skips_ran_on?: DesktopRoutes;
  again_ran_on?: DesktopRoutes;
}

/** One step of the run, in the order it ran (agent steps and gates). */
export interface ResumePoint {
  /** Null for a step carried from an earlier run (never resumable). */
  invocation_id: number | null;
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
  /** M-desk-4: read from the Desktop, the plan this step ran on (null: a key). */
  plan?: string | null;
  /** "kept" | "suggested" (the step that failed or stalled). */
  state: string;
  resumable: boolean;
  confirm?: ResumeConfirm | null;
  /** The run a carried step came from (null or absent: this run's own step). */
  from_run?: { run_id: string; number: number | null } | null;
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
  return apiRequest<ResumeInfo>(
    "GET",
    `/api/runs/${encodeURIComponent(runId)}/resume${desktopQuery()}`,
  );
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
