import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphEdge, GraphNode, HumanTask, RunRow } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// Brief §2.3.2: the status pipeline (deriveNodeStatus / deriveGateState / deriveTerminalState)
// actually reaches the rendered node/gate/terminal, AND — the latent P1.5b bug — ONLY the
// `when === "changes_requested"` edge renders as the ReworkEdge (not "any conditional edge").

const RUN_ID = "rc";

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    position: { x: 0, y: 0 },
    config: null,
    status: "idle",
    iteration: 0,
    invocations: [],
    ...over,
  };
}

function edge(
  over: Partial<GraphEdge> & Pick<GraphEdge, "id" | "source_node_id" | "target_node_id">,
): GraphEdge {
  return { edge_type: "default", conditions: null, ...over };
}

function mkRun(over: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    team_graph_id: "g1",
    idea: "idea",
    status: "awaiting_human",
    pm_document_id: null,
    ship_commit_sha: null,
    ship_tag: null,
    cost_total_usd: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const graph: GraphData = {
  run_id: RUN_ID,
  team_graph_id: "g1",
  nodes: [
    gnode({
      id: "n-eng",
      role_name: "engineer",
      kind: "agent",
      status: "running",
      position: { x: 0, y: 0 },
    }),
    gnode({
      id: "n-rev",
      role_name: "reviewer",
      kind: "agent",
      status: "done",
      position: { x: 220, y: 0 },
    }),
    gnode({
      id: "n-gate",
      role_name: "gate",
      kind: "gate",
      status: "running",
      position: { x: 440, y: 0 },
      config: {
        gate_kind: "prd_approval",
        title: "Approve the PRD",
        description: "Approve to build.",
      },
    }),
    gnode({
      id: "n-ship",
      role_name: "ship",
      kind: "terminal",
      status: "done",
      position: { x: 660, y: 0 },
      config: { terminal_kind: "ship" },
    }),
  ],
  edges: [
    edge({ id: "e-fwd", source_node_id: "n-eng", target_node_id: "n-rev" }),
    // the ONLY rework edge — the calm dashed loop-back
    edge({
      id: "e-rework",
      source_node_id: "n-rev",
      target_node_id: "n-eng",
      conditions: { when: "changes_requested" },
    }),
    // a DIFFERENT conditional edge — must NOT become a rework arc (the guarded bug)
    edge({
      id: "e-reject",
      source_node_id: "n-gate",
      target_node_id: "n-ship",
      conditions: { when: "rejected" },
    }),
  ],
};

const gateTask: HumanTask = {
  id: 1,
  run_id: RUN_ID,
  kind: "prd_approval",
  priority: "high_blocker",
  blocking: true,
  topic: `gate:${RUN_ID}:n-gate`,
  title: "Approve the PRD",
  description: "Approve to build, or reject to stop.",
  status: "pending",
  resolution: null,
  resolution_note: null,
  created_at: "2026-01-01T00:00:00Z",
  resolved_at: null,
};

describe("TeamCanvas — derived status reaches the DOM", () => {
  it("renders each node/gate/terminal with its DERIVED state", () => {
    render(<TeamCanvas graph={graph} run={mkRun()} workflowStatus="PENDING" tasks={[gateTask]} />);
    // deriveNodeStatus: running -> "Working…", done -> "Done"
    expect(screen.getAllByText("Working…").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0);
    // deriveGateState: pending matching task on a live run -> "Awaiting approval"
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    // deriveTerminalState: ship + done -> "Shipped"
    expect(screen.getByText("Shipped")).toBeInTheDocument();
  });
});

describe("TeamCanvas — ONLY changes_requested renders as the rework edge", () => {
  it("styles exactly one rework arc and never promotes another conditional edge to rework", () => {
    const { container } = render(
      <TeamCanvas graph={graph} run={mkRun()} workflowStatus="PENDING" tasks={[gateTask]} />,
    );
    // exactly ONE rework edge (the changes_requested loop-back)
    expect(container.querySelectorAll(".react-flow__edge.rf-edge--rework")).toHaveLength(1);
    // the rejected edge is its OWN category, NOT a rework arc (the latent "any conditional edge
    // -> rework" bug would make this two rework edges)
    expect(container.querySelectorAll(".react-flow__edge.rf-edge--reject")).toHaveLength(1);
    // the rework label renders, once
    expect(screen.getAllByText("changes requested")).toHaveLength(1);
  });
});
