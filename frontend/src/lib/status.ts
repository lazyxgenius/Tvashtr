// The single source of truth for status derived from a GET /api/runs payload.

import type { HumanTask, RunRow } from "./api";

// No "paused": after P1.5b the paused state lives on the gate node (its own GateState),
// never on an agent/completion node — `deriveNodeStatus` no longer infers it.
export type NodeStatus = "idle" | "running" | "done" | "stopped" | "failed";

export const WORKFLOW_FAILED = new Set(["ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"]);
// Exported so the A/B comparison module (§14.3) derives a side's terminality from the SAME
// sets the single-run poll-stop uses — one source of truth for "can this still change?".
export const WORKFLOW_TERMINAL = new Set([
  "SUCCESS",
  "ERROR",
  "CANCELLED",
  "MAX_RECOVERY_ATTEMPTS_EXCEEDED",
]);
// Terminal run statuses (run.status is authoritative): once here, polling stops.
export const RUN_TERMINAL = new Set([
  "completed",
  "failed",
  "rejected",
  "cancelled",
  "over_budget",
]);
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
 * Is the run's PRD live-editable right now (P1.7b steering)? True iff the run is **in-flight**
 * — a real run that has NOT reached a terminal state — so a human edit can still reach the
 * agents on their next node read (J3). Reuses the SAME terminal sets the poll-stop uses, so
 * "can I steer this?" and "can this still change?" never drift apart. No run (`null`) → false
 * (nothing to steer); any run-terminal or workflow-terminal → false (the spec is now history).
 * `awaiting_human` is deliberately editable: the PRD gate is the canonical moment to steer.
 */
export function isPrdEditable(runStatus: string | null, workflowStatus: string | null): boolean {
  if (runStatus === null) return false;
  if (RUN_TERMINAL.has(runStatus)) return false;
  if (workflowStatus !== null && WORKFLOW_TERMINAL.has(workflowStatus)) return false;
  return true;
}

/**
 * Per-node status for an **agent/completion** node — a **thin read of backend truth**
 * (P1.5a). The executor owns a real per-node `AgentInvocation`, so the graph endpoint
 * hands us each node's live `backendStatus` (`idle|running|done|failed|stopped`); this
 * function is the small overlay on top of it:
 *
 *  - `done`/`failed`/`stopped` from the backend pass straight through. `done` is
 *    sticky: a node that completed stays done even if the run later fails.
 *  - Only a node actually IN-FLIGHT (`running`) when the run died folds to the run's
 *    terminal verdict: a no-key run can leave the PM `running` while the workflow
 *    ERROR'd, so a failed run/workflow folds to `failed`, and a rejected/cancelled/
 *    over_budget run folds to `stopped` (muted, concluded — checked before the failed fold).
 *  - `idle` is just `idle` — a node the walk NEVER reached did not fail, it was simply
 *    not reached, so it stays `idle` REGARDLESS of a terminal run/workflow (else every
 *    unreached downstream node would wrongly read red on a failed run). **No paused
 *    inference** (P1.5b): the paused state lives on the gate node (`deriveGateState`), so
 *    the Engineer reads plain "Waiting" while the PRD gate awaits — agent/completion nodes
 *    never read paused.
 *
 * `isRunTerminal` + `deriveOverall` stay run-level and unchanged.
 */
export function deriveNodeStatus(
  backendStatus: string,
  run: RunRow | null,
  workflowStatus: string | null,
): NodeStatus {
  // A node that completed stays done regardless of what happens downstream.
  if (backendStatus === "done") return "done";
  if (backendStatus === "failed") return "failed";
  if (backendStatus === "stopped") return "stopped";

  // Only a node still IN-FLIGHT ("running") when the run died folds to the run/workflow's
  // terminal verdict; a never-reached ("idle") node is untouched (it wasn't running, so it
  // can't have failed/stopped — it was simply never reached).
  if (backendStatus === "running") {
    if (run && RUN_STOPPED.has(run.status)) return "stopped"; // rejected/cancelled/over_budget
    if (run?.status === "failed" || WORKFLOW_FAILED.has(workflowStatus ?? "")) return "failed";
    return "running";
  }

  return "idle"; // not reached yet (the gate node, not this node, carries any pause)
}

/**
 * Gate-node display state. The paused state lives here (one source of truth for "where
 * is the run paused"). The graph payload exposes the node's invocation `status` but NOT
 * its `outcome`, so a resolved gate reads `done` for BOTH approve and reject — the
 * approve-vs-reject distinction must come from the gate's matching **task**.
 *
 * The gate↔task link is the one backend convention we couple to: the gate task's topic
 * is exactly `gate:{run_id}:{node_id}`. Build/compare the full string here (and in the
 * drawer's `split(":")[2]`); do not scatter ad-hoc topic parsing elsewhere.
 */
export type GateState = "idle" | "awaiting" | "approved" | "stopped";
export function deriveGateState(
  nodeId: string,
  runId: string,
  tasks: HumanTask[],
  run: RunRow | null,
  workflowStatus: string | null,
): GateState {
  const task = tasks.find((t) => t.topic === `gate:${runId}:${nodeId}`);
  if (!task) return "idle"; // gate not reached yet
  if (task.status === "pending") {
    // Normally run.status === "awaiting_human"; if the run somehow already concluded
    // (e.g. a cancel race), the gate reads concluded-muted, not coral-awaiting.
    return isRunTerminal(run, workflowStatus) ? "stopped" : "awaiting";
  }
  return task.resolution === "approved" ? "approved" : "stopped"; // rejected | cancelled → stopped
}

/**
 * Terminal-node display state, from the node's own backend `status` (a terminal closes
 * `done` once reached — ship → shipped, stop → stopped).
 */
export type TerminalState = "idle" | "shipped" | "stopped";
export function deriveTerminalState(terminalKind: string, backendStatus: string): TerminalState {
  if (backendStatus !== "done") return "idle"; // not reached
  return terminalKind === "ship" ? "shipped" : "stopped";
}

/**
 * Map a persisted reviewer `AgentInvocation.outcome` to its display label + tone for the
 * per-round verdict view (P1.5c §14.1). Pure and total: `approved` reads positive (sage),
 * `changes_requested` reads attention (coral), anything else (a non-reviewer outcome, or a
 * still-open `null` round) reads neutral. Only the LABEL is surfaced today — the reasons
 * ("why B sent it back") need a new column and arrive with the §14.2 A/B work.
 */
export type VerdictTone = "approved" | "changes" | "neutral";
export function reviewerVerdictLabel(outcome: string | null): { label: string; tone: VerdictTone } {
  if (outcome === "approved") return { label: "Approved", tone: "approved" };
  if (outcome === "changes_requested") return { label: "Changes requested", tone: "changes" };
  return { label: outcome ?? "—", tone: "neutral" };
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
