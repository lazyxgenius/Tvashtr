import { describe, expect, it } from "vitest";

import {
  desktopSubscriptionNote,
  followsRules,
  parseTriggers,
  repoName,
  skillRows,
  withMode,
  withRules,
  withoutSkill,
} from "./nodeSkills";

const SKILLS = [
  { type: "inline", name: "house-style", content: "# House style", mode: "always" },
  { type: "repo", url: "https://github.com/org/skills", ref: "main", filter: "pytest-review" },
  { type: "library", id: "s-sec" },
  { type: "project_rules" },
  { type: "library", id: "s-tdd", origin: "preset:tdd" },
];
const LIBRARY = [
  {
    id: "s-sec",
    name: "security-checklist",
    source: {
      type: "inline" as const,
      name: "security-checklist",
      content: "…",
      mode: "trigger" as const,
      triggers: ["auth", "secrets", "tokens"],
    },
    created_at: "",
  },
];

describe("nodeSkills", () => {
  it("lists one row per source with its badge and load mode (PANEL-82, Q19)", () => {
    const rows = skillRows(SKILLS, LIBRARY);
    expect(rows.map((r) => [r.index, r.name, r.badge.label, r.mode, r.triggers])).toEqual([
      [0, "house-style", "Custom", "always", []],
      [1, "pytest-review", "org/skills @ main", "agent", []],
      [2, "security-checklist", "Library", "trigger", ["auth", "secrets", "tokens"]],
      [4, "Removed from your library", "Preset", "agent", []],
    ]);
    expect(rows.map((r) => [r.custom, r.libraryId])).toEqual([
      [true, null],
      [false, null],
      [false, "s-sec"],
      [false, "s-tdd"],
    ]);
    // A glob filter names the row after the repo; an unloaded library says "Library skill".
    const globbed = skillRows(
      [{ type: "repo", url: "https://github.com/org/skills.git", ref: "v1", filter: "review-*" }],
      null,
    );
    expect(globbed[0].name).toBe("org/skills");
    expect(skillRows([{ type: "library", id: "x" }], null)[0].name).toBe("Library skill");
    expect(repoName("https://github.com/org/skills/")).toBe("org/skills");
  });

  it("sets this agent's load mode on any row; only a trigger mode keeps words", () => {
    const triggered = withMode(SKILLS, 1, "trigger", ["pytest", "tests"]);
    expect(triggered[1]).toMatchObject({
      type: "repo",
      mode: "trigger",
      triggers: ["pytest", "tests"],
    });
    expect(skillRows(triggered, LIBRARY)[1]).toMatchObject({
      mode: "trigger",
      triggers: ["pytest", "tests"],
    });
    expect(withMode(triggered, 1, "always")[1]).not.toHaveProperty("triggers");
    // A library ref's override wins over the library item's own mode.
    expect(skillRows(withMode(SKILLS, 2, "agent"), LIBRARY)[2].mode).toBe("agent");
  });

  it("removes rows and switches the rules files", () => {
    expect(withoutSkill([SKILLS[0]], 0)).toBeNull();
    expect(withoutSkill(SKILLS, 1)).toHaveLength(4);
    expect(followsRules(SKILLS)).toBe(true);
    expect(withRules([{ type: "project_rules" }], false)).toBeNull();
    expect(withRules(null, true)).toEqual([{ type: "project_rules" }]);
  });

  it("parses trigger words", () => {
    expect(parseTriggers(" pytest, tests,,pytest ")).toEqual(["pytest", "tests"]);
    expect(parseTriggers(" , ")).toEqual([]);
  });

  it("says what a Desktop subscription agent doesn't use (PANEL-103)", () => {
    const cover = { byok: new Set<string>(), subs: { grok: true } };
    expect(desktopSubscriptionNote("xai/grok-4.7", cover, true)).toMatch(
      /^Runs on your Grok subscription on this computer\. Its skills are added/,
    );
    expect(desktopSubscriptionNote("xai/grok-4.7", cover, false)).toBeNull();
    expect(
      desktopSubscriptionNote("xai/grok-4.7", { byok: new Set(["xai"]), subs: {} }, true),
    ).toBeNull();
    expect(desktopSubscriptionNote("openai/gpt-4o-mini", cover, true)).toBeNull();
  });
});
