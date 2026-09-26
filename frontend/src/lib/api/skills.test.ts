import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../backendStatus";
import {
  createSkill,
  getSkill,
  getSkillAgents,
  importSkills,
  listSkillPresets,
  listSkills,
  parseSkill,
  scanSkillRepo,
} from "./skills";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const item = {
  id: "s1",
  name: "house-style",
  source: { type: "inline", name: "house-style", content: "# House", mode: "always" },
  created_at: "2026-09-20T12:00:00+00:00",
  updated_at: "2026-09-23T12:00:00+00:00",
  usage: { agents: 2, teams: 1 },
};

describe("parseSkill", () => {
  it("keeps a well-formed item", () => {
    expect(parseSkill(item)).toEqual(item);
  });

  it("fills what an older server leaves out (updated_at, usage, inline mode)", () => {
    const s = parseSkill({
      id: "s2",
      name: "old",
      source: { type: "inline", content: "x" },
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(s).toMatchObject({
      updated_at: "2026-01-01T00:00:00Z",
      usage: { agents: 0, teams: 0 },
      source: { type: "inline", name: "old", mode: "always" },
    });
  });

  it("reads a repo source with its mode, triggers and pinned sha", () => {
    const s = parseSkill({
      ...item,
      source: {
        type: "repo",
        url: "https://github.com/org/skills",
        ref: "main",
        mode: "trigger",
        triggers: ["a", 3, "b"],
        resolved_sha: "f".repeat(40),
      },
    });
    expect(s?.source).toEqual({
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "main",
      filter: null,
      mode: "trigger",
      triggers: ["a", "b"],
      resolved_sha: "f".repeat(40),
    });
  });

  it("drops what isn't a skill", () => {
    expect(parseSkill(null)).toBeNull();
    expect(parseSkill({ id: "x" })).toBeNull();
    expect(parseSkill({ ...item, source: { type: "library", id: "y" } })).toBeNull();
    expect(parseSkill({ ...item, source: { type: "inline" } })).toBeNull();
  });
});

describe("skills client", () => {
  it("lists the library, skipping one malformed item instead of failing", async () => {
    mockApi({ "GET /api/skill-library": { skills: [item, { nope: true }] } });
    expect((await listSkills()).map((s) => s.name)).toEqual(["house-style"]);
  });

  it("treats a list answer in another shape as a failed load", async () => {
    mockApi({ "GET /api/skill-library": { items: [] } });
    await expect(listSkills()).rejects.toThrow("Unexpected answer from /api/skill-library");
  });

  it("creates create-only by default and surfaces the 409 message", async () => {
    const calls = mockApi({
      "POST /api/skill-library": () =>
        jsonError(409, "You already have a skill called house-style."),
    });
    await expect(createSkill("house-style", item.source as never)).rejects.toMatchObject({
      status: 409,
      message: "You already have a skill called house-style.",
    });
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/skill-library",
      body: { name: "house-style", source: item.source },
    });
  });

  it("passes on_conflict=replace only when asked", async () => {
    const calls = mockApi({ "POST /api/skill-library": item });
    await createSkill("house-style", item.source as never, { onConflict: "replace" });
    expect(calls.at(-1)?.path).toBe("/api/skill-library?on_conflict=replace");
  });

  it("reads one skill with the agents that use it", async () => {
    mockApi({
      "GET /api/skill-library/:id": {
        ...item,
        used_by: [
          {
            node_id: "n1",
            role_name: "Reviewer",
            title: null,
            team_id: "t1",
            team_name: "Indicator sprint team",
          },
          { bad: 1 },
        ],
      },
    });
    const s = await getSkill("s1");
    expect(s.used_by).toEqual([
      {
        node_id: "n1",
        role_name: "Reviewer",
        title: null,
        team_id: "t1",
        team_name: "Indicator sprint team",
      },
    ]);
  });

  it("lists presets and the agent picker", async () => {
    mockApi({
      "GET /api/skill-presets": {
        skills: [
          {
            key: "yagni",
            name: "yagni",
            title: "YAGNI",
            description: "Smallest change.",
            badge: "Free",
            source: { type: "inline", name: "yagni", content: "# YAGNI", mode: "always" },
          },
        ],
      },
      "GET /api/skill-library/:id/agents": {
        teams: [
          {
            team_id: "t1",
            team_name: "Indicator sprint team",
            agents: [{ node_id: "n1", role_name: "Reviewer", enabled: true, mode: "agent" }],
          },
        ],
      },
    });
    expect((await listSkillPresets())[0]).toMatchObject({ title: "YAGNI", badge: "Free" });
    expect((await getSkillAgents("s1"))[0].agents[0]).toMatchObject({
      node_id: "n1",
      enabled: true,
      mode: "agent",
      triggers: null,
    });
  });

  it("scans a repo and imports with the structured refusal kept", async () => {
    const calls = mockApi({
      "POST /api/skill-library/scan": {
        repo: "lazyxgenius/skills",
        url: "https://github.com/lazyxgenius/skills",
        ref: "main",
        sha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
        short_sha: "1a2b3c4",
        skills: [{ name: "pytest-review", path: "skills/pytest-review/SKILL.md" }],
      },
      "POST /api/skill-library/import": () =>
        jsonError(409, {
          code: "name_taken",
          message: "You already have skills called pytest-review.",
          conflicts: ["pytest-review"],
        }),
    });
    const scan = await scanSkillRepo("https://github.com/lazyxgenius/skills");
    expect(calls.at(-1)?.body).toEqual({ url: "https://github.com/lazyxgenius/skills" });
    expect(scan.skills).toEqual([
      {
        name: "pytest-review",
        path: "skills/pytest-review/SKILL.md",
        description: null,
        in_library: false,
      },
    ]);
    await expect(
      importSkills({
        url: scan.url,
        ref: scan.ref,
        sha: scan.sha,
        skills: ["pytest-review"],
        mode: "agent",
        on_conflict: "error",
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: "You already have skills called pytest-review.",
      detail: { code: "name_taken" },
    });
  });
});
