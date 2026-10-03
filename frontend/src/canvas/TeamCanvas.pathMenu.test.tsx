import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GraphData, GraphEdge, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// M11 (R13; Cnv-FailPath, Cnv-FailPathOne, Cnv-TimeLimit): clicking an agent's path opens
// "Use this path…" — Always / When the agent says… / If it fails or times out — with, on the failure
// path, the agent's Time limit, and Delete this path. One failure path per agent.

const NO_TASKS: HumanTask[] = [];
const gnode = (over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">) => ({
  model: "m",
  engine: null,
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
  status: "idle",
  iteration: 0,
  invocations: [],
  ...over,
});
const edge = (
  over: Partial<GraphEdge> & Pick<GraphEdge, "id" | "source_node_id" | "target_node_id">,
) => ({ edge_type: "default", conditions: null, ...over });

const graph = (engConfig: Record<string, unknown> | null = null): GraphData => ({
  run_id: "t",
  team_graph_id: "t",
  nodes: [
    gnode({ id: "n-gate", role_name: "gate", kind: "gate", position: { x: 0, y: 0 } }),
    gnode({
      id: "n-eng",
      role_name: "engineer",
      kind: "agent",
      position: { x: 300, y: 0 },
      config: engConfig,
    }),
    gnode({ id: "n-rev", role_name: "reviewer", kind: "agent", position: { x: 600, y: 0 } }),
    gnode({ id: "n-ask", role_name: "gate", kind: "gate", position: { x: 300, y: 300 } }),
  ],
  edges: [
    edge({ id: "e-gate", source_node_id: "n-gate", target_node_id: "n-eng" }),
    edge({ id: "e-fwd", source_node_id: "n-eng", target_node_id: "n-rev" }),
    edge({ id: "e-fail", source_node_id: "n-eng", target_node_id: "n-ask", edge_type: "failure" }),
    edge({
      id: "e-loop",
      source_node_id: "n-rev",
      target_node_id: "n-eng",
      conditions: { loop_limit: 3 },
    }),
  ],
});

function setup(engConfig: Record<string, unknown> | null = null) {
  const props = {
    onEdgeUse: vi.fn(),
    onTimeLimit: vi.fn(),
    onDeleteEdges: vi.fn(),
  };
  render(
    <TeamCanvas
      graph={graph(engConfig)}
      run={null}
      workflowStatus={null}
      tasks={NO_TASKS}
      editable
      {...props}
    />,
  );
  return props;
}
const menu = () => screen.getByRole("menu", { name: "Use this path" });
const clickEdge = (id: string) => fireEvent.click(screen.getByTestId(`rf__edge-${id}`));

describe("TeamCanvas — M11 the path menu", () => {
  it("the failure path draws its label and opens with its use marked, Time limit and Delete", () => {
    setup({ time_limit_s: 600 });
    expect(screen.getByText("If it fails or times out")).toHaveClass("rf-edge__label--failure");
    clickEdge("e-fail");
    const m = within(menu());
    expect(m.getByText("Use this path…")).toBeInTheDocument();
    expect(m.getByRole("menuitem", { name: "Always" })).not.toHaveClass("cv-pmenu__item--on");
    expect(m.getByRole("menuitem", { name: /When the agent says…/ })).toHaveTextContent(
      "an outcome",
    );
    expect(m.getByRole("menuitem", { name: "If it fails or times out" })).toHaveClass(
      "cv-pmenu__item--on",
    );
    expect(m.getByRole("menuitem", { name: /Time limit/ })).toHaveTextContent("10 min");
    expect(m.getByRole("menuitem", { name: "Delete this path" })).toBeInTheDocument();
  });

  it("another path of an agent with a failure path: the row is disabled, 'it has one'; no Time limit", () => {
    const p = setup();
    clickEdge("e-fwd");
    const m = within(menu());
    expect(m.getByRole("menuitem", { name: "Always" })).toHaveClass("cv-pmenu__item--on");
    const fail = m.getByRole("menuitem", { name: /If it fails or times out/ });
    expect(fail).toBeDisabled();
    expect(fail).toHaveTextContent("it has one");
    expect(m.queryByRole("menuitem", { name: /Time limit/ })).toBeNull();
    fireEvent.click(m.getByRole("menuitem", { name: /When the agent says…/ }));
    // No outcome word on this path yet: the canvas's own path editor asks for one (a branch needs
    // its word — the server refuses one without), and only then is the path changed.
    expect(screen.queryByRole("menu", { name: "Use this path" })).toBeNull();
    expect(p.onEdgeUse).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Routing label"), { target: { value: "PASS" } });
    fireEvent.click(screen.getByRole("button", { name: "When it outputs “PASS” →" }));
    expect(p.onEdgeUse).toHaveBeenCalledWith("e-fwd", "branch", "PASS");
  });

  it("Time limit opens its choices beside the menu; a pick saves the agent's limit", () => {
    const p = setup();
    clickEdge("e-fail");
    fireEvent.click(within(menu()).getByRole("menuitem", { name: /Time limit/ }));
    const limits = within(screen.getByRole("menu", { name: "Time limit" }));
    expect(
      limits.getByText("If the Engineer works longer, it stops and this path is taken."),
    ).toBeInTheDocument();
    expect(limits.getAllByRole("menuitemradio").map((b) => b.textContent)).toEqual([
      "5 min",
      "10 min",
      "20 minthe default",
      "30 min",
      "1 hour",
    ]);
    expect(limits.getByRole("menuitemradio", { name: /20 min/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(limits.getByRole("menuitemradio", { name: "30 min" }));
    expect(p.onTimeLimit).toHaveBeenCalledWith("n-eng", 1800);
  });

  it("Always / If it fails PATCH the use; Delete this path deletes; Escape closes", () => {
    const p = setup();
    clickEdge("e-fail");
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Always" }));
    expect(p.onEdgeUse).toHaveBeenCalledWith("e-fail", "forward", undefined);
    clickEdge("e-fail");
    fireEvent.click(within(menu()).getByRole("menuitem", { name: "Delete this path" }));
    expect(p.onDeleteEdges).toHaveBeenCalledWith(["e-fail"]);
    clickEdge("e-fwd");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Use this path" })).toBeNull();
  });

  it("a gate's path and a loop-back keep today's behaviour (no menu)", () => {
    setup();
    clickEdge("e-gate");
    clickEdge("e-loop");
    expect(screen.queryByRole("menu", { name: "Use this path" })).toBeNull();
  });
});
