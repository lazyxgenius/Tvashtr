import { describe, expect, it } from "vitest";

import { type AgentDraft, changedGroups } from "../agentDraft";
import { reviewSections } from "./reviewSections";

const base: AgentDraft = {
  prompt: "a\nb",
  model: "xai/grok-4.7",
  title: "",
  description: "",
  editsAllowed: false,
  multimodal: false,
  readsFrom: [],
  readsDefault: true,
  writesTo: "",
  fallbackModel: "",
  outputSchema: "",
  skills: [{ type: "inline", name: "house-style", mode: "always" }],
  toolConfig: null,
};
const ctx = {
  builtInName: "Reviewer",
  builtInDescription: "Checks against the spec",
  skillLibrary: null,
  toolLibrary: null,
};
const review = (draft: AgentDraft) => reviewSections(base, draft, changedGroups(base, draft), ctx);

describe("reviewSections", () => {
  it("reads a model change old → new with the provider tile, and Reads / Writes as words", () => {
    const draft = {
      ...base,
      model: "anthropic/claude-sonnet-5",
      readsFrom: ["build-notes"],
      writesTo: "review-notes",
      fallbackModel: "openai/gpt-4o-mini",
    };
    expect(review(draft)).toEqual([
      {
        group: "model",
        title: "Model",
        kind: "value",
        location: "Setup → Model",
        before: { text: "xai/grok-4.7", model: true },
        after: { text: "anthropic/claude-sonnet-5", model: true },
      },
      expect.objectContaining({
        group: "reads",
        before: { text: "spec (default)" },
        after: { text: "build-notes" },
      }),
      expect.objectContaining({ group: "writes", before: { text: "Nothing" } }),
      expect.objectContaining({
        group: "backupModel",
        before: { text: "None" },
        after: { text: "openai/gpt-4o-mini", model: true },
      }),
    ]);
  });

  it("lists skills added, removed and re-moded, and a renamed agent", () => {
    const draft: AgentDraft = {
      ...base,
      title: "QA",
      skills: [
        { type: "inline", name: "house-style", mode: "agent" },
        { type: "inline", name: "security", mode: "trigger", triggers: ["auth"] },
      ],
    };
    const [name, skills] = review(draft);
    expect(name).toMatchObject({ kind: "lines", lines: [{ text: "Name: Reviewer → QA" }] });
    expect(skills).toMatchObject({
      kind: "lines",
      lines: [
        { op: "change", text: "house-style: Always on → Agent decides" },
        { op: "add", text: "security · When triggered auth" },
      ],
    });
  });
});
