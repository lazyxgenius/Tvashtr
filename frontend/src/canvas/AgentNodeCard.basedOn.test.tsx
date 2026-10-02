import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphNode } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// M6 Agents-Use: a card made from a saved agent shows the blue "Strict reviewer v2" chip first in
// its chip row; every existing chip stays.

const node = (over: Partial<GraphNode> & Pick<GraphNode, "id">): GraphNode => ({
  role_name: "reviewer",
  kind: "agent",
  edits_allowed: false,
  model: "xai/grok-4.7",
  engine: "openhands",
  prompt: null,
  position: { x: 0, y: 0 },
  config: null,
  status: "idle",
  iteration: 0,
  invocations: [],
  ...over,
});

describe("AgentNodeCard — based on a saved agent (M6)", () => {
  it("shows the chip before the kept chips, and none on a plain agent", () => {
    const graph: GraphData = {
      run_id: "t1",
      team_graph_id: "t1",
      nodes: [
        node({
          id: "n-rev",
          config: { based_on: { id: "a1", name: "Strict reviewer", version: 2 } },
        }),
        node({ id: "n-eng", role_name: "engineer", position: { x: 400, y: 0 } }),
      ],
      edges: [],
    };
    const { container } = render(
      <TeamCanvas graph={graph} run={null} workflowStatus={null} tasks={[]} editable />,
    );
    const meta = container.querySelector('[data-id="n-rev"] .rf-node__meta') as HTMLElement;
    const chips = [...meta.children].map((c) => c.textContent);
    expect(chips[0]).toBe("Strict reviewer v2");
    expect(meta.firstElementChild).toHaveClass("rf-node__based");
    expect(chips).toContain("Edits off");
    expect(container.querySelector('[data-id="n-eng"] .rf-node__based')).toBeNull();
  });
});
