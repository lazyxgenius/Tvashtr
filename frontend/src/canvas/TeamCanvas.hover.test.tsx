import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GraphData, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// F-canvas-fidelity-2 Part 1 + Part 3 + Part 5: the node hover affordances now render from React state
// with a 450ms leave grace (not CSS :hover), the "+" shows on every node kind, and the Reviewer card
// caption matches the design. Mutation-real: on the pre-fix code the affordances were always in the DOM
// (CSS-hidden) so "GONE after the grace" fails; the "+" was absent on gate/terminal; the caption differed.

const NO_TASKS: HumanTask[] = [];

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
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
    gnode({ id: "n-rev", role_name: "reviewer", kind: "agent", position: { x: 0, y: 0 } }),
    gnode({
      id: "n-gate",
      role_name: "gate",
      kind: "gate",
      position: { x: 300, y: 0 },
      config: { gate_kind: "prd_approval", title: "Approve", description: "d" },
    }),
    gnode({
      id: "n-ship",
      role_name: "ship",
      kind: "terminal",
      position: { x: 600, y: 0 },
      config: { terminal_kind: "ship" },
    }),
  ],
  edges: [],
};

function renderEditable() {
  return render(
    <TeamCanvas
      graph={graph}
      run={null}
      workflowStatus={null}
      tasks={NO_TASKS}
      editable
      onAddDownstream={vi.fn()}
      onDeleteNodes={vi.fn()}
      onDeleteEdges={vi.fn()}
    />,
  );
}

const ADD = { name: "Add a downstream node" };

afterEach(() => {
  vi.useRealTimers();
});

describe("TeamCanvas — hover-out grace (Part 1)", () => {
  it("renders a node's + / trash on hover, keeps them through the 450ms grace, then removes them", () => {
    vi.useFakeTimers();
    const { container } = renderEditable();
    const node = container.querySelector('[data-id="n-rev"]') as HTMLElement;

    // Not hovered → NO affordances in the DOM (state-driven render, not CSS-hidden).
    expect(within(node).queryByRole("button", ADD)).toBeNull();

    // Hover → the + and the trash render.
    act(() => {
      fireEvent.mouseOver(node);
    });
    expect(within(node).getByRole("button", ADD)).toBeInTheDocument();
    expect(within(node).getByRole("button", { name: "Delete node" })).toBeInTheDocument();

    // Leave → STILL rendered before the 450ms grace elapses (the operator's headline ask).
    act(() => {
      fireEvent.mouseOut(node);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(within(node).getByRole("button", ADD)).toBeInTheDocument();

    // Past the grace → GONE.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(within(node).queryByRole("button", ADD)).toBeNull();
  });

  it("keeps a hovered node's affordances across a topology rebuild (add/delete)", () => {
    const { container, rerender } = renderEditable();
    const node = container.querySelector('[data-id="n-rev"]') as HTMLElement;
    act(() => {
      fireEvent.mouseOver(node);
    });
    expect(within(node).getByRole("button", ADD)).toBeInTheDocument();

    // A topology change (add a node) rebuilds the node set while the source node is still hovered.
    const graph2: GraphData = {
      ...graph,
      nodes: [
        ...graph.nodes,
        gnode({ id: "n-new", role_name: "engineer", kind: "agent", position: { x: 900, y: 0 } }),
      ],
    };
    rerender(
      <TeamCanvas
        graph={graph2}
        run={null}
        workflowStatus={null}
        tasks={NO_TASKS}
        editable
        onAddDownstream={vi.fn()}
        onDeleteNodes={vi.fn()}
        onDeleteEdges={vi.fn()}
      />,
    );
    // Still rendered — the rebuild seeds `hovered` from the current hover state (pre-fix it dropped it).
    const after = container.querySelector('[data-id="n-rev"]') as HTMLElement;
    expect(within(after).getByRole("button", ADD)).toBeInTheDocument();
  });
});

describe("TeamCanvas — the '+' affordance on every node kind (Part 3)", () => {
  it("shows the add-downstream '+' on a gate and a terminal (author, on hover)", () => {
    const { container } = renderEditable();

    const gate = container.querySelector('[data-id="n-gate"]') as HTMLElement;
    act(() => {
      fireEvent.mouseOver(gate);
    });
    expect(within(gate).getByRole("button", ADD)).toBeInTheDocument();

    const ship = container.querySelector('[data-id="n-ship"]') as HTMLElement;
    act(() => {
      fireEvent.mouseOver(ship);
    });
    expect(within(ship).getByRole("button", ADD)).toBeInTheDocument();
  });
});

describe("AgentNodeCard — caption fidelity (Part 5)", () => {
  it("the Reviewer card reads the design's shorter 'Checks against the spec'", () => {
    renderEditable();
    expect(screen.getByText("Checks against the spec")).toBeInTheDocument();
  });
});
