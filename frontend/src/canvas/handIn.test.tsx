import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GraphData, GraphNode, HumanTask } from "../lib/api";
import { __resetBackendStatusForTests } from "../lib/backendStatus";
import { HAND_IN_HINT } from "./runBlocked";
import { CanvasToolbar } from "./CanvasToolbar";
import { TeamCanvas } from "./TeamCanvas";
import { ExamplesGrantLine, HandInBody } from "../panel/legacy/HandInBody";

// M2 (prompts/m2-design/ExampleBuilder.dc.html): the canvas's new parts — the Hand in node (its
// glyph, label and one line), the Writer's "Source check built in" mark, the toolbar pill and the
// disabled Run with its hint, and the Hand in drawer's words.

function gnode(over: Partial<GraphNode> & Pick<GraphNode, "id" | "role_name" | "kind">): GraphNode {
  return {
    model: "vertex_ai/gemini-3-flash-preview",
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

const graph: GraphData = {
  run_id: "t1",
  team_graph_id: "t1",
  nodes: [
    gnode({
      id: "w",
      role_name: "writer",
      kind: "agent",
      config: { title: "Writer", description: "Drafts each test and training example." },
      ...({ tool_config: { tvashtr: { examples: "write" } } } as object),
    }),
    gnode({
      id: "r",
      role_name: "reviewer",
      kind: "agent",
      position: { x: 300, y: 0 },
      ...({ tool_config: { tvashtr: { examples: "review" } } } as object),
    }),
    gnode({
      id: "h",
      role_name: "hand_in",
      kind: "terminal",
      model: "",
      engine: null,
      position: { x: 300, y: 300 },
      config: { terminal_kind: "hand_in" },
    }),
  ],
  edges: [],
};

const NO_TASKS: HumanTask[] = [];

beforeEach(() => {
  __resetBackendStatusForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: "ok", db: "ok" })))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("M2 — Hand in on the canvas", () => {
  it("draws Hand in with its line, and marks only the Writer", () => {
    const { container } = render(
      <TeamCanvas graph={graph} run={null} workflowStatus={null} tasks={NO_TASKS} editable />,
    );
    const hand = container.querySelector('[data-id="h"]') as HTMLElement;
    expect(hand.querySelector(".rf-node__role")?.textContent).toBe("Hand in");
    expect(hand.textContent).toContain("Hands the drafts to the model you started from.");
    const writer = container.querySelector('[data-id="w"]') as HTMLElement;
    const reviewer = container.querySelector('[data-id="r"]') as HTMLElement;
    expect(writer.textContent).toContain("Source check built in");
    expect(reviewer.textContent).not.toContain("Source check built in");
  });

  it("the Hand in node reads Handed in once the walk reached it", () => {
    const reached: GraphData = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === "h" ? { ...n, status: "done" } : n)),
    };
    const { container } = render(
      <TeamCanvas graph={reached} run={null} workflowStatus={null} tasks={NO_TASKS} editable />,
    );
    const hand = container.querySelector('[data-id="h"]') as HTMLElement;
    expect(hand.querySelector(".rf-node__role")?.textContent).toBe("Handed in");
  });

  it("the toolbar shows the pill, and Run is disabled with the hint", () => {
    render(
      <CanvasToolbar
        run={{ disabled: true, title: HAND_IN_HINT, onRun: vi.fn() }}
        teamName="Example builder"
        spend="$0.00"
        handsIn
      />,
    );
    expect(screen.getByText("Ends in Hand in · start it from a model")).toBeInTheDocument();
    const run = screen.getByRole("button", { name: /Run this team/ });
    expect(run).toBeDisabled();
    expect(run).toHaveAttribute(
      "title",
      "This team hands in examples. Start it from a model: Models, your model, Draft with a team.",
    );
  });

  it("the Hand in drawer says what is always on and what can change", () => {
    render(<HandInBody />);
    expect(
      screen.getByText(
        "The drafts go to the model you start this team from, on its Drafts tab. Nothing joins its tests or training examples until you accept it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Source check")).toBeInTheDocument();
    expect(screen.getByText("Tests stay apart")).toBeInTheDocument();
    expect(screen.getAllByText("Built in")).toHaveLength(2);
    expect(screen.getByText("You can change")).toBeInTheDocument();
  });

  it("the agent panel shows the grant as one read-only line", () => {
    const { rerender } = render(
      <ExamplesGrantLine toolConfig={{ tvashtr: { examples: "write" } }} />,
    );
    expect(screen.getByText("Can hand in examples")).toBeInTheDocument();
    rerender(<ExamplesGrantLine toolConfig={{ tvashtr: { examples: "review" } }} />);
    expect(screen.getByText("Can review examples")).toBeInTheDocument();
    rerender(<ExamplesGrantLine toolConfig={null} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});
