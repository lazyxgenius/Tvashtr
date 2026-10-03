import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../design-system/components";
import type { GraphData, GraphEdge, GraphNode, HumanTask } from "../lib/api";
import type { TeamGroup } from "../lib/api/canvas";
import { TeamCanvas } from "./TeamCanvas";

// M11 (R14; Cnv-Tidy, Cnv-Group, Cnv-GroupFolded): the canvas's top-left row gains Tidy and Group
// beside "Add to canvas" (kept, with every add option). Tidy lines the team up and offers one Undo;
// groups are labelled frames, renamed inline and folded — never a version, never the walk.

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

const graph: GraphData = {
  run_id: "t",
  team_graph_id: "t",
  nodes: [
    gnode({ id: "n-pm", role_name: "pm", kind: "completion", position: { x: 100, y: 300 } }),
    gnode({ id: "n-eng", role_name: "engineer", kind: "agent", position: { x: 700, y: 50 } }),
    gnode({ id: "n-rev", role_name: "reviewer", kind: "agent", position: { x: 400, y: 500 } }),
  ],
  edges: [
    edge({ id: "e1", source_node_id: "n-pm", target_node_id: "n-eng" }),
    edge({ id: "e2", source_node_id: "n-eng", target_node_id: "n-rev" }),
    edge({
      id: "e-loop",
      source_node_id: "n-rev",
      target_node_id: "n-eng",
      conditions: { loop_limit: 3 },
    }),
  ],
};
const loop = (over: Partial<TeamGroup> = {}): TeamGroup => ({
  id: "g1",
  label: "Review loop",
  node_ids: ["n-eng", "n-rev"],
  folded: false,
  ...over,
});

function setup(groups: TeamGroup[] = []) {
  const props = { onMoveNodes: vi.fn(), onGroupsChange: vi.fn(), onAddNode: vi.fn() };
  const view = render(
    <ToastProvider>
      <TeamCanvas
        graph={graph}
        run={null}
        workflowStatus={null}
        tasks={NO_TASKS}
        editable
        groups={groups}
        {...props}
      />
    </ToastProvider>,
  );
  return { ...props, ...view };
}
const row = () => within(screen.getByRole("toolbar", { name: "Arrange" }));

afterEach(() => vi.useRealTimers());

describe("TeamCanvas — M11 Tidy", () => {
  it("sits beside Add to canvas, explains itself, and keeps every add option", () => {
    setup();
    expect(screen.getByRole("button", { name: "Add to canvas" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    const add = within(screen.getByRole("menu", { name: "Add to canvas" }));
    for (const name of ["Agent", "Gate", "Ship", "Stop", "Query domain"])
      expect(add.getByRole("button", { name })).toBeInTheDocument();
    expect(row().getByRole("button", { name: "Tidy" })).toHaveAccessibleDescription(
      /^Tidy\s*Lines agents up left to right in the order work flows, with gates between them\. Dashed boxes show where they were\.$/,
    );
  });

  it("lines the team up in flow order, saves the positions, shows where they were; Undo puts them back", () => {
    const { onMoveNodes, container } = setup();
    fireEvent.click(row().getByRole("button", { name: "Tidy" }));
    expect(onMoveNodes).toHaveBeenCalledOnce();
    const moved = onMoveNodes.mock.calls[0][0] as Record<string, { x: number; y: number }>;
    expect(moved["n-pm"].x).toBeLessThan(moved["n-eng"].x);
    expect(moved["n-eng"].x).toBeLessThan(moved["n-rev"].x);
    expect(row().getByRole("button", { name: "Tidy" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".cv-ghost").length).toBeGreaterThan(0);
    expect(screen.getByText("Tidied the layout")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onMoveNodes).toHaveBeenLastCalledWith({
      "n-pm": { x: 100, y: 300 },
      "n-eng": { x: 700, y: 50 },
      "n-rev": { x: 400, y: 500 },
    });
    expect(container.querySelectorAll(".cv-ghost")).toHaveLength(0);
  });

  it("the dashed boxes go once the toast does", () => {
    vi.useFakeTimers();
    const { container } = setup();
    fireEvent.click(row().getByRole("button", { name: "Tidy" }));
    expect(container.querySelectorAll(".cv-ghost").length).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(container.querySelectorAll(".cv-ghost")).toHaveLength(0);
  });
});

describe("TeamCanvas — M11 groups", () => {
  it("Group frames the selected agents and asks for its name; Enter keeps it", () => {
    const { onGroupsChange, container } = setup();
    expect(row().getByRole("button", { name: "Group" })).toBeDisabled();
    fireEvent.click(container.querySelector('[data-id="n-eng"]') as HTMLElement);
    fireEvent.keyDown(document, { key: "Control" });
    fireEvent.click(container.querySelector('[data-id="n-rev"]') as HTMLElement, { ctrlKey: true });
    fireEvent.keyUp(document, { key: "Control" });
    fireEvent.click(row().getByRole("button", { name: "Group" }));
    expect(container.querySelector(".cv-group")).not.toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent(
      "Groups are labelsThey help you read a big team and can be folded away. They don’t change how work flows.",
    );
    const name = screen.getByRole("textbox", { name: "Group name" });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: "Review loop" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onGroupsChange).toHaveBeenCalledWith([
      {
        id: expect.any(String) as string,
        label: "Review loop",
        node_ids: ["n-eng", "n-rev"],
        folded: false,
      },
    ]);
  });

  it("Escape (or a blank name) makes no group", () => {
    const { onGroupsChange, container } = setup();
    fireEvent.click(container.querySelector('[data-id="n-eng"]') as HTMLElement);
    fireEvent.click(row().getByRole("button", { name: "Group" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Group name" }), { key: "Escape" });
    expect(container.querySelector(".cv-group")).toBeNull();
    expect(onGroupsChange).not.toHaveBeenCalled();
  });

  it("a saved group: its label, what runs inside, inline rename and fold", () => {
    const { onGroupsChange } = setup([loop()]);
    expect(screen.getByText("Engineer ⇄ Reviewer · up to 3 rounds")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review loop" }));
    const name = screen.getByRole("textbox", { name: "Group name" });
    fireEvent.change(name, { target: { value: "Build and review" } });
    fireEvent.keyDown(name, { key: "Enter" });
    expect(onGroupsChange).toHaveBeenLastCalledWith([loop({ label: "Build and review" })]);
    fireEvent.click(screen.getByRole("button", { name: "Fold Review loop" }));
    expect(onGroupsChange).toHaveBeenLastCalledWith([loop({ folded: true })]);
  });

  it("a folded group is one box; its agents hide, the paths in meet the box; Unfold opens it", () => {
    const { onGroupsChange, container } = setup([loop({ folded: true })]);
    const box = screen.getByRole("group", { name: "Review loop, folded" });
    expect(box).toHaveTextContent("Review loop2 agents · Engineer ⇄ Reviewer · up to 3 rounds");
    expect(container.querySelector('[data-id="n-eng"]')).toBeNull();
    expect(container.querySelector('[data-id="n-pm"]')).not.toBeNull();
    // PM → Engineer now ends at the box; the paths inside the group are gone.
    expect(screen.getByTestId("rf__edge-e1")).toBeInTheDocument();
    expect(screen.queryByTestId("rf__edge-e2")).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Unfold Review loop" }));
    expect(onGroupsChange).toHaveBeenLastCalledWith([loop()]);
  });
});
