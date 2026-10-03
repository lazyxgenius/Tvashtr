import { describe, expect, it } from "vitest";

import type { GraphData } from "../lib/api";
import { loopSummary } from "./groups";

// M11 (R14, Cnv-Group): the line a group shows when a loop runs inside it.

const node = (id: string, role_name: string) => ({ id, role_name, kind: "agent", config: null });
const graph = (loop_limit: number) =>
  ({
    nodes: [node("eng", "engineer"), node("rev", "reviewer")],
    edges: [
      {
        id: "l",
        source_node_id: "rev",
        target_node_id: "eng",
        edge_type: "default",
        conditions: { loop_limit },
      },
    ],
  }) as unknown as GraphData;
const group = { id: "g", label: "Review loop", node_ids: ["eng", "rev"], folded: false };

describe("loopSummary", () => {
  it("counts its rounds", () => {
    expect(loopSummary(group, graph(3))).toBe("Engineer ⇄ Reviewer · up to 3 rounds");
    expect(loopSummary(group, graph(1))).toBe("Engineer ⇄ Reviewer · up to 1 round");
  });
});
