// The single source of truth for status derived from a GET /api/runs payload.

import type { RunRow } from "./api";

export type NodeStatus = "idle" | "running" | "paused" | "done" | "stopped" | "failed";

export const WORKFLOW_FAILED = new Set(["ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
const WORKFLOW_TERMINAL = new Set(["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
// Terminal run statuses (run.status is authoritative): once here, polling stops.
const RUN_TERMINAL = new Set(["completed", "failed", "rejected", "cancelled", "over_budget"]);
// Run terminals that are a muted, concluded "Stopped" (not a red failure) at the
// node level: a human rejection (rejected), the kill switch (cancelled), or a
// budget hard-stop (over_budget). Checked before the failed-fold.
const RUN_STOPPED = new Set(["rejected", "cancelled", "over_budget"]);

/** Stop polling once the run can no longer change. ``awaiting_human`` is NOT
 *  terminal — the gate keeps the run alive while it waits for a human. */
export function isRunTerminal(run: RunRow | null, workflowStatus: string | null): boolean {
  if (run && RUN_TERMINAL.has(run.status)) return true;
  return workflowStatus !== null && WORKFLOW_TERMINAL.has(workflowStatus);
}

/**
 * Per-node status — now a **thin read of backend truth** (P1.5a). The executor
 * owns a real per-node `AgentInvocation`, so the graph endpoint hands us each
 * node's live `backendStatus` (`idle|running|done|failed|stopped`); this function
 * is the small overlay on top of it, not the old run-level archaeology:
 *
 *  - `done`/`failed`/`stopped` from the backend pass straight through. `done` is
 *    sticky: a node that completed stays done even if the run later fails.
 *  - For `running`/`idle` we let a terminal run/workflow override a stale in-flight
 *    invocation: a no-key run can leave the PM `running` while the workflow ERROR'd,
 *    so a failed run/workflow folds to `failed`, and a rejected/cancelled/over_budget
 *    run folds to `stopped` (muted, concluded — checked before the failed fold).
 *  - `idle` is the only place inference remains: a node not yet reached reads
 *    `paused` when the run is blocked at a gate AND its predecessor is done (the
 *    PRD gate pauses the Engineer, never the not-yet-relevant Reviewer).
 *
 * `predecessorDone` is computed in the canvas from the topology + raw backend
 * statuses (an incoming edge from a `done` node). `isRunTerminal` + `deriveOverall`
 * stay run-level and unchanged.
 */
export function deriveNodeStatus(
  backendStatus: string,
  run: RunRow | null,
  workflowStatus: string | null,
  predecessorDone: boolean,
): NodeStatus {
  // A node that completed stays done regardless of what happens downstream.
  if (backendStatus === "done") return "done";
  if (backendStatus === "failed") return "failed";
  if (backendStatus === "stopped") return "stopped";

  // backendStatus is "running" or "idle": let a terminal run/workflow override a
  // stale in-flight invocation.
  const failed = run?.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? "");
  if (run && RUN_STOPPED.has(run.status)) return "stopped"; // rejected/cancelled/over_budget
  if (failed) return "failed";
  if (backendStatus === "running") return "running";

  // idle: not reached yet — the only place inference remains.
  if (run?.status === "awaiting_human" && predecessorDone) return "paused"; // blocked at a gate
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
    case "over_budget":
      return { tone: "failed", label: "Over budget" };
    case "failed":
      return { tone: "failed", label: "Failed" };
  }

  if (workflowStatus === "SUCCESS") return { tone: "done", label: "Shipped" };
  if (WORKFLOW_FAILED.has(workflowStatus ?? "")) return { tone: "failed", label: "Failed" };
  return { tone: "running", label: "Running…" };
}
