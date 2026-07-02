import { describe, expect, it } from "vitest";

import type { HumanTask, RunRow } from "./api";
import {
  deriveGateState,
  deriveNodeStatus,
  deriveOverall,
  deriveTerminalState,
  isPrdEditable,
  isRunTerminal,
  reviewerVerdictLabel,
} from "./status";

function mkRun(over: Partial<RunRow> = {}): RunRow {
  return {
    id: "r1",
    team_graph_id: "g1",
    idea: "idea",
    status: "running",
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    cost_total_usd: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function mkTask(over: Partial<HumanTask> = {}): HumanTask {
  return {
    id: 1,
    run_id: "r1",
    kind: "prd_approval",
    priority: "high_blocker",
    blocking: true,
    topic: "gate:r1:n-gate",
    title: "Approve the PRD",
    description: "Review the spec and approve to build, or reject to stop.",
    status: "pending",
    resolution: null,
    resolution_note: null,
    created_at: "2026-01-01T00:00:00Z",
    resolved_at: null,
    ...over,
  };
}

describe("deriveNodeStatus (thin read of backend truth)", () => {
  it("passes backend running/done/failed/stopped straight through", () => {
    expect(deriveNodeStatus("running", mkRun({ status: "running" }), "PENDING")).toBe("running");
    expect(deriveNodeStatus("done", mkRun({ status: "running" }), "PENDING")).toBe("done");
    expect(deriveNodeStatus("failed", mkRun({ status: "running" }), "PENDING")).toBe("failed");
    expect(deriveNodeStatus("stopped", mkRun({ status: "running" }), "PENDING")).toBe("stopped");
  });

  it("a done node STAYS done even when the run later fails (done is sticky)", () => {
    expect(deriveNodeStatus("done", mkRun({ status: "failed" }), "ERROR")).toBe("done");
  });

  it("folds a stale running node to failed on a failed workflow/run", () => {
    // a no-key run can leave a node "running" while the workflow ERROR'd.
    expect(deriveNodeStatus("running", mkRun({ status: "running" }), "CANCELLED")).toBe("failed");
    expect(deriveNodeStatus("running", mkRun({ status: "failed" }), "ERROR")).toBe("failed");
  });

  it("folds a stale running node to stopped on a rejected/cancelled/over_budget run", () => {
    // these return normally (workflow SUCCESS) but must read stopped, not running.
    for (const status of ["rejected", "cancelled", "over_budget"]) {
      expect(deriveNodeStatus("running", mkRun({ status }), "SUCCESS")).toBe("stopped");
    }
  });

  it("idle + awaiting_human -> idle (P1.5b: the gate node carries the pause, not this node)", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "awaiting_human" }), "PENDING")).toBe("idle");
  });

  // ---- F1a never-reached fix (reproduce-first regressions) ----
  // A node the walk NEVER reached is backend "idle". Before the fix, ANY terminal run folded
  // every idle node to failed/stopped, so unreached downstream nodes wrongly read red/grey on a
  // failed/cancelled run. After the fix, the run/workflow override applies ONLY to a node
  // actually IN-FLIGHT (backend "running"); an idle node stays idle. These three FAIL on the
  // pre-fix code and pass after (the running-fold tests above guard that the fix is scoped to idle).
  it("idle + rejected/cancelled/over_budget run -> idle (was 'stopped'; never-reached fix)", () => {
    for (const status of ["rejected", "cancelled", "over_budget"]) {
      expect(deriveNodeStatus("idle", mkRun({ status }), "SUCCESS")).toBe("idle");
    }
  });

  it("idle + failed run -> idle (was 'failed'; an unreached node is not a failure)", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "failed" }), "ERROR")).toBe("idle");
  });

  it("idle + failed WORKFLOW while run.status lags at running -> idle (never-reached fix)", () => {
    // the no-key / crash case: the workflow ERROR'd/CANCELLED but run.status still reads
    // "running"; a node the walk never reached must NOT paint red.
    expect(deriveNodeStatus("idle", mkRun({ status: "running" }), "ERROR")).toBe("idle");
    expect(deriveNodeStatus("idle", mkRun({ status: "running" }), "CANCELLED")).toBe("idle");
  });

  it("idle on a plain running run -> idle", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "running" }), "PENDING")).toBe("idle");
  });

  it("idle with no run -> idle", () => {
    expect(deriveNodeStatus("idle", null, null)).toBe("idle");
  });
});

