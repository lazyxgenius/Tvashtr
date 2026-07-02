import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphData, GraphEdge, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// F1c Decision 3: the node card's model chip (`.rf-node__model`) is the express lane to the drawer's
// Model field. In AUTHOR mode a click calls `onOpenModel(nodeId)` AND stops the bubble to the node
// select (so the drawer opens focused on Model, not at the top). In the RUN view the chip is inert —
// a click is just a card click (React Flow's `onNodeClick` → `onSelectNode`), no model-focus handler.

const NO_TASKS: HumanTask[] = [];

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "openai/gpt-4o-mini",
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

const graph: GraphData = {
  run_id: "t1",
  team_graph_id: "t1",
  nodes: [
    gnode({ id: "n-pm", role_name: "pm", kind: "completion", position: { x: 0, y: 0 } }),
    gnode({ id: "n-eng", role_name: "engineer", kind: "agent", position: { x: 300, y: 0 } }),
  ],
  edges: [edge({ id: "e1", source_node_id: "n-pm", target_node_id: "n-eng" })],
};

describe("AgentNodeCard model chip (F1c Decision 3)", () => {
  it("author mode: clicking the model chip opens the Model field (onOpenModel) WITHOUT selecting the node", () => {
    const onOpenModel = vi.fn();
    const onSelectNodeId = vi.fn();
    const { container } = render(
      <TeamCanvas
        graph={graph}
        run={null}
        workflowStatus={null}
        tasks={NO_TASKS}
        editable
        onOpenModel={onOpenModel}
        onSelectNodeId={onSelectNodeId}
      />,
    );
    const engNode = container.querySelector('[data-id="n-eng"]') as HTMLElement;
    const chip = engNode.querySelector(".rf-node__model") as HTMLElement;
    expect(chip).not.toBeNull();

    fireEvent.click(chip);
    // The chip is the model express lane — it opens the drawer focused on Model for THIS node…
    expect(onOpenModel).toHaveBeenCalledTimes(1);
    expect(onOpenModel).toHaveBeenCalledWith("n-eng");
    // …and stopPropagation kept the click off the node-select handler (no top-of-drawer open).
    expect(onSelectNodeId).not.toHaveBeenCalled();
  });

  it("run view: the chip is inert — a click is a plain card select (no onOpenModel handler)", () => {
    const onSelectNode = vi.fn();
    const { container } = render(
      <TeamCanvas
        graph={graph}
        run={null}
        workflowStatus={null}
        tasks={NO_TASKS}
        onSelectNode={onSelectNode}
      />,
    );
    const engNode = container.querySelector('[data-id="n-eng"]') as HTMLElement;
    const chip = engNode.querySelector(".rf-node__model") as HTMLElement;
    expect(chip).not.toBeNull();

    fireEvent.click(chip);
    // No special model-focus handling — the click bubbles to onNodeClick → onSelectNode (a card click).
    expect(onSelectNode).toHaveBeenCalledWith("n-eng");
  });
});
