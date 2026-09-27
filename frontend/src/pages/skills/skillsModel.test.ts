import { describe, expect, it } from "vitest";

import type { Skill, SkillSource } from "../../lib/api/skills";
import {
  agentLabel,
  agentsActionLabel,
  deleteImpact,
  foundSummary,
  joinAnd,
  loadMode,
  matchesGlobs,
  parseGlobs,
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

const row = (role: string | null, team = "Indicator sprint team", title: string | null = null) => ({
  node_id: `${role}-${team}`,
  role_name: role,
  title,
  team_id: team,
  team_name: team,
});

describe("agents and the delete impact", () => {
  it("names an agent by its title, else its role; a deleted node is Removed agent", () => {
    expect(agentLabel({ title: "Lead reviewer", role_name: "reviewer" })).toBe("Lead reviewer");
    expect(agentLabel({ title: null, role_name: "pm" })).toBe("Product manager");
    expect(agentLabel({ title: null, role_name: "writer" })).toBe("Writer");
    expect(agentLabel({ title: null, role_name: null })).toBe("Removed agent");
  });

  it("joins names the way the design writes them", () => {
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  });

  it("says who loses the skill (TkF-SkillMenu-2)", () => {
    const usage = { agents: 2, teams: 1 };
    expect(deleteImpact([row("reviewer"), row("engineer")], usage)).toBe(
      "Reviewer and Engineer in Indicator sprint team use it. They lose it on their next run. You can’t undo this.",
    );
    expect(deleteImpact([row("reviewer"), row("writer", "Docs team")], usage)).toBe(
      "Reviewer in Indicator sprint team and Writer in Docs team use it. They lose it on their next run. You can’t undo this.",
    );
    expect(deleteImpact([row("reviewer")], { agents: 1, teams: 1 })).toBe(
      "Reviewer in Indicator sprint team uses it and loses it on its next run. You can’t undo this.",
    );
    const many = ["pm", "architect", "engineer", "reviewer", "writer"].map((r) => row(r));
    expect(deleteImpact(many, { agents: 5, teams: 1 })).toMatch(
      /^Product manager, Architect, Engineer and 2 more in Indicator sprint team use it\./,
    );
  });

  it("falls back to the counts, and says when nobody uses it", () => {
    expect(deleteImpact(null, { agents: 2, teams: 1 })).toBe(
      "2 agents in 1 team use it. They lose it on their next run. You can’t undo this.",
    );
    expect(deleteImpact([], { agents: 0, teams: 0 })).toBe(
      "No agents use it. You can’t undo this.",
    );
  });

  it("labels the picker's action by the end state", () => {
    expect(agentsActionLabel(1, false)).toBe("Turn on for 1 agent");
    expect(agentsActionLabel(3, true)).toBe("Turn on for 3 agents");
    expect(agentsActionLabel(0, true)).toBe("Turn off for all agents");
    expect(agentsActionLabel(0, false)).toBe("Turn on for 0 agents");
  });
});

describe("Add from GitHub", () => {
  it("filters found skills by comma-separated globs, case-insensitively", () => {
    const globs = parseGlobs(" review-*, pytest-* ,,");
    expect(globs).toHaveLength(2);
    expect(matchesGlobs("pytest-review", globs)).toBe(true);
    expect(matchesGlobs("Review-api", globs)).toBe(true);
    expect(matchesGlobs("house-style-py", globs)).toBe(false);
    expect(matchesGlobs("anything", parseGlobs(""))).toBe(true);
    // Regex characters are literal; ? is one character.
    expect(matchesGlobs("a.b", parseGlobs("a.b"))).toBe(true);
    expect(matchesGlobs("axb", parseGlobs("a.b"))).toBe(false);
    expect(matchesGlobs("ab1", parseGlobs("ab?"))).toBe(true);
  });

  it("summarises what the scan found", () => {
    expect(foundSummary(4, 4, "main", "1a2b3c4")).toBe("Found 4 skills at main @ 1a2b3c4");
    expect(foundSummary(1, 1, "v2", "abcdef0")).toBe("Found 1 skill at v2 @ abcdef0");
    expect(foundSummary(2, 4, "main", "1a2b3c4")).toBe("Found 2 of 4 skills at main @ 1a2b3c4");
  });
});
