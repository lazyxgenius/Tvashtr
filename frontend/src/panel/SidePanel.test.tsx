import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphNode, NodeInvocation } from "../lib/api";
import { SidePanel } from "./SidePanel";

// Option A: the run-view panel is keyed on the node's KIND (not a hardcoded role) and surfaces a
// uniform "Last run" brief (the per-node `outcome_detail`) for ANY agent/thinker node — incl. a
// topology-authored CUSTOM node. The Reviewer's §14.1 per-round verdict history must stay identical.

const EMPTY_SPEC_HINT = "No spec yet. Start a run and the product manager drafts the first one.";

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    prompt: null,
    position: { x: 0, y: 0 },
    config: null,
    status: "done",
    iteration: 1,
    invocations: [],
    ...over,
  };
}

function inv(over: Partial<NodeInvocation> & Pick<NodeInvocation, "iteration">): NodeInvocation {
  return {
    status: "done",
    outcome: null,
    outcome_detail: null,
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:01:00Z",
    ...over,
  };
}

describe("SidePanel — generalized 'Last run' brief by node kind (Option A)", () => {
  it("renders a CUSTOM thinker's brief + the PRD body (NOT an empty event feed)", () => {
    const node = gnode({
      id: "n-arch",
      role_name: "architect", // a topology-authored custom role — no hardcoded TITLES entry
      kind: "completion",
      invocations: [
        inv({
          iteration: 2,
          outcome: "prd_written",
          outcome_detail: "Refined the spec (version 2).",
        }),
      ],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    // the custom role is title-cased into the header
    expect(screen.getByText("Architect")).toBeInTheDocument();
    // its per-node work-brief renders (this is the bug fix — a custom node showed a raw feed before)
    expect(screen.getByText("Refined the spec (version 2).")).toBeInTheDocument();
    // the kind-specific body is the PRD view (its empty hint), NOT the event feed
    expect(screen.getByText(EMPTY_SPEC_HINT)).toBeInTheDocument();
    expect(container.querySelector(".tv-feed__note")).toBeNull();
  });

  it("renders an Engineer worker's files-changed brief + the event feed (NOT the PRD)", () => {
    const brief = "Built the feature — changed 2 file(s): greeting.txt, main.py";
    const node = gnode({
      id: "n-eng",
      role_name: "engineer",
      kind: "agent",
      invocations: [inv({ iteration: 1, outcome: "built", outcome_detail: brief })],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    expect(screen.getByText("Engineer")).toBeInTheDocument();
    expect(screen.getByText(brief)).toBeInTheDocument();
    // the kind-specific body is the event feed, NOT the PRD empty hint
    expect(container.querySelector(".tv-feed__note")).not.toBeNull();
    expect(screen.queryByText(EMPTY_SPEC_HINT)).toBeNull();
  });

  it("renders the Reviewer per-round verdicts identical to the §14.1 view", () => {
    const reason = "Missing the overdue-check pure function.";
    const node = gnode({
      id: "n-rev",
      role_name: "reviewer",
      kind: "agent",
      invocations: [
        inv({ iteration: 1, outcome: "changes_requested", outcome_detail: reason }),
        inv({ iteration: 2, outcome: "approved", outcome_detail: null }),
      ],
    });
    const { container } = render(
      <SidePanel node={node} runId={null} run={null} workflowStatus={null} onClose={() => {}} />,
    );
    const round1 = screen.getByText("Round 1");
    const round2 = screen.getByText("Round 2");
    expect(screen.getByText("Changes requested")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(round1.compareDocumentPosition(round2) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the reasons render once, UNDER the changes_requested round only (NOT the approved one)
    expect(screen.getAllByText(reason)).toHaveLength(1);
    const changesLi = screen.getByText("Changes requested").closest("li");
    const approvedLi = screen.getByText("Approved").closest("li");
    expect(within(changesLi as HTMLElement).getByText(reason)).toBeInTheDocument();
    expect((approvedLi as HTMLElement).querySelector(".tv-verdict__reasons")).toBeNull();
    // the §14.1 verdict tones still drive the styling (sage = approved, coral = changes)
    expect(container.querySelector(".tv-verdict--changes")).not.toBeNull();
    expect(container.querySelector(".tv-verdict--approved")).not.toBeNull();
  });
});
