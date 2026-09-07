import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphNode, RunRow } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// M-live D3: when the launch pre-flight refuses (no key for a provider, or a model the provider no
// longer serves), the 422 names the offending nodes by ROLE. The banner shows the reason; these
// tests pin that the same fact reaches the CANVAS, so the user's eye lands on the cards to fix.
// The refusal reuses the existing `tv-node--invalid` affordance rather than a second error style.

function gnode(id: string, role: string): GraphNode {
  return {
    id,
    role_name: role,
    kind: "agent",
    model: "nvidia_nim/meta/llama-3.3-70b-instruct",
    engine: "openhands",
    prompt: null,
    position: { x: 0, y: 0 },
    config: null,
    status: "idle",
    iteration: 0,
    invocations: [],
  };
}

const GRAPH: GraphData = {
  run_id: "r1",
  team_graph_id: "g1",
  nodes: [gnode("n-pm", "pm"), gnode("n-eng", "engineer"), gnode("n-rev", "reviewer")],
  edges: [],
};

const RUN: RunRow = {
  id: "r1",
  team_graph_id: "g1",
  idea: "idea",
  status: "awaiting_human",
  pm_document_id: null,
  ship_commit_sha: null,
  ship_tag: null,
  cost_total_usd: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const REASON =
  "nvidia_nim/meta/llama-3.3-70b-instruct is no longer served by nvidia_nim — used by engineer, pm.";

function renderCanvas(blockedNodes: string[], blockedReason = REASON) {
  return render(
    <TeamCanvas
      graph={GRAPH}
      run={RUN}
      workflowStatus="PENDING"
      tasks={[]}
      blockedNodes={blockedNodes}
      blockedReason={blockedReason}
    />,
  );
}

describe("M-live D3: a refused launch marks the nodes it named", () => {
  it("marks exactly the offending nodes invalid, and leaves the others alone", () => {
    const { container } = renderCanvas(["engineer", "pm"]);
    const invalid = container.querySelectorAll(".tv-node--invalid");
    expect(invalid.length).toBe(2);
    // the reason travels with the mark, so hovering a card explains WHY it is flagged
    expect(Array.from(invalid).every((el) => el.getAttribute("title") === REASON)).toBe(true);
  });

  it("marks nothing when the launch was not refused", () => {
    const { container } = renderCanvas([]);
    expect(container.querySelectorAll(".tv-node--invalid").length).toBe(0);
  });

  it("ignores a role name that matches no node rather than throwing", () => {
    const { container } = renderCanvas(["architect"]);
    expect(container.querySelectorAll(".tv-node--invalid").length).toBe(0);
  });
});
