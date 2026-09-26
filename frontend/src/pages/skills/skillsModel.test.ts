import { describe, expect, it } from "vitest";

import type { Skill, SkillSource } from "../../lib/api/skills";
import {
  loadMode,
  matchesQuery,
  presetInLibrary,
  repoSlug,
  sortByName,
  sourceBadge,
  triggerPreview,
  updatedLabel,
  usedByLabel,
} from "./skillsModel";

const skill = (name: string, source?: SkillSource): Skill => ({
  id: name,
  name,
  source: source ?? { type: "inline", name, content: "x", mode: "always" },
  created_at: "",
  updated_at: "",
  usage: { agents: 0, teams: 0 },
});

describe("skills labels", () => {
  it("badges the source: Written here, <owner>/<repo> @ <ref>, Repo rules", () => {
    expect(sourceBadge({ type: "inline", name: "a", content: "x", mode: "always" })).toEqual({
      label: "Written here",
      variant: "neutral",
    });
    expect(
      sourceBadge({ type: "repo", url: "https://github.com/org/skills.git", ref: "main" }),
    ).toEqual({ label: "org/skills @ main", variant: "outline" });
    expect(sourceBadge({ type: "project_rules" })).toEqual({
      label: "Repo rules",
      variant: "neutral",
    });
  });

  it("parses repo slugs from the URL forms the backend accepts", () => {
    expect(repoSlug("https://github.com/lazyxgenius/skills")).toBe("lazyxgenius/skills");
    expect(repoSlug("https://github.com/lazyxgenius/skills/")).toBe("lazyxgenius/skills");
    expect(repoSlug("git@github.com:org/skills.git")).toBe("org/skills");
    expect(repoSlug("not a url")).toBeNull();
  });

  it("reads the load mode (repo without a mode = Agent decides; repo rules = Always on)", () => {
    expect(loadMode({ type: "repo", url: "u", ref: "main" })).toBe("agent");
    expect(loadMode({ type: "project_rules" })).toBe("always");
    expect(loadMode({ type: "inline", name: "a", content: "x", mode: "trigger" })).toBe("trigger");
  });

  it("shows the first two trigger words, only for When triggered", () => {
    const src: SkillSource = {
      type: "inline",
      name: "a",
      content: "x",
      mode: "trigger",
      triggers: ["endpoint", "route", "handler"],
    };
    expect(triggerPreview(src)).toBe("endpoint, route");
    expect(triggerPreview({ ...src, mode: "always" })).toBe("");
  });

  it("pluralises Used by, or says Not used yet", () => {
    expect(usedByLabel({ agents: 2, teams: 1 })).toBe("2 agents · 1 team");
    expect(usedByLabel({ agents: 1, teams: 1 })).toBe("1 agent · 1 team");
    expect(usedByLabel({ agents: 3, teams: 2 })).toBe("3 agents · 2 teams");
    expect(usedByLabel({ agents: 0, teams: 0 })).toBe("Not used yet");
  });

  it("says Just now under a minute, then a short date", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(updatedLabel("2026-09-26T11:59:30Z", now)).toBe("Just now");
    expect(updatedLabel("2026-09-23T12:00:00Z", now)).toBe("Sep 23");
    expect(updatedLabel("garbage", now)).toBe("");
  });

  it("sorts by name and searches names case-insensitively", () => {
    const rows = sortByName([skill("security-checklist"), skill("house-style"), skill("api")]);
    expect(rows.map((s) => s.name)).toEqual(["api", "house-style", "security-checklist"]);
    expect(matchesQuery(skill("house-style"), "  HOUSE ")).toBe(true);
    expect(matchesQuery(skill("house-style"), "docker")).toBe(false);
    expect(matchesQuery(skill("house-style"), "")).toBe(true);
  });

  it("finds a preset in the library by name", () => {
    const preset = {
      key: "yagni",
      name: "yagni",
      title: "YAGNI",
      description: "",
      badge: "Free",
      source: { type: "inline" as const, name: "yagni", content: "x", mode: "always" as const },
    };
    expect(presetInLibrary(preset, [skill("yagni")])).toBe(true);
    expect(presetInLibrary(preset, [skill("tdd")])).toBe(false);
  });
});
