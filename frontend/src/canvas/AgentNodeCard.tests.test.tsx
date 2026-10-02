import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GraphData, GraphNode, TeamGraphNode } from "../lib/api";
import { TeamCanvas } from "./TeamCanvas";

// M7 Test-Chips: the agent card's tests chip after the kept chips — "● Testing 3 of 6" (coral)
// while testing, "5 of 6 tests" (sage; neutral after a stopped run), "6 tests" before any run
// (neutral), none without tests.

const node = (id: string, tests: TeamGraphNode["tests"], x: number): GraphNode =>
  ({
    id,
    role_name: "reviewer",
    kind: "agent",
    edits_allowed: false,
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: null,
    position: { x, y: 0 },
    config: null,
    status: "idle",
    iteration: 0,
    invocations: [],
    tests,
  }) as GraphNode;

describe("AgentNodeCard — the tests chip (M7)", () => {
  it("each state, after the kept chips", () => {
    const graph: GraphData = {
      run_id: "t1",
      team_graph_id: "t1",
      nodes: [
        node("live", { total: 6, passed: 5, ran: 6, running: { done: 2, total: 6 } }, 0),
        node("ran", { total: 6, passed: 5, ran: 6, running: null }, 300),
        node("stopped", { total: 6, passed: 2, ran: 6, running: null, stopped: true }, 600),
        node("never", { total: 6, passed: null, ran: null, running: null }, 900),
        node("none", null, 1200),
      ],
      edges: [],
    };
    const { container } = render(
      <TeamCanvas graph={graph} run={null} workflowStatus={null} tasks={[]} editable />,
    );
    const chip = (id: string) => container.querySelector(`[data-id="${id}"] .rf-node__tests`);
    expect(chip("live")).toHaveTextContent("● Testing 3 of 6");
    expect(chip("live")).toHaveClass("rf-node__tests--live");
    expect(chip("ran")).toHaveTextContent("5 of 6 tests");
    expect(chip("ran")).toHaveClass("rf-node__tests--good");
    expect(chip("stopped")).toHaveTextContent("2 of 6 tests");
    expect(chip("stopped")).not.toHaveClass("rf-node__tests--good");
    expect(chip("never")).toHaveTextContent("6 tests");
    expect(chip("never")).not.toHaveClass("rf-node__tests--good");
    expect(chip("none")).toBeNull();
    // Last in the row; the kept chips stay.
    const meta = container.querySelector('[data-id="ran"] .rf-node__meta') as HTMLElement;
    expect(meta.lastElementChild).toHaveClass("rf-node__tests");
    expect([...meta.children].map((c) => c.textContent)).toContain("Edits off");
  });
});
