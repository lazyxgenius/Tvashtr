import { describe, expect, it } from "vitest";

import type { Skill } from "../../lib/api/skills";
import {
  canSave,
  draftFromSkill,
  draftSource,
  emptyDraft,
  errorField,
  gutterLines,
  isDirty,
  modeHelper,
  nameError,
  parseTriggers,
  validateDraft,
} from "./skillDraft";

const row = (source: Skill["source"], name = "house-style"): Skill => ({
  id: "s1",
  name,
  source,
  created_at: "2026-09-20T12:00:00Z",
  updated_at: "2026-09-20T12:00:00Z",
  usage: { agents: 0, teams: 0 },
});

describe("skill draft", () => {
  it("a new draft is Written here, Always on, version main", () => {
    const d = emptyDraft();
    expect([d.kind, d.mode, d.repoRef, d.content]).toEqual(["inline", "always", "main", ""]);
  });

  it("splits trigger words on commas, trimmed, empties dropped (SKILL-27)", () => {
    expect(parseTriggers(" endpoint, route,, api ,")).toEqual(["endpoint", "route", "api"]);
  });

  it("Save needs a name and the SKILL.md, or a repository (SKILL-22)", () => {
    const d = emptyDraft();
    expect(canSave(d)).toBe(false);
    expect(canSave({ ...d, name: "api-conventions" })).toBe(false);
    expect(canSave({ ...d, name: "api-conventions", content: "  \n" })).toBe(false);
    expect(canSave({ ...d, name: "api-conventions", content: "# API" })).toBe(true);
    const repo = { ...d, kind: "repo" as const, name: "x" };
    expect(canSave(repo)).toBe(false);
    expect(canSave({ ...repo, repoUrl: "https://github.com/org/skills" })).toBe(true);
  });

  it("names are kebab-case and at most 64 characters (SKILL-36)", () => {
    expect(nameError("house-style")).toBeNull();
    expect(nameError("")).toBe("A skill name is required.");
    const rule = "Use lowercase letters, numbers and single hyphens, like house-style.";
    expect(nameError("House Style")).toBe(rule);
    expect(nameError("a--b")).toBe(rule);
    expect(nameError("-a")).toBe(rule);
    expect(nameError("a".repeat(65))).toBe(rule);
  });

  it("an existing skill's unchanged name isn't re-checked (the backend keeps a legacy name)", () => {
    const d = { ...emptyDraft(), name: "House Style", content: "c" };
    expect(validateDraft(d).name).toBeDefined();
    expect(validateDraft(d, "House Style")).toEqual({});
    expect(validateDraft({ ...d, name: " House Style " }, "House Style")).toEqual({});
    expect(validateDraft({ ...d, name: "House Style 2" }, "House Style").name).toBeDefined();
  });

  it("When triggered needs at least one word (Q16)", () => {
    const d = { ...emptyDraft(), name: "x", content: "c", mode: "trigger" as const };
    expect(validateDraft(d)).toEqual({ triggers: "Add at least one trigger word." });
    expect(validateDraft({ ...d, triggers: " , " }).triggers).toBeDefined();
    expect(validateDraft({ ...d, triggers: "auth" })).toEqual({});
  });

  it("an inline source keeps its name in step with the row and sends triggers only when triggered", () => {
    const d = { ...emptyDraft(), name: " api-conventions ", content: "# API", triggers: "a, b" };
    expect(draftSource(d)).toEqual({
      type: "inline",
      name: "api-conventions",
      content: "# API",
      mode: "always",
    });
    expect(draftSource({ ...d, mode: "trigger" })).toEqual({
      type: "inline",
      name: "api-conventions",
      content: "# API",
      mode: "trigger",
      triggers: ["a", "b"],
    });
  });

  it("a repo source: version defaults to main, empty filter is null, the pinned commit survives only an unchanged repo + version", () => {
    const skill = row({
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "main",
      filter: "pytest-review",
      mode: "agent",
      resolved_sha: "a".repeat(40),
    });
    const d = draftFromSkill(skill);
    expect(draftSource(d)).toEqual({
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "main",
      filter: "pytest-review",
      mode: "agent",
      resolved_sha: "a".repeat(40),
    });
    expect(draftSource({ ...d, repoRef: "v2" })).not.toHaveProperty("resolved_sha");
    expect(draftSource({ ...d, repoRef: " ", repoFilter: "" })).toMatchObject({
      ref: "main",
      filter: null,
    });
  });

  it("a repo row that never picked a mode shows Agent decides and saves without one", () => {
    const d = draftFromSkill(
      row({ type: "repo", url: "https://github.com/org/skills", ref: "main" }),
    );
    expect(d.mode).toBeNull();
    expect(draftSource(d)).not.toHaveProperty("mode");
    expect(modeHelper("agent", false)).toBe("Listed; the agent opens it when it needs it.");
  });

  it("a legacy Repo rules row keeps its source", () => {
    const d = draftFromSkill(row({ type: "project_rules" }, "repo-rules"));
    expect(d.kind).toBe("project_rules");
    expect(draftSource(d)).toEqual({ type: "project_rules" });
    expect(canSave(d)).toBe(true);
  });

  it("dirty = the name or the saved source changed", () => {
    const saved = draftFromSkill(
      row({ type: "inline", name: "house-style", content: "# H", mode: "always" }),
    );
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty({ ...saved, content: "# H2" }, saved)).toBe(true);
    expect(isDirty({ ...saved, mode: "agent" }, saved)).toBe(true);
    // Trigger words typed while Always on are not saved, so they don't count.
    expect(isDirty({ ...saved, triggers: "x" }, saved)).toBe(false);
  });

  it("mode helper copy (SKILL-26)", () => {
    expect(modeHelper("always", false)).toBe("The full skill goes into every prompt.");
    expect(modeHelper("trigger", false)).toBe(
      "Loads only when the conversation mentions a trigger word.",
    );
    expect(modeHelper("trigger", true)).toBe(
      "Each agent can change this in its own Skills & tools tab.",
    );
  });

  it("the gutter numbers four lines past the text", () => {
    expect(gutterLines("")).toBe(5);
    expect(gutterLines("a\n\nb\nc\nd\ne\nf")).toBe(11);
  });

  it("maps the backend's refusals to their field", () => {
    expect(errorField(409, "You already have a skill called x.")).toBe("name");
    expect(
      errorField(422, "Use lowercase letters, numbers and single hyphens, like house-style."),
    ).toBe("name");
    expect(errorField(422, "A skill name is required.")).toBe("name");
    expect(errorField(422, "Add the SKILL.md content.")).toBe("content");
    expect(errorField(422, "Add at least one trigger word.")).toBe("triggers");
    expect(errorField(422, "Use a GitHub repo URL, like https://github.com/org/skills.")).toBe(
      "repo",
    );
    expect(errorField(500, "boom")).toBeNull();
  });
});
