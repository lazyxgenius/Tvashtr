import { describe, expect, it } from "vitest";

import type { TeamGraphNode } from "../lib/api";
import { changedGroups, describeChanges, draftProblem, patchFor, seedDraft } from "./agentDraft";

function node(over: Partial<TeamGraphNode> = {}): TeamGraphNode {
  return {
    id: "n-rev",
    role_name: "reviewer",
    kind: "agent",
    model: "xai/grok-4.7",
    engine: "openhands",
    prompt: "You are the Reviewer",
    position: { x: 0, y: 0 },
    edits_allowed: false,
    config: {
      title: "Reviewer",
      reads_from: ["build-notes"],
      output_schema: { type: "object" },
      fallback_model: "openai/gpt-4o-mini",
    },
    tool_config: { mcpServers: { fetch: { command: "uvx" } } },
    skills: [{ type: "inline", name: "house-style" }],
    ...over,
  };
}

describe("seedDraft", () => {
  it("reads every drawer field off the node and its config", () => {
    const d = seedDraft(node());
    expect(d).toMatchObject({
      prompt: "You are the Reviewer",
      model: "xai/grok-4.7",
      title: "Reviewer",
      description: "",
      editsAllowed: false,
      multimodal: false,
      readsFrom: ["build-notes"],
      readsDefault: true,
      writesTo: "",
      fallbackModel: "openai/gpt-4o-mini",
    });
    expect(JSON.parse(d.outputSchema)).toEqual({ type: "object" });
  });

  it("defaults File access by kind when the node predates edits_allowed", () => {
    expect(seedDraft(node({ edits_allowed: undefined, kind: "agent" })).editsAllowed).toBe(true);
    expect(seedDraft(node({ edits_allowed: undefined, kind: "completion" })).editsAllowed).toBe(
      false,
    );
    expect(seedDraft(node({ config: { reads_default: false } })).readsDefault).toBe(false);
  });
});

describe("changedGroups / patchFor", () => {
  it("a clean draft has no changes and an empty PATCH", () => {
    const base = seedDraft(node());
    expect(changedGroups(base, { ...base })).toEqual([]);
    expect(patchFor(base, { ...base })).toEqual({});
  });

  it("sends ONLY the changed parts — tools and skills untouched stay out of the body", () => {
    const base = seedDraft(node());
    const draft = { ...base, prompt: "Edited", multimodal: true };
    expect(changedGroups(base, draft)).toEqual(["instructions", "images"]);
    expect(patchFor(base, draft)).toEqual({ prompt: "Edited", multimodal: true });
  });

  it("maps clears to the contract's nulls", () => {
    const base = seedDraft(node());
    const draft = {
      ...base,
      title: "  ",
      fallbackModel: "",
      outputSchema: "",
      readsFrom: [],
      readsDefault: false,
    };
    expect(patchFor(base, draft)).toEqual({
      title: null,
      fallback_model: null,
      output_schema: null,
      reads_from: [],
      reads_default: false,
    });
    // Turning the default back on removes the key (null), not true.
    const off = seedDraft(node({ config: { reads_default: false } }));
    expect(patchFor(off, { ...off, readsDefault: true })).toEqual({ reads_default: null });
  });

  it("counts a rename (title + description) as one change", () => {
    const base = seedDraft(node());
    const draft = { ...base, title: "QA lead", description: "Checks it" };
    expect(changedGroups(base, draft)).toEqual(["name"]);
  });
});

describe("describeChanges", () => {
  it("joins with commas and a final and", () => {
    expect(describeChanges(["instructions"])).toBe("the instructions");
    expect(describeChanges(["instructions", "model"])).toBe("the instructions and the model");
    expect(describeChanges(["instructions", "model", "images"])).toBe(
      "the instructions, the model and images",
    );
  });
});

describe("draftProblem", () => {
  it("blocks empty instructions and a malformed output format", () => {
    const base = seedDraft(node());
    expect(draftProblem(base)).toBeNull();
    expect(draftProblem({ ...base, prompt: "  " })).toBe("Instructions can’t be empty.");
    expect(draftProblem({ ...base, outputSchema: "{" })).toBe(
      "The output format isn’t valid JSON.",
    );
    expect(draftProblem({ ...base, outputSchema: "[1]" })).toBe(
      "The output format must be a JSON object.",
    );
  });
});
