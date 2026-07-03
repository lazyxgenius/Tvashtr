import { MarkerType } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphEdge, GraphNode } from "../lib/api";
import type { ValidityFlags } from "../lib/topology";
import { buildEdges } from "./edges";

// F-canvas-fidelity-2 Part 2: EVERY edge must end in a state-colored arrowhead. Before this pass a
// plain forward `work` edge left `markerEnd` UNDEFINED — so these assertions fail on the pre-fix code.

const NO_FLAGS: ValidityFlags = {
  nodeErrors: new Map(),
  edgeErrors: new Map(),
  orphans: new Set(),
};
const noop = () => {};

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id">): GraphNode {
  return {
    role_name: "engineer",
    kind: "agent",
    model: "m",
    engine: null,
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

// a done → b running → done ; plus an idle→idle forward, a reject branch, and a loop-back.
const graph: GraphData = {
  run_id: "t",
  team_graph_id: "t",
  nodes: [
    gnode({ id: "a", status: "done", position: { x: 0, y: 0 } }),
    gnode({ id: "b", status: "running", position: { x: 300, y: 0 } }),
    gnode({ id: "c", status: "done", position: { x: 600, y: 0 } }),
    gnode({ id: "d", status: "done", position: { x: 900, y: 0 } }),
    gnode({ id: "e", status: "idle", position: { x: 0, y: 300 } }),
    gnode({ id: "f", status: "idle", position: { x: 300, y: 300 } }),
  ],
  edges: [
    edge({ id: "flow", source_node_id: "a", target_node_id: "b" }), // target running → flow
    edge({ id: "done", source_node_id: "c", target_node_id: "d" }), // both done → done
    edge({ id: "fwd", source_node_id: "e", target_node_id: "f" }), // idle → idle → neutral
    edge({
      id: "reject",
      source_node_id: "a",
      target_node_id: "c",
      conditions: { when: "rejected" },
    }),
    edge({ id: "rework", source_node_id: "b", target_node_id: "a", conditions: { loop_limit: 3 } }),
  ],
};

describe("buildEdges — every edge carries a state-colored arrowhead (Part 2)", () => {
  const built = buildEdges(graph, NO_FLAGS, true, null, noop, noop);
  const byId = Object.fromEntries(built.map((e) => [e.id, e]));

  it("EVERY edge ends in an ArrowClosed markerEnd (a forward edge had none before this pass)", () => {
    expect(built).toHaveLength(5);
    for (const e of built) {
      expect(e.markerEnd).toBeTruthy();
      expect(e.markerEnd).toMatchObject({ type: MarkerType.ArrowClosed });
    }
  });

  it("colors the arrowhead by state: forward neutral, flowing coral, done sage", () => {
    expect(byId.fwd.markerEnd).toMatchObject({ color: "var(--border-strong)" });
    expect(byId.flow.markerEnd).toMatchObject({ color: "var(--coral-500)" });
    expect(byId.done.markerEnd).toMatchObject({ color: "var(--sage-500)" });
  });

  it("keeps the branch (reject) muted and the rework (loop-back) coral", () => {
    expect(byId.reject.markerEnd).toMatchObject({ color: "var(--branch-stroke)" });
    expect(byId.rework.markerEnd).toMatchObject({ color: "var(--rework-stroke)" });
    expect(byId.rework.type).toBe("rework");
    expect(byId.fwd.type).toBe("work");
  });
});
