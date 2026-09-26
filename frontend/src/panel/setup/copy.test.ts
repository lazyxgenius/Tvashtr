import { afterEach, describe, expect, it } from "vitest";

import { setProviderCatalogue } from "../../lib/api";
import { modelHint, needsModel } from "./modelCopy";
import { contractInSync, routingOf } from "./routing";
import { ACCESS_CONFIRM_BODY, FILE_ACCESS_HINT, runtimeBanner } from "./setupCopy";
import type { GraphEdge, TeamGraphNode } from "../../lib/api";

afterEach(() => setProviderCatalogue([]));

const cover = (byok: string[], subs: Record<string, boolean> = {}) => ({
  byok: new Set(byok),
  subs,
});

describe("modelHint (PANEL-40)", () => {
  it("names the subscription on Desktop when it covers the model", () => {
    expect(modelHint("xai/grok-4.7", cover([], { grok: true }), true)).toEqual({
      icon: "monitor",
      text: "Your Grok subscription · runs on this computer",
      warn: false,
    });
  });

  it("names the API key (with the catalogue's provider label) on the website", () => {
    setProviderCatalogue([
      {
        provider: "xai",
        thinker_default: null,
        worker_default: null,
        thinker_presets: [],
        worker_presets: [],
        label: "xAI",
      },
    ]);
    // A subscription never covers a website run.
    expect(modelHint("xai/grok-4.7", cover(["xai"], { grok: true }), false)?.text).toBe(
      "Uses your xAI API key",
    );
  });

  it("asks for a model, and reuses the missing-provider copy when nothing covers it", () => {
    expect(modelHint("", null, false)?.text).toBe(
      "This agent needs a model before the team can run.",
    );
    expect(modelHint("xai/grok-4.7", null, false)).toBeNull();
    const none = modelHint("xai/grok-4.7", cover([]), false);
    expect(none?.warn).toBe(true);
    expect(none?.text).toMatch(/No API key for “xai”/);
  });

  it("needsModel: blank, or (once known) uncovered", () => {
    expect(needsModel("", null)).toBe(true);
    expect(needsModel("xai/grok-4.7", null)).toBe(false);
    expect(needsModel("xai/grok-4.7", cover([]))).toBe(true);
    expect(needsModel("xai/grok-4.7", cover(["xai"]))).toBe(false);
  });
});

// Read-only agents get the same tools (team_run gives every agent one tool set); what differs is
// that they're told to stay report-only and only their report is pulled back.
describe("File access copy (honest about tools)", () => {
  it("doesn't promise read-only or extra write tools", () => {
    expect(FILE_ACCESS_HINT.readOnly).toBe(
      "Same agent loop. Its edits stay in the sandbox; only its report leaves.",
    );
    expect(ACCESS_CONFIRM_BODY).not.toMatch(/tools/);
  });
});

describe("runtimeBanner (PANEL-28)", () => {
  it("the entry agent starts from the idea; others add the spec or their Reads", () => {
    expect(runtimeBanner({ isEntry: true, readsFrom: [], readsDefault: true })).toBe(
      "Added at run time: the idea",
    );
    expect(runtimeBanner({ isEntry: false, readsFrom: [], readsDefault: true })).toBe(
      "Added at run time: the idea + the latest spec",
    );
    expect(
      runtimeBanner({ isEntry: false, readsFrom: ["spec", "build-notes"], readsDefault: true }),
    ).toBe("Added at run time: the idea + the latest spec + build-notes");
    expect(runtimeBanner({ isEntry: false, readsFrom: [], readsDefault: false })).toBe(
      "Added at run time: the idea",
    );
  });
});

describe("routingOf (PANEL-34/35/38)", () => {
  const n = (id: string, over: Partial<TeamGraphNode> = {}): TeamGraphNode => ({
    id,
    role_name: id,
    kind: "agent",
    model: "m",
    engine: null,
    prompt: "",
    position: { x: 0, y: 0 },
    config: null,
    ...over,
  });
  const nodes = [
    n("reviewer"),
    n("engineer"),
    n("ship", { kind: "terminal", config: { terminal_kind: "ship" } }),
    n("gate", { kind: "gate", config: { gate_kind: "review_escalation" } }),
  ];
  const e = (
    id: string,
    s: string,
    t: string,
    conditions: GraphEdge["conditions"] = null,
    edge_type = "default",
  ): GraphEdge => ({
    id,
    source_node_id: s,
    target_node_id: t,
    edge_type,
    conditions,
  });

  it("verdict branches with the loop-back, in sync when every label is quoted", () => {
    const edges = [
      e("1", "reviewer", "ship", { when: "approved" }),
      e("2", "reviewer", "engineer", { loop_limit: 3 }),
    ];
    const r = routingOf(
      "reviewer",
      'Write {"verdict": "approved" | "changes_requested"}',
      nodes,
      edges,
    );
    expect(r).toEqual({
      kind: "verdict",
      branches: [{ label: "approved", target: "Ship" }],
      otherwise: { target: "Engineer", back: true },
      labels: ["approved"],
      inSync: true,
    });
    expect(routingOf("reviewer", "No verdict here", nodes, edges)).toMatchObject({ inSync: false });
  });

  it("no arrow out, and a plain forward arrow (escalation arrows don't count)", () => {
    expect(routingOf("ship", "", nodes, [])).toEqual({ kind: "none" });
    const edges = [e("1", "engineer", "reviewer"), e("2", "engineer", "gate", null, "escalation")];
    expect(routingOf("engineer", "", nodes, edges)).toEqual({
      kind: "then",
      targets: ["Reviewer"],
    });
  });

  it("contractInSync needs every label", () => {
    expect(contractInSync('"a" and "b"', ["a", "b"])).toBe(true);
    expect(contractInSync('"a"', ["a", "b"])).toBe(false);
  });
});
