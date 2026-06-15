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

describe("deriveNodeStatus", () => {
  it("is idle for both roles when there is no run", () => {
    expect(deriveNodeStatus("pm", null, null)).toBe("idle");
    expect(deriveNodeStatus("engineer", null, null)).toBe("idle");
  });

  it("PM is done once its document exists", () => {
    expect(deriveNodeStatus("pm", mkRun({ pm_document_id: "d1" }), "PENDING")).toBe("done");
  });

  it("PM is running while working, idle before, failed on error", () => {
    expect(deriveNodeStatus("pm", mkRun({ status: "running" }), "PENDING")).toBe("running");
    expect(deriveNodeStatus("pm", mkRun({ status: "pending" }), "ENQUEUED")).toBe("idle");
    expect(deriveNodeStatus("pm", mkRun({ status: "failed" }), "ERROR")).toBe("failed");
  });

  it("Engineer is PAUSED while the run awaits human approval (PM already done)", () => {
    const run = mkRun({ status: "awaiting_human", pm_document_id: "d1" });
    expect(deriveNodeStatus("engineer", run, "PENDING")).toBe("paused");
  });

  it("Engineer is running once the PM doc exists and the run is running", () => {
    const run = mkRun({ status: "running", pm_document_id: "d1" });
    expect(deriveNodeStatus("engineer", run, "PENDING")).toBe("running");
  });

  it("Engineer is done once shipped", () => {
    const run = mkRun({ status: "completed", pm_document_id: "d1", ship_tag: "ship-r1" });
    expect(deriveNodeStatus("engineer", run, "SUCCESS")).toBe("done");
  });

  it("Engineer folds a workflow-level CANCELLED/ERROR into failed", () => {
    expect(deriveNodeStatus("engineer", mkRun({ pm_document_id: "d1" }), "CANCELLED")).toBe(
      "failed",
    );
  });

  it("Engineer is idle before the PM hands off", () => {
    expect(deriveNodeStatus("engineer", mkRun({ status: "running" }), "PENDING")).toBe("idle");
  });

  it("Engineer is STOPPED (not Waiting) on a rejected run", () => {
    const run = mkRun({ status: "rejected", pm_document_id: "d1", ship_tag: null });
    expect(deriveNodeStatus("engineer", run, "SUCCESS")).toBe("stopped");
  });

  it("Engineer is STOPPED (not failed) on a cancelled run", () => {
    const run = mkRun({ status: "cancelled", pm_document_id: "d1" });
    expect(deriveNodeStatus("engineer", run, "CANCELLED")).toBe("stopped");
  });

  it("PM is stopped on a cancelled run with no document, but done once it has one", () => {
    expect(deriveNodeStatus("pm", mkRun({ status: "cancelled" }), "CANCELLED")).toBe("stopped");
    expect(
      deriveNodeStatus("pm", mkRun({ status: "cancelled", pm_document_id: "d1" }), "CANCELLED"),
    ).toBe("done");
  });

  it("a GENUINE failure still reads failed, not stopped", () => {
    // explicit run failure
    expect(
      deriveNodeStatus("engineer", mkRun({ status: "failed", pm_document_id: "d1" }), "ERROR"),
    ).toBe("failed");
    // workflow CANCELLED while run.status lags at "running" -> still failed
    expect(
      deriveNodeStatus("engineer", mkRun({ status: "running", pm_document_id: "d1" }), "CANCELLED"),
    ).toBe("failed");
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
  it("treats completed / failed / rejected / cancelled as terminal", () => {
    for (const status of ["completed", "failed", "rejected", "cancelled"]) {
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
