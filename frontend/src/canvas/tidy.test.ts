import { describe, expect, it } from "vitest";

import type { GraphEdge } from "../lib/api";
import { type TidyNode, tidyLayout } from "./tidy";

// M11 (R14, Cnv-Tidy): left to right in flow order — layers by the longest forward path from the
// entry agent, loop-backs and failure edges ignored, gates on their own layer, stable rows.

const AGENT = { width: 164, height: 110 };
const GATE = { width: 140, height: 36 };
const END = { width: 60, height: 50 };
const n = (id: string, kind: string, x: number, y: number): TidyNode => ({
  id,
  kind,
  position: { x, y },
  ...(kind === "gate" ? GATE : kind === "terminal" ? END : AGENT),
});
const e = (id: string, s: string, t: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  id,
  source_node_id: s,
  target_node_id: t,
  edge_type: "default",
  conditions: null,
  ...over,
});

// Positions scattered (Cnv-Tidy's "before"); the PM is the entry.
const nodes = [
  n("rev", "agent", 930, 290),
  n("pm", "completion", 110, 330),
  n("gate", "gate", 360, 280),
  n("eng", "agent", 560, 360),
  n("ship", "terminal", 1180, 210),
  n("ask", "gate", 500, 700),
  n("stop", "terminal", 900, 720),
];
const edges = [
  e("1", "pm", "gate"),
  e("2", "gate", "eng"),
  e("3", "eng", "rev"),
  e("4", "rev", "ship", { conditions: { when: "PASS" } }),
  e("loop", "rev", "eng", { conditions: { loop_limit: 3 } }),
  e("fail", "eng", "ask", { edge_type: "failure" }),
  e("5", "ask", "stop"),
];

const center = (p: { x: number; y: number }, size: { height: number }) => p.y + size.height / 2;

describe("tidyLayout", () => {
  const out = tidyLayout(nodes, edges);

  it("lines the main path up left to right in flow order on one row", () => {
    const order = ["pm", "gate", "eng", "rev", "ship"];
    for (let i = 1; i < order.length; i++)
      expect(out[order[i]].x).toBeGreaterThan(out[order[i - 1]].x);
    // One row: every main-path node shares its centre line (cards, pills and endings alike).
    const c = center(out.pm, AGENT);
    expect(center(out.gate, GATE)).toBe(c);
    expect(center(out.eng, AGENT)).toBe(c);
    expect(center(out.ship, END)).toBe(c);
    // It starts where the entry was.
    expect(out.pm).toEqual({ x: 110, y: 330 });
  });

  it("ignores the loop-back (the Engineer stays before the Reviewer)", () => {
    expect(out.eng.x).toBeLessThan(out.rev.x);
  });

  it("a failure path's target follows its agent, below, on a gate column of its own", () => {
    expect(out.ask.x).toBeGreaterThan(out.eng.x);
    expect(out.ask.y).toBeGreaterThan(out.rev.y);
    // The gate does not share the Reviewer's column.
    expect(out.ask.x).not.toBe(out.rev.x);
    expect(out.stop.x).toBe(out.ship.x);
  });

  it("is deterministic and doesn't depend on the order nodes are listed in", () => {
    expect(tidyLayout([...nodes].reverse(), [...edges].reverse())).toEqual(out);
    expect(tidyLayout(nodes, edges)).toEqual(out);
  });
});
