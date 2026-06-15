// The single source of truth for status derived from a GET /api/runs payload.

import type { RunRow } from "./api";

export type NodeStatus = "idle" | "running" | "paused" | "done" | "stopped" | "failed";

const WORKFLOW_FAILED = new Set(["ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
const WORKFLOW_TERMINAL = new Set(["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
// Terminal run statuses (run.status is authoritative): once here, polling stops.
const RUN_TERMINAL = new Set(["completed", "failed", "rejected", "cancelled"]);

/** Stop polling once the run can no longer change. ``awaiting_human`` is NOT
 *  terminal — the gate keeps the run alive while it waits for a human. */
export function isRunTerminal(run: RunRow | null, workflowStatus: string | null): boolean {
  if (run && RUN_TERMINAL.has(run.status)) return true;
  return workflowStatus !== null && WORKFLOW_TERMINAL.has(workflowStatus);
}

/**
 * Per-node status — the centralized derivation (P0.5a status table + the P1.1
 * gate). The Engineer is ``paused`` while the run waits at the PRD gate
 * (``awaiting_human``); the PM is already ``done`` (its document exists).
 *
 * A node that didn't finish because the run was rejected/cancelled is `stopped`
 * (muted, concluded) — checked right after "done" and BEFORE the failed fold, so
 * a `cancelled` run (whose `workflowStatus` is the failed-folding `CANCELLED`)
 * reads `stopped`, not `failed`.
 *
 * `workflowStatus` folds a workflow-level ERROR/CANCELLED/MAX into "failed", so a
 * no-key run (where `pm_step` raises and `run.status` lags at "running") still
 * degrades gracefully to failed instead of spinning forever — that genuine
 * failure stays `failed` (its `run.status` is not rejected/cancelled).
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
    if (run.status === "rejected" || run.status === "cancelled") return "stopped";
    if (failed) return "failed";
    if (run.status === "running") return "running";
    return "idle";
  }

  // engineer
  if (run.ship_tag) return "done";
  if (run.status === "rejected" || run.status === "cancelled") return "stopped";
  if (failed) return "failed";
  if (run.status === "awaiting_human" && run.pm_document_id) return "paused";
  if (run.pm_document_id && run.status === "running") return "running";
  return "idle";
}

export type OverallTone = "idle" | "running" | "paused" | "done" | "failed";

/**
 * Overall run state for the banner. `run.status` is authoritative and checked
 * FIRST: the reject path returns normally (so `workflow_status === "SUCCESS"`)
 * yet must read "Rejected", not "Shipped". Only when `run.status` carries no
 * verdict do we fall back to the workflow-level signal (which covers a no-key run
 * whose `run.status` lags at "running" while the workflow already failed).
 */
export function deriveOverall(
  run: RunRow | null,
  workflowStatus: string | null,
): { tone: OverallTone; label: string } {
  if (!run) return { tone: "idle", label: "Ready" };

  switch (run.status) {
    case "completed":
      return { tone: "done", label: "Shipped" };
    case "awaiting_human":
      return { tone: "paused", label: "Awaiting approval" };
    case "rejected":
      return { tone: "failed", label: "Rejected" };
    case "cancelled":
      return { tone: "failed", label: "Cancelled" };
    case "failed":
      return { tone: "failed", label: "Failed" };
  }

  if (workflowStatus === "SUCCESS") return { tone: "done", label: "Shipped" };
  if (WORKFLOW_FAILED.has(workflowStatus ?? "")) return { tone: "failed", label: "Failed" };
  return { tone: "running", label: "Running…" };
}
