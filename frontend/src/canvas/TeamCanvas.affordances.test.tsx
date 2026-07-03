import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphData, GraphEdge, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// A STABLE empty-tasks reference — mirrors App's EMPTY_TASKS. TeamCanvas's in-place refresh effect
// lists `tasks` as a dep, so a fresh `[]` default each internal re-render would re-fire it into the
// P1.8d-fix1 render loop; the real App always passes a stable reference, so the test does too.
const NO_TASKS: HumanTask[] = [];

// F1b: the inline authoring affordances wired through TeamCanvas — the node "+" opens the kind
// picker (which hands onAddDownstream the SOURCE id + the picked body), the node trash calls
// onDeleteNodes, and the edge midpoint trash (revealed on hover) calls onDeleteEdges. Mutation-real:
// each asserts the exact id/body handed to the existing CRUD handler. The last case pins that the
// affordances are gated OFF in the run view (F1a's non-editable card stays byte-identical).

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

const graph: GraphData = {
  run_id: "t1",
  team_graph_id: "t1",
  nodes: [
    gnode({ id: "n-pm", role_name: "pm", kind: "completion", position: { x: 0, y: 0 } }),
    gnode({ id: "n-eng", role_name: "engineer", kind: "agent", position: { x: 300, y: 0 } }),
  ],
  edges: [edge({ id: "e1", source_node_id: "n-pm", target_node_id: "n-eng" })],
};

function renderEditable() {
  const onAddDownstream = vi.fn();
  const onDeleteNodes = vi.fn();
  const onDeleteEdges = vi.fn();
  const utils = render(
    <TeamCanvas
      graph={graph}
      run={null}
      workflowStatus={null}
      tasks={NO_TASKS}
      editable
      onAddDownstream={onAddDownstream}
      onDeleteNodes={onDeleteNodes}
      onDeleteEdges={onDeleteEdges}
    />,
  );
  return { ...utils, onAddDownstream, onDeleteNodes, onDeleteEdges };
}

describe("TeamCanvas — inline authoring affordances (F1b)", () => {
  it("the node '+' opens the kind picker; picking Worker adds a downstream node from that source", () => {
    const { container, onAddDownstream } = renderEditable();
    const pmNode = container.querySelector('[data-id="n-pm"]') as HTMLElement;
    // F-canvas-fidelity-2: the node affordances now render on hover (state-driven, not CSS), so hover
    // the node before reaching for its "+".
    fireEvent.mouseOver(pmNode);
    fireEvent.click(within(pmNode).getByRole("button", { name: "Add a downstream node" }));
    const picker = screen.getByRole("dialog", { name: "Add a downstream node" });
    fireEvent.click(within(picker).getByText("Worker"));
    expect(onAddDownstream).toHaveBeenCalledTimes(1);
    expect(onAddDownstream).toHaveBeenCalledWith("n-pm", { node_kind: "worker" });
  });

  it("the node trash deletes exactly that node", () => {
    const { container, onDeleteNodes } = renderEditable();
    const engNode = container.querySelector('[data-id="n-eng"]') as HTMLElement;
    fireEvent.mouseOver(engNode);
    fireEvent.click(within(engNode).getByRole("button", { name: "Delete node" }));
    expect(onDeleteNodes).toHaveBeenCalledWith(["n-eng"]);
  });

  it("hovering an edge reveals a midpoint trash that deletes exactly that edge", () => {
    const { container, onDeleteEdges } = renderEditable();
    const hit = container.querySelector(".react-flow__edge .rf-edge__hit");
    expect(hit).not.toBeNull();
    // the transparent hit-path drives the hover state (mouseOver → React's onMouseEnter)
    fireEvent.mouseOver(hit as Element);
    fireEvent.click(screen.getByRole("button", { name: "Delete connection" }));
    expect(onDeleteEdges).toHaveBeenCalledWith(["e1"]);
  });

  it("renders NO node affordances in the run view (not editable) — F1a's card is untouched", () => {
    const { container } = render(
      <TeamCanvas graph={graph} run={null} workflowStatus={null} tasks={NO_TASKS} />,
    );
    expect(container.querySelector(".rf-node__add")).toBeNull();
    expect(container.querySelector(".rf-node__del")).toBeNull();
  });
});
