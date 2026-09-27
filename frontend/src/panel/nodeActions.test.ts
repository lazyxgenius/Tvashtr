import { describe, expect, it } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../lib/api";
import { arrowNeighbours, deleteAgentBody, joinAnd } from "./nodeActions";

const node = (id: string, role_name: string, kind = "agent", config: unknown = null) =>
  ({ id, role_name, kind, model: null, prompt: null, position: {}, config }) as TeamGraphNode;
const edge = (id: string, s: string, t: string): GraphEdge => ({
  id,
  source_node_id: s,
  target_node_id: t,
  edge_type: "default",
  conditions: null,
});

const nodes = [
  node("eng", "engineer"),
  node("rev", "reviewer"),
  node("ship", "ship", "terminal", { terminal_kind: "ship" }),
  node("gate", "g", "gate", { gate_kind: "review_escalation" }),
];

describe("joinAnd", () => {
  it("joins one, two and three names", () => {
    expect(joinAnd([])).toBe("");
    expect(joinAnd(["A"])).toBe("A");
    expect(joinAnd(["A", "B"])).toBe("A and B");
    expect(joinAnd(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("the Delete agent confirm (PANEL-25)", () => {
  const edges = [edge("1", "eng", "rev"), edge("2", "rev", "ship"), edge("3", "rev", "eng")];

  it("names each node the arrows connect it to, once, in arrow order", () => {
    expect(arrowNeighbours("rev", nodes, edges)).toEqual(["Engineer", "Ship"]);
    expect(arrowNeighbours("gate", nodes, edges)).toEqual([]);
  });

  it("says the arrows go too, and that past runs keep their results", () => {
    expect(deleteAgentBody("rev", nodes, edges)).toBe(
      "Its arrows to Engineer and Ship are removed too. Past runs keep their results.",
    );
    expect(deleteAgentBody("gate", nodes, edges)).toBe("Past runs keep their results.");
  });
});
