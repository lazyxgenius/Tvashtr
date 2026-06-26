import { describe, expect, it } from "vitest";

import type { GraphEdge, TeamGraphNode } from "./api";
import {
  applyEmitContract,
  branchLabelsOf,
  closesLoop,
  edgeRoleOptions,
  emitContract,
  nextDropPosition,
  validityFlags,
  withLayout,
} from "./topology";

function edge(
  id: string,
  s: string,
  t: string,
  conditions: GraphEdge["conditions"] = null,
  edge_type = "work",
): GraphEdge {
  return { id, source_node_id: s, target_node_id: t, edge_type, conditions };
}
function node(id: string, kind: string, position = { x: 0, y: 0 }): TeamGraphNode {
  return {
    id,
    role_name: kind,
    kind,
    model: null,
    engine: null,
    prompt: "",
    position,
    config: null,
  };
}

describe("edgeRoleOptions — offer only what the source supports", () => {
  it("a thinker only goes forward", () => {
    const opts = edgeRoleOptions("completion", false);
    expect(opts.map((o) => o.role)).toEqual(["forward"]);
  });

  it("a gate branches on approved/rejected", () => {
    const opts = edgeRoleOptions("gate", false);
    expect(opts.map((o) => o.presetLabel)).toEqual(["approved", "rejected"]);
    expect(opts.every((o) => o.role === "branch")).toBe(true);
  });

  it("a worker goes forward or branches on a label", () => {
    const opts = edgeRoleOptions("agent", false);
    expect(opts.map((o) => o.role)).toEqual(["forward", "branch"]);
    expect(opts.find((o) => o.role === "branch")?.needsLabel).toBe(true);
  });

  it("an edge that closes a loop is offered only as a bounded rework loop", () => {
    const opts = edgeRoleOptions("agent", true);
    expect(opts).toHaveLength(1);
    expect(opts[0].role).toBe("loop_back");
    expect(opts[0].isLoop).toBe(true);
  });

  it("a terminal has no outgoing step", () => {
    expect(edgeRoleOptions("terminal", false)).toEqual([]);
  });
});

describe("closesLoop", () => {
  const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
  it("c → a closes the loop (a is upstream of c)", () => {
    expect(closesLoop(edges, "c", "a")).toBe(true);
  });
  it("a → c does not close a loop (c is downstream)", () => {
    expect(closesLoop(edges, "a", "c")).toBe(false);
  });
  it("a self-edge closes a loop", () => {
    expect(closesLoop(edges, "a", "a")).toBe(true);
  });
});

describe("branchLabelsOf", () => {
  it("collects the distinct when-labels on a node's branch out-edges", () => {
    const edges = [
      edge("e1", "r", "ship", { when: "PASS" }),
      edge("e2", "r", "eng", { loop_limit: 3 }),
      edge("e3", "r", "stop", { when: "FAIL" }),
    ];
    expect(branchLabelsOf(edges, "r").sort()).toEqual(["FAIL", "PASS"]);
  });
});

describe("validityFlags", () => {
  it("buckets errors by node/edge id and collects orphan warnings", () => {
    const flags = validityFlags({
      runnable: false,
      errors: [
        { code: "root_not_thinker", message: "must be a thinker", node_id: "n1", edge_id: null },
        { code: "loop_no_exit", message: "no exit", node_id: "n2", edge_id: "e9" },
      ],
      warnings: [{ code: "orphan", message: "never reached", node_id: "n3", edge_id: null }],
    });
    expect(flags.nodeErrors.get("n1")).toMatch(/thinker/);
    expect(flags.edgeErrors.get("e9")).toMatch(/no exit/);
    expect(flags.orphans.has("n3")).toBe(true);
  });
});

describe("emitContract + applyEmitContract", () => {
  const edges = [
    edge("e1", "r", "ship", { when: "PASS" }),
    edge("e2", "r", "eng", { loop_limit: 3 }),
  ];

  it("derives the contract from the worker's branch labels", () => {
    const c = emitContract("r", edges)!;
    expect(c.labels).toEqual(["PASS"]);
    expect(c.summary).toMatch(/PASS/);
    expect(c.promptBlock).toMatch(/REVIEW_VERDICT\.json/);
  });

  it("returns null for a worker with no branch out-edge", () => {
    expect(emitContract("eng", edges)).toBeNull();
  });

  it("writing the contract twice replaces the block instead of stacking it", () => {
    const c = emitContract("r", edges)!;
    const once = applyEmitContract("Review the build.", c.promptBlock);
    const twice = applyEmitContract(once, c.promptBlock);
    expect(twice).toBe(once); // idempotent — one contract block
    expect((twice.match(/REVIEW_VERDICT\.json/g) ?? []).length).toBe(1);
  });
});

describe("withLayout + nextDropPosition", () => {
  it("fills positions for nodes with none, leaving real ones untouched", () => {
    const nodes = [
      node("a", "completion", { x: 0, y: 0 }), // no real position
      node("b", "agent", { x: 500, y: 40 }), // real — keep
    ];
    const edges = [edge("e1", "a", "b")];
    const pos = withLayout(nodes, edges);
    expect(pos["b"]).toEqual({ x: 500, y: 40 });
    expect(Number.isFinite(pos["a"].x)).toBe(true);
  });

  // P1.8d-fix1 (second loop source): a CYCLIC team (a `loop_limit` loop-back — the review-loop's
  // engineer⇄reviewer) must not spin the longest-path BFS forever. Pre-fix this call never RETURNED
  // (an unbounded depth around the cycle pegged the main thread); this test would hang. The cycle-
  // depth cap makes it terminate and still lay out left-to-right from the root.
  it("terminates and lays out a CYCLIC graph (a loop-back never spins the layout forever)", () => {
    const nodes = [
      node("pm", "completion", { x: 0, y: 0 }), // root, no position → forces the BFS to run
      node("eng", "agent", { x: 0, y: 0 }),
      node("rev", "agent", { x: 0, y: 0 }),
      node("ship", "terminal", { x: 0, y: 0 }),
    ];
    const edges = [
      edge("e1", "pm", "eng"),
      edge("e2", "eng", "rev"),
      edge("e3", "rev", "eng"), // the loop-back — forms the engineer⇄reviewer cycle
      edge("e4", "rev", "ship"),
    ];
    const pos = withLayout(nodes, edges); // must RETURN (no infinite loop) — the regression
    for (const n of nodes) {
      expect(Number.isFinite(pos[n.id].x)).toBe(true);
      expect(Number.isFinite(pos[n.id].y)).toBe(true);
    }
    // the layering still advances left-to-right from the root.
    expect(pos["pm"].x).toBe(0);
    expect(pos["eng"].x).toBeGreaterThan(pos["pm"].x);
  });

  it("drops a new node to the right of the rightmost", () => {
    const nodes = [node("a", "completion", { x: 0, y: 0 }), node("b", "agent", { x: 300, y: 0 })];
    expect(nextDropPosition(nodes)).toEqual({ x: 560, y: 0 });
  });
});
