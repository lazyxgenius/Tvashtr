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

  it("names a skill or tool whose only change is its content, and a new order", () => {
    const edited: AgentDraft = {
      ...base,
      skills: [{ type: "inline", name: "house-style", mode: "always", content: "Use tabs." }],
    };
    expect(review(edited)).toMatchObject([
      { group: "skills", lines: [{ op: "change", text: "house-style: edited" }] },
    ]);

    const two = [
      { type: "inline", name: "house-style", mode: "always" },
      { type: "inline", name: "security", mode: "always" },
    ];
    const from = { ...base, skills: two };
    const reordered = { ...base, skills: [two[1], two[0]] };
    expect(reviewSections(from, reordered, changedGroups(from, reordered), ctx)).toMatchObject([
      { group: "skills", lines: [{ op: "change", text: "Order changed" }] },
    ]);

    const server = (env: Record<string, string>) => ({
      mcpServers: { docs: { command: "npx", args: ["docs-mcp"], env } },
    });
    const tools = { ...base, toolConfig: server({ A: "1" }) } as AgentDraft;
    const retuned = { ...base, toolConfig: server({ A: "2" }) } as AgentDraft;
    expect(reviewSections(tools, retuned, changedGroups(tools, retuned), ctx)).toMatchObject([
      { group: "tools", lines: [{ op: "change", text: "docs: edited" }] },
    ]);
  });

  it("reads the domains an agent can search: Off, All domains, how many, or a different pick", () => {
    const access = (domains: unknown) =>
      ({ ...base, toolConfig: { tvashtr: { domains } } }) as AgentDraft;
    const lineOf = (from: AgentDraft, to: AgentDraft) =>
      reviewSections(from, to, changedGroups(from, to), ctx)[0];
    expect(lineOf(base, access(["d-a", "d-b"]))).toMatchObject({
      group: "tools",
      lines: [{ op: "change", text: "Domains: Off → 2 domains" }],
    });
    expect(lineOf(access(true), access(["d-a"]))).toMatchObject({
      lines: [{ op: "change", text: "Domains: All domains → 1 domain" }],
    });
    expect(lineOf(access(["d-a"]), access(["d-b"]))).toMatchObject({
      lines: [{ op: "change", text: "Domains: a different pick" }],
    });
  });
});
