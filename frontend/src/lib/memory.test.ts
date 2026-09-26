import { describe, expect, it } from "vitest";

import type { NodeMemoryRow } from "./api";
import { POLARITY_META, polarityRank, reposOf, TIER_LABEL, usedFacts } from "./memory";

function row(over: Partial<NodeMemoryRow> = {}): NodeMemoryRow {
  return {
    id: "m1",
    content: "a fact",
    polarity: "context",
    repo_key: null,
    node_id: null,
    tier: "account",
    pinned: false,
    status: "active",
    confirmation_count: 1,
    source_run_id: null,
    source_invocation_id: null,
    embedding_dim: 1536,
    valid_from: null,
    invalid_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: null,
    ...over,
  };
}

describe("POLARITY_META", () => {
  it("maps every force to its RFC-2119 label", () => {
    expect(POLARITY_META.require.label).toBe("MUST");
    expect(POLARITY_META.forbid.label).toBe("MUST NOT");
    expect(POLARITY_META.prefer.label).toBe("SHOULD");
    expect(POLARITY_META.avoid.label).toBe("SHOULD NOT");
    expect(POLARITY_META.allow.label).toBe("MAY");
    expect(POLARITY_META.context.label).toBe("CONTEXT");
  });
});

describe("TIER_LABEL", () => {
  it("names the three tiers", () => {
    expect(TIER_LABEL.account).toBe("Account");
    expect(TIER_LABEL.repo).toBe("This repo");
    expect(TIER_LABEL.node).toBe("Per-node");
  });
});

describe("reposOf", () => {
  it("lists the distinct repos among repo/node-tier rows, most facts first", () => {
    const rows = [
      row({ id: "a", repo_key: "/x", node_id: null }),
      row({ id: "b", repo_key: "/x", node_id: "n1" }),
      row({ id: "c", repo_key: "/y", node_id: null }),
      row({ id: "d", repo_key: null }), // account tier — excluded
    ];
    expect(reposOf(rows)).toEqual([
      { repo_key: "/x", count: 2 },
      { repo_key: "/y", count: 1 },
    ]);
  });

  it("is empty when there are no repo-scoped facts", () => {
    expect(reposOf([row({ repo_key: null })])).toEqual([]);
  });
});

describe("polarityRank", () => {
  it("ranks by directive force (require strongest → forbid weakest)", () => {
    expect(polarityRank("require")).toBeLessThan(polarityRank("prefer"));
    expect(polarityRank("prefer")).toBeLessThan(polarityRank("context"));
    expect(polarityRank("context")).toBeLessThan(polarityRank("forbid"));
  });

  it("sorts an unknown/legacy force last", () => {
    expect(polarityRank("bogus")).toBeGreaterThan(polarityRank("forbid"));
  });
});

describe("usedFacts", () => {
  const byId = new Map<string, NodeMemoryRow>([
    ["a", row({ id: "a", polarity: "require", content: "run the linter" })],
    ["b", row({ id: "b", polarity: "context", content: "uses pnpm" })],
  ]);

  it("resolves each injected ref to its stored row", () => {
    const out = usedFacts([{ id: "b", polarity: "context" }], byId);
    expect(out).toHaveLength(1);
    expect(out[0].row?.content).toBe("uses pnpm");
  });

  it("leaves row null for an id no longer in the store (deleted → '(no longer stored)')", () => {
    const out = usedFacts([{ id: "gone", polarity: "avoid" }], byId);
    expect(out[0].row).toBeNull();
    expect(out[0].polarity).toBe("avoid");
  });

  it("dedupes a fact injected across several rounds to one entry (first occurrence wins)", () => {
    const out = usedFacts(
      [
        { id: "a", polarity: "require" },
        { id: "a", polarity: "require" },
        { id: "b", polarity: "context" },
      ],
      byId,
    );
    expect(out.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("orders the resolved facts by directive force, strongest first", () => {
    const out = usedFacts(
      [
        { id: "b", polarity: "context" },
        { id: "a", polarity: "require" },
      ],
      byId,
    );
    // 'a' is require (strongest) so it comes first even though 'b' was injected earlier.
    expect(out.map((u) => u.id)).toEqual(["a", "b"]);
  });

  it("orders a resolved row by its CURRENT polarity, not the injected ref's", () => {
    // The ref says context, but the stored row was since edited up to require → it sorts as require.
    const store = new Map<string, NodeMemoryRow>([
      ["x", row({ id: "x", polarity: "require" })],
      ["y", row({ id: "y", polarity: "prefer" })],
    ]);
    const out = usedFacts(
      [
        { id: "y", polarity: "prefer" },
        { id: "x", polarity: "context" },
      ],
      store,
    );
    expect(out.map((u) => u.id)).toEqual(["x", "y"]);
  });
});
