import { describe, expect, it } from "vitest";

import type { GraphEdge, TeamGraphNode } from "../../lib/api";
import {
  documentLabel,
  knownDocuments,
  readsChips,
  readsFor,
  specNameOf,
  withoutRead,
  writableDocuments,
  writerLine,
  writersText,
} from "./documents";

const agent = (id: string, title: string, config: Record<string, unknown> = {}): TeamGraphNode => ({
  id,
  role_name: id,
  kind: "agent",
  model: "xai/grok-4.7",
  engine: null,
  prompt: "x",
  position: { x: 0, y: 0 },
  config: { title, ...config },
  last_run: null,
});
const edge = (s: string, t: string): GraphEdge => ({
  id: `${s}-${t}`,
  source_node_id: s,
  target_node_id: t,
  edge_type: "default",
  conditions: null,
});

const pm = agent("pm", "Product manager");
const eng = agent("eng", "Engineer", { writes_to: "build-notes", reads_from: ["spec", "design"] });
const rev = agent("rev", "Reviewer");
const nodes = [pm, eng, rev];
const edges = [edge("pm", "eng"), edge("eng", "rev")];

describe("knownDocuments", () => {
  it("lists the shared spec (its writer the entry agent), what others write, and names no one writes", () => {
    const docs = knownDocuments({ nodes, edges, selfId: "rev" });
    expect(docs).toEqual([
      { name: "spec", isSpec: true, writers: ["Product manager"] },
      { name: "build-notes", isSpec: false, writers: ["Engineer"] },
      { name: "design", isSpec: false, writers: [] },
    ]);
    expect(docs.map(documentLabel)).toEqual(["Shared spec", "build-notes", "design"]);
    expect(docs.map(writersText)).toEqual([
      "Product manager",
      "Engineer",
      "no one writes this yet",
    ]);
  });

  it("keeps a name the agent just typed, and doesn't list its own document as someone else's", () => {
    const self = agent("rev", "Reviewer", { writes_to: "review-notes" });
    const docs = knownDocuments({
      nodes: [pm, eng, self],
      edges,
      selfId: "rev",
      draftReads: ["api-notes"],
    });
    expect(docs.map((d) => d.name)).toEqual(["spec", "build-notes", "design", "api-notes"]);
  });

  it("names the spec after what the entry agent writes", () => {
    const renamed = agent("pm", "Product manager", { writes_to: "prd" });
    expect(specNameOf([renamed, eng, rev], edges)).toBe("prd");
    expect(specNameOf(nodes, edges)).toBe("spec");
    expect(knownDocuments({ nodes: [renamed, eng, rev], edges, selfId: "rev" })[0]).toEqual({
      name: "prd",
      isSpec: true,
      writers: ["Product manager"],
    });
  });

  it("the Writes picker offers everything but the shared spec", () => {
    const docs = writableDocuments(knownDocuments({ nodes, edges, selfId: "rev" }));
    expect(docs.map(writerLine)).toEqual(["Engineer writes this", "no one writes this yet"]);
    expect(writerLine({ name: "x", isSpec: false, writers: ["Engineer", "Architect"] })).toBe(
      "Engineer and Architect write this",
    );
  });
});

describe("Reads rules (Q4)", () => {
  const implicit = { readsFrom: [], readsDefault: true };

  it("shows the spec by default, the names when there are some, nothing when it reads nothing", () => {
    expect(readsChips(implicit, "spec")).toEqual(["spec"]);
    expect(readsChips({ readsFrom: ["a", "b"], readsDefault: true }, "spec")).toEqual(["a", "b"]);
    expect(readsChips({ readsFrom: [], readsDefault: false }, "spec")).toEqual([]);
  });

  it("the spec alone is the default; nothing reads nothing; names keep their order", () => {
    expect(readsFor(["spec"], "spec", { readsFrom: [], readsDefault: false })).toEqual(implicit);
    expect(readsFor([], "spec", implicit)).toEqual({ readsFrom: [], readsDefault: false });
    expect(readsFor(["spec", "build-notes"], "spec", implicit)).toEqual({
      readsFrom: ["spec", "build-notes"],
      readsDefault: true,
    });
    expect(readsFor([" design ", "design", "spec"], "spec", implicit).readsFrom).toEqual([
      "design",
      "spec",
    ]);
  });

  it("removing the last chip — the default spec or a named one — reads nothing", () => {
    expect(withoutRead(implicit, "spec", "spec")).toEqual({ readsFrom: [], readsDefault: false });
    expect(withoutRead({ readsFrom: ["design"], readsDefault: true }, "design", "spec")).toEqual({
      readsFrom: [],
      readsDefault: false,
    });
    // Down to the spec alone: back to the plain default.
    expect(
      withoutRead(
        { readsFrom: ["spec", "build-notes"], readsDefault: true },
        "build-notes",
        "spec",
      ),
    ).toEqual(implicit);
  });
});