describe("deriveGateState (the gate node owns the pause)", () => {
  const NODE = "n-gate";
  const RUN_ID = "r1";

  it("no matching task -> idle (gate not reached yet)", () => {
    expect(deriveGateState(NODE, RUN_ID, [], mkRun(), "PENDING")).toBe("idle");
    // a task for a different node id does not match
    const other = mkTask({ topic: `gate:${RUN_ID}:other-node` });
    expect(deriveGateState(NODE, RUN_ID, [other], mkRun(), "PENDING")).toBe("idle");
  });

  it("a pending matching task on a live run -> awaiting", () => {
    const t = mkTask({ topic: `gate:${RUN_ID}:${NODE}`, status: "pending" });
    expect(deriveGateState(NODE, RUN_ID, [t], mkRun({ status: "awaiting_human" }), "PENDING")).toBe(
      "awaiting",
    );
  });

  it("a pending matching task on an already-terminal run -> stopped (cancel race)", () => {
    const t = mkTask({ topic: `gate:${RUN_ID}:${NODE}`, status: "pending" });
    expect(deriveGateState(NODE, RUN_ID, [t], mkRun({ status: "cancelled" }), "CANCELLED")).toBe(
      "stopped",
    );
  });

  it("a resolved approved task -> approved", () => {
    const t = mkTask({
      topic: `gate:${RUN_ID}:${NODE}`,
      status: "resolved",
      resolution: "approved",
    });
    expect(deriveGateState(NODE, RUN_ID, [t], mkRun(), "PENDING")).toBe("approved");
  });

  it("a resolved rejected / cancelled task -> stopped", () => {
    for (const resolution of ["rejected", "cancelled"]) {
      const t = mkTask({ topic: `gate:${RUN_ID}:${NODE}`, status: "resolved", resolution });
      expect(deriveGateState(NODE, RUN_ID, [t], mkRun(), "PENDING")).toBe("stopped");
    }
  });
});

describe("deriveTerminalState", () => {
  it("not done -> idle, regardless of kind", () => {
    expect(deriveTerminalState("ship", "idle")).toBe("idle");
    expect(deriveTerminalState("stop", "running")).toBe("idle");
    expect(deriveTerminalState("ship", "failed")).toBe("idle");
  });

  it("done + ship -> shipped", () => {
    expect(deriveTerminalState("ship", "done")).toBe("shipped");
  });

  it("done + stop -> stopped", () => {
    expect(deriveTerminalState("stop", "done")).toBe("stopped");
  });
});

describe("deriveOverall", () => {
  it("is Ready with no run", () => {
    expect(deriveOverall(null, null)).toEqual({ tone: "idle", label: "Ready" });
  });

  it("maps completed -> Shipped", () => {
    expect(deriveOverall(mkRun({ status: "completed" }), "SUCCESS")).toEqual({
      tone: "done",
      label: "Shipped",
    });
  });

  it("maps awaiting_human -> Awaiting approval (paused tone)", () => {
    expect(deriveOverall(mkRun({ status: "awaiting_human" }), "PENDING")).toEqual({
      tone: "paused",
      label: "Awaiting approval",
    });
  });

  it("REJECTED never reads Shipped, even though workflow_status is SUCCESS", () => {
    const overall = deriveOverall(mkRun({ status: "rejected" }), "SUCCESS");
    expect(overall).toEqual({ tone: "failed", label: "Rejected" });
    expect(overall.label).not.toBe("Shipped");
  });

  it("CANCELLED never reads Shipped", () => {
    const overall = deriveOverall(mkRun({ status: "cancelled" }), "CANCELLED");
    expect(overall).toEqual({ tone: "failed", label: "Cancelled" });
    expect(overall.label).not.toBe("Shipped");
  });

  it("OVER_BUDGET reads 'Over budget', never 'Shipped' (workflow_status is SUCCESS)", () => {
    const overall = deriveOverall(mkRun({ status: "over_budget" }), "SUCCESS");
    expect(overall).toEqual({ tone: "failed", label: "Over budget" });
    expect(overall.label).not.toBe("Shipped");
  });

  it("maps a failed run -> Failed", () => {
    expect(deriveOverall(mkRun({ status: "failed" }), "ERROR")).toEqual({
      tone: "failed",
      label: "Failed",
    });
  });

  it("falls back to the SUCCESS shortcut when run.status lags at running", () => {
    expect(deriveOverall(mkRun({ status: "running" }), "SUCCESS")).toEqual({
      tone: "done",
      label: "Shipped",
    });
  });

  it("falls back to running / failed on workflow-level signals", () => {
    expect(deriveOverall(mkRun({ status: "running" }), "PENDING")).toEqual({
      tone: "running",
      label: "Running…",
    });
    expect(deriveOverall(mkRun({ status: "running" }), "ERROR")).toEqual({
      tone: "failed",
      label: "Failed",
    });
  });
});

