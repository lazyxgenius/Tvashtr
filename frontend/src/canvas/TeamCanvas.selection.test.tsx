import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphData, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// The open drawer's node carries the selection ring, but only when the drawer's node changes: a
// selection React Flow makes on its own (a click, a box select) must survive later node updates.

const NO_TASKS: HumanTask[] = [];

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

const graph: GraphData = {
  run_id: "t",
  team_graph_id: "t",
  nodes: [
    gnode({ id: "n-rev", role_name: "reviewer" }),
    gnode({ id: "n-eng", position: { x: 300, y: 0 } }),
    gnode({ id: "n-arch", role_name: "architect", position: { x: 600, y: 0 } }),
  ],
  edges: [],
};

function canvas(selectedNodeId: string | null, g: GraphData | null = graph) {
  return (
    <TeamCanvas
      graph={g}
      run={null}
      workflowStatus={null}
      tasks={NO_TASKS}
      editable
      selectedNodeId={selectedNodeId}
      onSelectNodeId={vi.fn()}
      onAddDownstream={vi.fn()}
      onDeleteNodes={vi.fn()}
      onDeleteEdges={vi.fn()}
    />
  );
}

const selected = (c: HTMLElement) =>
  [...c.querySelectorAll(".react-flow__node.selected")].map((n) => n.getAttribute("data-id"));

describe("TeamCanvas — the drawer's selection ring", () => {
  it("rings the drawer's node, also when the graph arrives after the address opened it", () => {
    const { container, rerender } = render(canvas("n-eng", null));
    rerender(canvas("n-eng"));
    expect(selected(container)).toEqual(["n-eng"]);
    rerender(canvas("n-arch"));
    expect(selected(container)).toEqual(["n-arch"]);
  });

  it("keeps a selection React Flow made itself instead of snapping back to the drawer's node", () => {
    const { container } = render(canvas("n-rev"));
    expect(selected(container)).toEqual(["n-rev"]);
    act(() => {
      fireEvent.click(container.querySelector('[data-id="n-eng"]') as HTMLElement);
    });
    expect(selected(container)).toEqual(["n-eng"]);
  });

  it("leaves React Flow's selection alone while no drawer is open", () => {
    const { container } = render(canvas(null));
    act(() => {
      fireEvent.click(container.querySelector('[data-id="n-arch"]') as HTMLElement);
    });
    expect(selected(container)).toEqual(["n-arch"]);
  });
});
