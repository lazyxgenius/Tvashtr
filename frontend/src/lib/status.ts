// The single source of truth for status derived from a GET /api/runs payload.

import type { RunRow } from "./api";

export type NodeStatus = "idle" | "running" | "done" | "failed";

const WORKFLOW_FAILED = new Set(["ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
const WORKFLOW_TERMINAL = new Set(["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);

/** Stop polling once the workflow can no longer change. */
export function isRunTerminal(run: RunRow | null, workflowStatus: string | null): boolean {
  if (run && (run.status === "completed" || run.status === "failed")) return true;
  return workflowStatus !== null && WORKFLOW_TERMINAL.has(workflowStatus);
}

/**
 * Per-node status — the centralized derivation (P0.5a status table).
 *
 * `workflowStatus` folds a workflow-level ERROR/CANCELLED/MAX into "failed", so a
 * no-key run (where `pm_step` raises and `run.status` lags at "running") still
 * degrades gracefully to failed instead of spinning forever.
 */
export function deriveNodeStatus(
  role: string,
  run: RunRow | null,
  workflowStatus: string | null,
): NodeStatus {
  if (!run) return "idle";
  const failed = run.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? "");

  if (role === "pm") {
    if (run.pm_document_id) return "done";
    if (failed) return "failed";
    if (run.status === "running") return "running";
    return "idle";
  }

  // engineer
  if (run.ship_tag) return "done";
  if (failed) return "failed";
  if (run.pm_document_id && run.status === "running") return "running";
  return "idle";
}

export type OverallTone = "idle" | "running" | "done" | "failed";

/** Overall run state for the banner. */
export function deriveOverall(
  run: RunRow | null,
  workflowStatus: string | null,
): { tone: OverallTone; label: string } {
  if (!run) return { tone: "idle", label: "Ready" };
  if (run.status === "completed" || workflowStatus === "SUCCESS")
    return { tone: "done", label: "Shipped" };
  if (run.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? ""))
    return { tone: "failed", label: "Failed" };
  return { tone: "running", label: "Running…" };
}
