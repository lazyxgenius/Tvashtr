import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { NodeInvocation } from "../lib/api";
import { SidePanel } from "./SidePanel";

// Brief §2.3.4: the Reviewer panel renders the per-round verdict labels in iteration order, with
// the reasons (outcome_detail) shown UNDER a changes_requested round and NOT under an approved one.

const CHANGES_REASON = "Missing the overdue-check pure function.";

const rounds: NodeInvocation[] = [
  {
    iteration: 1,
    status: "done",
    outcome: "changes_requested",
    outcome_detail: CHANGES_REASON,
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
  },
  {
    iteration: 2,
    status: "done",
    outcome: "approved",
    outcome_detail: null,
    started_at: "2026-01-01T00:02:00Z",
    ended_at: "2026-01-01T00:03:00Z",
  },
];

function renderReviewer() {
  return render(
    <SidePanel
      selectedRole="reviewer"
      invocations={rounds}
      runId="r1"
      run={null}
      workflowStatus="PENDING"
      onClose={() => {}}
    />,
  );
}

describe("SidePanel — Reviewer per-round verdicts", () => {
  it("renders the verdict labels in iteration order", () => {
    renderReviewer();
    const round1 = screen.getByText("Round 1");
    const round2 = screen.getByText("Round 2");
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(round1.compareDocumentPosition(round2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the reasons under the changes_requested round and NOT under the approved round", () => {
    renderReviewer();
    // the reason renders exactly once
    expect(screen.getAllByText(CHANGES_REASON)).toHaveLength(1);

    // it lives in the changes_requested round's <li>, not the approved one
    const changesLi = screen.getByText("Changes requested").closest("li");
    const approvedLi = screen.getByText("Approved").closest("li");
    expect(changesLi).not.toBeNull();
    expect(approvedLi).not.toBeNull();
    expect(within(changesLi as HTMLElement).getByText(CHANGES_REASON)).toBeInTheDocument();
    expect(within(approvedLi as HTMLElement).queryByText(CHANGES_REASON)).toBeNull();
    expect((approvedLi as HTMLElement).querySelector(".tv-verdict__reasons")).toBeNull();
  });
});
