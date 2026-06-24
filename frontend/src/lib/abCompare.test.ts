import { describe, expect, it } from "vitest";

import type { ABReviewRound, ABSide } from "./api";
import {
  abHeadline,
  abSideStatus,
  isSideShipped,
  isSideTerminal,
  teamShapeLabel,
} from "./abCompare";

function mkSide(over: Partial<ABSide> = {}): ABSide {
  return {
    pair_label: "A",
    team_shape: "two_node",
    run_id: "run-a",
    status: "running",
    workflow_status: "PENDING",
    ship_tag: null,
    ship_commit_sha: null,
    cost_total_usd: null,
    idea: "idea",
    review_rounds: [],
    ...over,
  };
}

// A review_loop side that shipped after `rounds` reviewer rounds (last = approved).
function shippedReviewSide(rounds: number, over: Partial<ABSide> = {}): ABSide {
  const review_rounds: ABReviewRound[] = Array.from({ length: rounds }, (_, i) => ({
    iteration: i + 1,
    outcome: i === rounds - 1 ? "approved" : "changes_requested",
    outcome_detail: i === rounds - 1 ? null : "missing tests",
  }));
  return mkSide({
    pair_label: "B",
    team_shape: "review_loop",
    run_id: "run-b",
    status: "completed",
    workflow_status: "SUCCESS",
    ship_tag: "ship-b",
    review_rounds,
    ...over,
  });
}

const shippedNoReviewSide = mkSide({
  pair_label: "A",
  team_shape: "two_node",
  status: "completed",
  workflow_status: "SUCCESS",
  ship_tag: "ship-a",
});

describe("isSideTerminal", () => {
  it("is terminal when run.status is a run-terminal", () => {
    expect(isSideTerminal(mkSide({ status: "completed", workflow_status: "PENDING" }))).toBe(true);
  });
  it("is terminal when workflow_status is a workflow-terminal (even if run.status lags)", () => {
    expect(isSideTerminal(mkSide({ status: "running", workflow_status: "ERROR" }))).toBe(true);
  });
  it("is NOT terminal while running with a pending workflow", () => {
    expect(isSideTerminal(mkSide({ status: "running", workflow_status: "PENDING" }))).toBe(false);
  });
});

describe("isSideShipped", () => {
  it("shipped iff completed AND has a ship tag", () => {
    expect(isSideShipped(mkSide({ status: "completed", ship_tag: "ship-x" }))).toBe(true);
  });
  it("completed without a ship tag did NOT ship", () => {
    expect(isSideShipped(mkSide({ status: "completed", ship_tag: null }))).toBe(false);
  });
  it("a failed side did not ship", () => {
    expect(isSideShipped(mkSide({ status: "failed", ship_tag: "ship-x" }))).toBe(false);
  });
});

describe("abSideStatus", () => {
  it("completed → Shipped/done", () => {
    expect(abSideStatus(mkSide({ status: "completed" }))).toEqual({ label: "Shipped", tone: "done" });
  });
  it("awaiting_human → Awaiting approval/paused", () => {
    expect(abSideStatus(mkSide({ status: "awaiting_human" }))).toEqual({
      label: "Awaiting approval",
      tone: "paused",
    });
  });
  it("rejected → Rejected/failed", () => {
    expect(abSideStatus(mkSide({ status: "rejected" }))).toEqual({ label: "Rejected", tone: "failed" });
  });
  it("cancelled → Cancelled/failed", () => {
    expect(abSideStatus(mkSide({ status: "cancelled" }))).toEqual({
      label: "Cancelled",
      tone: "failed",
    });
  });
  it("over_budget → Over budget/failed", () => {
    expect(abSideStatus(mkSide({ status: "over_budget" }))).toEqual({
      label: "Over budget",
      tone: "failed",
    });
  });
  it("failed → Failed/failed", () => {
    expect(abSideStatus(mkSide({ status: "failed" }))).toEqual({ label: "Failed", tone: "failed" });
  });
  it("running with a SUCCESS workflow falls back to Shipped/done", () => {
    expect(abSideStatus(mkSide({ status: "running", workflow_status: "SUCCESS" }))).toEqual({
      label: "Shipped",
      tone: "done",
    });
  });
  it("running with a failed workflow falls back to Failed/failed", () => {
    expect(abSideStatus(mkSide({ status: "running", workflow_status: "ERROR" }))).toEqual({
      label: "Failed",
      tone: "failed",
    });
  });
  it("running with a live workflow reads Running…/running", () => {
    expect(abSideStatus(mkSide({ status: "running", workflow_status: "PENDING" }))).toEqual({
      label: "Running…",
      tone: "running",
    });
  });
});

describe("teamShapeLabel", () => {
  it("maps the two v1 shapes to human copy", () => {
    expect(teamShapeLabel("review_loop")).toBe("review loop");
    expect(teamShapeLabel("two_node")).toBe("no review");
  });
  it("passes an unknown shape through unchanged", () => {
    expect(teamShapeLabel("future_shape")).toBe("future_shape");
  });
});

describe("abHeadline", () => {
  it("a <2-side pair is an incomplete/diverged pair", () => {
    const r = abHeadline([shippedNoReviewSide]);
    expect(r.tone).toBe("diverged");
    expect(r.headline).toMatch(/only one side launched/i);
  });

  it("a non-terminal side ⇒ pending", () => {
    const running = mkSide({ pair_label: "B", status: "running", workflow_status: "PENDING" });
    const r = abHeadline([shippedNoReviewSide, running]);
    expect(r.tone).toBe("pending");
    expect(r.headline).toMatch(/still running/i);
  });

  it("both shipped, review side took >1 round ⇒ delta (caught something)", () => {
    const r = abHeadline([shippedNoReviewSide, shippedReviewSide(2)]);
    expect(r.tone).toBe("delta");
    expect(r.headline).toMatch(/sent the build back once/i);
    expect(r.headline).toMatch(/caught and corrected/i);
  });

  it("delta pluralizes multiple send-backs", () => {
    const r = abHeadline([shippedNoReviewSide, shippedReviewSide(3)]);
    expect(r.tone).toBe("delta");
    expect(r.headline).toMatch(/sent the build back 2 times/i);
  });

  it("both shipped, review side approved first round ⇒ no measurable delta", () => {
    const r = abHeadline([shippedNoReviewSide, shippedReviewSide(1)]);
    expect(r.tone).toBe("no-delta");
    expect(r.headline).toMatch(/no measurable delta/i);
  });

  it("exactly one shipped ⇒ diverged, naming the side that did not", () => {
    const failedB = mkSide({
      pair_label: "B",
      team_shape: "review_loop",
      status: "failed",
      workflow_status: "ERROR",
    });
    const r = abHeadline([shippedNoReviewSide, failedB]);
    expect(r.tone).toBe("diverged");
    expect(r.headline).toMatch(/A shipped, B did not \(failed\)/);
  });

  it("neither side shipped (both terminal) ⇒ diverged, neither delivered", () => {
    const failedA = mkSide({ pair_label: "A", status: "failed", workflow_status: "ERROR" });
    const failedB = mkSide({
      pair_label: "B",
      team_shape: "review_loop",
      status: "failed",
      workflow_status: "ERROR",
    });
    const r = abHeadline([failedA, failedB]);
    expect(r.tone).toBe("diverged");
    expect(r.headline).toMatch(/neither side shipped/i);
  });
});
