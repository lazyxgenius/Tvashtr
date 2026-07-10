import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphNode, HumanTask } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// M-unify U3: the node card's capability tag reads the EDITS distinction (edits_allowed), not
// Thinker/Worker. edits_allowed true ⇒ "Edits on"; false ⇒ "Edits off" (the muted/read-only tag the
// old thinker used). A node predating the field falls back to the kind-mapped default (agent ⇒ on).
// Mutation-real: on the pre-U3 card an edits-OFF agent (the flipped Reviewer) read "Worker".

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

function capText(container: HTMLElement, nodeId: string): string | null {
  const node = container.querySelector(`[data-id="${nodeId}"]`);
  return node?.querySelector(".rf-node__cap")?.textContent ?? null;
}

const graph: GraphData = {
  run_id: "t1",
  team_graph_id: "t1",
  nodes: [
    // an edits-ON worker → "Edits on"
    gnode({ id: "n-eng", role_name: "engineer", kind: "agent", edits_allowed: true }),
    // an edits-OFF agent (the flipped Reviewer) → "Edits off" (would have read "Worker" pre-U3)
    gnode({
      id: "n-rev",
      role_name: "reviewer",
      kind: "agent",
      edits_allowed: false,
      position: { x: 300, y: 0 },
    }),
    // a completion node with NO edits_allowed → kind fallback (not agent) → "Edits off"
    gnode({ id: "n-pm", role_name: "pm", kind: "completion", position: { x: 600, y: 0 } }),
    // an agent node with NO edits_allowed → kind fallback (agent) → "Edits on"
    gnode({ id: "n-x", role_name: "engineer", kind: "agent", position: { x: 900, y: 0 } }),
  ],
  edges: [],
};

describe("AgentNodeCard — edits-capability tag (M-unify U3)", () => {
  it("labels each node by edits_allowed (with a kind fallback), not Thinker/Worker", () => {
    const { container } = render(
      <TeamCanvas graph={graph} run={null} workflowStatus={null} tasks={NO_TASKS} editable />,
    );
    expect(capText(container, "n-eng")).toBe("Edits on");
    expect(capText(container, "n-rev")).toBe("Edits off"); // an edits-off agent, NOT "Worker"
    expect(capText(container, "n-pm")).toBe("Edits off"); // completion fallback
    expect(capText(container, "n-x")).toBe("Edits on"); // agent fallback
  });
});
