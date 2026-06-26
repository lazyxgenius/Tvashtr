import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphEdge, GraphNode, HumanTask, RunRow } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// Brief §2.3.2: the status pipeline (deriveNodeStatus / deriveGateState / deriveTerminalState)
// actually reaches the rendered node/gate/terminal, AND — P1.8a retopologized the loop-back to
// the no-`when` catch-all `{loop_limit: N}` — ONLY that `loop_limit` loop-back renders as the
// ReworkEdge (a different conditional edge, e.g. the gate's `rejected` route, must NOT).

const RUN_ID = "rc";

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "test-model",
    engine: "openhands",
    prompt: null,
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
    // the ONLY rework edge — the calm dashed loop-back, carrying the real seeded signature
    // (P1.8a: the no-`when` catch-all `{loop_limit: N}`, NOT `{when: "changes_requested"}`)
    edge({
      id: "e-rework",
      source_node_id: "n-rev",
      target_node_id: "n-eng",
      conditions: { loop_limit: 3 },
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

describe("TeamCanvas — ONLY the loop_limit loop-back renders as the rework edge", () => {
  it("styles exactly one rework arc and never promotes another conditional edge to rework", () => {
    const { container } = render(
      <TeamCanvas graph={graph} run={mkRun()} workflowStatus="PENDING" tasks={[gateTask]} />,
    );
    // exactly ONE rework edge (the `loop_limit` loop-back — its real seeded signature)
    expect(container.querySelectorAll(".react-flow__edge.rf-edge--rework")).toHaveLength(1);
    // the rejected edge is its OWN category, NOT a rework arc (proving a different conditional
    // edge isn't promoted to rework — the guarded "any conditional edge -> rework" bug)
    expect(container.querySelectorAll(".react-flow__edge.rf-edge--reject")).toHaveLength(1);
    // the rework label renders, once
    expect(screen.getAllByText("changes requested")).toHaveLength(1);
  });
});

describe("TeamCanvas — run-view selection is by node id, not role_name (Option A)", () => {
  it("selects two same-role nodes independently by their unique node id", () => {
    const picks: (string | null)[] = [];
    const twins: GraphData = {
      run_id: RUN_ID,
      team_graph_id: "g1",
      nodes: [
        gnode({
          id: "n-think-a",
          role_name: "thinker",
          kind: "completion",
          position: { x: 0, y: 0 },
        }),
        gnode({
          id: "n-think-b",
          role_name: "thinker",
          kind: "completion",
          position: { x: 260, y: 0 },
        }),
      ],
      edges: [edge({ id: "e-ab", source_node_id: "n-think-a", target_node_id: "n-think-b" })],
    };
    const { container } = render(
      <TeamCanvas
        graph={twins}
        run={mkRun()}
        workflowStatus="PENDING"
        tasks={[]}
        onSelectNode={(id) => picks.push(id)}
      />,
    );
    const nodeA = container.querySelector('[data-id="n-think-a"]');
    const nodeB = container.querySelector('[data-id="n-think-b"]');
    expect(nodeA).not.toBeNull();
    expect(nodeB).not.toBeNull();
    fireEvent.click(nodeA as HTMLElement);
    fireEvent.click(nodeB as HTMLElement);
    // Each same-role node selects by its OWN id — the bug this fixes: selecting by `role_name`
    // would push "thinker" for BOTH, so the second thinker would show the first's data.
    expect(picks).toEqual(["n-think-a", "n-think-b"]);
  });
});