describe("reviewerVerdictLabel (per-round verdict view, P1.5c)", () => {
  it("maps approved -> Approved / approved tone", () => {
    expect(reviewerVerdictLabel("approved")).toEqual({ label: "Approved", tone: "approved" });
  });

  it("maps changes_requested -> Changes requested / changes tone", () => {
    expect(reviewerVerdictLabel("changes_requested")).toEqual({
      label: "Changes requested",
      tone: "changes",
    });
  });

  it("an unknown (non-reviewer) outcome reads neutral, echoing the raw label", () => {
    // e.g. an engineer 'built' row, were it ever routed here — never crashes.
    expect(reviewerVerdictLabel("built")).toEqual({ label: "built", tone: "neutral" });
  });

  it("a still-open round (null outcome) reads neutral with an em-dash", () => {
    expect(reviewerVerdictLabel(null)).toEqual({ label: "—", tone: "neutral" });
  });
});

describe("isPrdEditable (the live-steering gate, P1.7b)", () => {
  it("is editable while the run is in-flight (running / awaiting_human)", () => {
    expect(isPrdEditable("running", "PENDING")).toBe(true);
    // the PRD gate is THE moment to steer — awaiting_human must be editable.
    expect(isPrdEditable("awaiting_human", "PENDING")).toBe(true);
    expect(isPrdEditable("pending", "PENDING")).toBe(true);
  });

  it("is NOT editable once the run is terminal (the spec is now history)", () => {
    for (const status of ["completed", "failed", "rejected", "cancelled", "over_budget"]) {
      expect(isPrdEditable(status, "PENDING")).toBe(false);
    }
  });

  it("is NOT editable when the workflow is terminal even if run.status lags at running", () => {
    expect(isPrdEditable("running", "SUCCESS")).toBe(false);
    expect(isPrdEditable("running", "ERROR")).toBe(false);
    expect(isPrdEditable("running", "CANCELLED")).toBe(false);
  });

  it("is NOT editable with no run (null) — nothing to steer", () => {
    expect(isPrdEditable(null, null)).toBe(false);
    expect(isPrdEditable(null, "PENDING")).toBe(false);
  });

  it("mirrors isRunTerminal: editable iff the run is non-terminal and present", () => {
    // the steering gate and the poll-stop read the SAME terminal sets — they never drift.
    expect(isPrdEditable("running", "PENDING")).toBe(
      !isRunTerminal(mkRun({ status: "running" }), "PENDING"),
    );
    expect(isPrdEditable("completed", "SUCCESS")).toBe(
      !isRunTerminal(mkRun({ status: "completed" }), "SUCCESS"),
    );
  });
});

describe("isRunTerminal", () => {
  it("treats completed / failed / rejected / cancelled / over_budget as terminal", () => {
    for (const status of ["completed", "failed", "rejected", "cancelled", "over_budget"]) {
      expect(isRunTerminal(mkRun({ status }), "PENDING")).toBe(true);
    }
  });

  it("does NOT treat awaiting_human as terminal (the gate keeps polling)", () => {
    expect(isRunTerminal(mkRun({ status: "awaiting_human" }), "PENDING")).toBe(false);
  });

  it("does not treat a plain running run as terminal", () => {
    expect(isRunTerminal(mkRun({ status: "running" }), "PENDING")).toBe(false);
  });

  it("treats workflow-terminal statuses as terminal even if run.status lags", () => {
    expect(isRunTerminal(mkRun({ status: "running" }), "SUCCESS")).toBe(true);
    expect(isRunTerminal(mkRun({ status: "running" }), "CANCELLED")).toBe(true);
  });

  it("is not terminal with no run and no workflow status", () => {
    expect(isRunTerminal(null, null)).toBe(false);
  });
});
