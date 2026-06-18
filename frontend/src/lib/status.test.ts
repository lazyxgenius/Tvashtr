import { describe, expect, it } from "vitest";

import type { RunRow } from "./api";
import { deriveNodeStatus, deriveOverall, isRunTerminal } from "./status";

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

describe("deriveNodeStatus (thin read of backend truth)", () => {
  it("passes backend running/done/failed/stopped straight through", () => {
    expect(deriveNodeStatus("running", mkRun({ status: "running" }), "PENDING", false)).toBe(
      "running",
    );
    expect(deriveNodeStatus("done", mkRun({ status: "running" }), "PENDING", false)).toBe("done");
    expect(deriveNodeStatus("failed", mkRun({ status: "running" }), "PENDING", false)).toBe(
      "failed",
    );
    expect(deriveNodeStatus("stopped", mkRun({ status: "running" }), "PENDING", false)).toBe(
      "stopped",
    );
  });

  it("a done node STAYS done even when the run later fails (done is sticky)", () => {
    expect(deriveNodeStatus("done", mkRun({ status: "failed" }), "ERROR", false)).toBe("done");
  });

  it("folds a stale running node to failed on a failed workflow/run", () => {
    // a no-key run can leave a node "running" while the workflow ERROR'd.
    expect(deriveNodeStatus("running", mkRun({ status: "running" }), "CANCELLED", false)).toBe(
      "failed",
    );
    expect(deriveNodeStatus("running", mkRun({ status: "failed" }), "ERROR", false)).toBe("failed");
  });

  it("folds a stale running node to stopped on a rejected/cancelled/over_budget run", () => {
    // these return normally (workflow SUCCESS) but must read stopped, not running.
    for (const status of ["rejected", "cancelled", "over_budget"]) {
      expect(deriveNodeStatus("running", mkRun({ status }), "SUCCESS", false)).toBe("stopped");
    }
  });

  it("idle + awaiting_human + a done predecessor -> paused (blocked at the gate)", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "awaiting_human" }), "PENDING", true)).toBe(
      "paused",
    );
  });

  it("idle + awaiting_human but NO done predecessor -> idle (not yet this node's turn)", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "awaiting_human" }), "PENDING", false)).toBe(
      "idle",
    );
  });

  it("idle + rejected/cancelled/over_budget -> stopped", () => {
    for (const status of ["rejected", "cancelled", "over_budget"]) {
      expect(deriveNodeStatus("idle", mkRun({ status }), "SUCCESS", false)).toBe("stopped");
    }
  });

  it("idle on a plain running run -> idle", () => {
    expect(deriveNodeStatus("idle", mkRun({ status: "running" }), "PENDING", false)).toBe("idle");
  });

  it("idle with no run -> idle", () => {
    expect(deriveNodeStatus("idle", null, null, false)).toBe("idle");
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
