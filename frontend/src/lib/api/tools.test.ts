import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi } from "../../pages/tools/toolsTestUtils";
import { __resetBackendStatusForTests } from "../backendStatus";
import { __resetWorkspaceStatusForTests, refreshBadges, useNavBadges } from "../workspaceStatus";
import { ApiDetailError } from "./runs";
import {
  createSecret,
  deleteTool,
  getGithubStatus,
  getTool,
  getToolkitSummary,
  importTools,
  listAgents,
  listSecrets,
  listToolCatalog,
  listTools,
  setToolAgents,
} from "./tools";

beforeEach(() => {
  __resetBackendStatusForTests();
  __resetWorkspaceStatusForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe("tools API — shapes are checked at the boundary", () => {
  it("keeps good tools, drops malformed ones and fills safe defaults", async () => {
    mockApi({
      "GET /api/tool-library": {
        tools: [
          { id: "a", name: "fetch", server_config: { command: "uvx" } },
          { id: 7, name: "bad" },
          "nope",
          {
            id: "b",
            name: "linear",
            server_config: "oops",
            missing_secrets: ["LINEAR_TOKEN", 3],
            used_by: { agent_count: -1, team_count: "x" },
          },
        ],
      },
    });
    const tools = await listTools();
    expect(tools.map((t) => t.name)).toEqual(["fetch", "linear"]);
    expect(tools[0]).toMatchObject({
      status: "ready",
      secret_refs: [],
      missing_secrets: [],
      used_by: { agent_count: 0, team_count: 0 },
    });
    // No status sent → derived from the missing secrets; junk config → {}.
    expect(tools[1]).toMatchObject({
      server_config: {},
      missing_secrets: ["LINEAR_TOKEN"],
      status: "needs_attention",
    });
  });

  it("answers an unexpected list body with an empty list", async () => {
    mockApi({ "GET /api/tool-library": { tools: null } });
    expect(await listTools()).toEqual([]);
  });

  it("reads one tool with who uses it", async () => {
    const calls = mockApi({
      "GET /api/tool-library/:id": {
        id: "g",
        name: "github",
        server_config: { url: "https://api.githubcopilot.com/mcp/" },
        used_by_agents: [
          { node_id: "n1", role_name: "Engineer", title: null, team_id: "t", team_name: "Docs" },
          { role_name: "no id" },
        ],
      },
    });
    const t = await getTool("g/1");
    expect(calls[0].path).toBe("/api/tool-library/g%2F1");
    expect(t.used_by_agents).toEqual([
      { node_id: "n1", role_name: "Engineer", title: null, team_id: "t", team_name: "Docs" },
    ]);
  });

  it("throws the server's copy on a refusal, keeping a structured detail", async () => {
    mockApi({
      "POST /api/secrets": new Response(
        JSON.stringify({ detail: "GITHUB_TOKEN already exists. Use Replace value on it instead." }),
        { status: 409 },
      ),
      "POST /api/tool-library/import": new Response(
        JSON.stringify({
          detail: {
            code: "name_taken",
            message: "You already have a tool named linear.",
            conflicts: ["linear"],
          },
        }),
        { status: 409 },
      ),
    });
    await expect(createSecret("GITHUB_TOKEN", "x")).rejects.toThrow(
      "GITHUB_TOKEN already exists. Use Replace value on it instead.",
    );
    const err = await importTools({ linear: { url: "https://mcp.linear.app/sse" } }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiDetailError);
    expect((err as ApiDetailError).message).toBe("You already have a tool named linear.");
    expect((err as ApiDetailError).detail).toMatchObject({ conflicts: ["linear"] });
  });

  it("sends the agents set and reads the result", async () => {
    const calls = mockApi({
      "PUT /api/tool-library/:id/agents": {
        agents: [
          { node_id: "n1", role_name: "Reviewer", title: null, team_id: "t", team_name: "X" },
        ],
        agent_count: 1,
        team_count: 1,
        skipped: [{ node_id: "n2", reason: "an inline server named linear overrides it" }],
      },
      "DELETE /api/tool-library/:id": { removed_from_agents: 3 },
      "GET /api/agents": {
        teams: [
          {
            team_id: "t",
            team_name: "Indicator sprint team",
            agents: [
              { node_id: "n0", role_name: "Product manager", edits_allowed: false, enabled: false },
              { node_id: "n1", role_name: "Reviewer", edits_allowed: true, enabled: true },
            ],
          },
          { team_name: "no id" },
        ],
      },
    });
    const res = await setToolAgents("lin", ["n1"]);
    expect(calls[0].body).toEqual({ node_ids: ["n1"] });
    expect(res.agent_count).toBe(1);
    expect(res.skipped).toHaveLength(1);
    expect(await deleteTool("lin")).toEqual({ removed_from_agents: 3 });
    const teams = await listAgents({ toolId: "lin" });
    expect(calls[2].path).toBe("/api/agents?tool_id=lin");
    expect(teams).toHaveLength(1);
    expect(teams[0].agents.map((a) => [a.role_name, a.edits_allowed, a.enabled])).toEqual([
      ["Product manager", false, false],
      ["Reviewer", true, true],
    ]);
  });

  it("reads secrets with the missing names, the summary, GitHub status and the catalog", async () => {
    mockApi({
      "GET /api/secrets": {
        secrets: [{ name: "GITHUB_TOKEN", used_by_tools: [{ id: "g", name: "github" }] }, {}],
        missing: [{ name: "LINEAR_TOKEN", used_by_tools: [{ id: "l", name: "linear" }] }],
      },
      "GET /api/toolkit/summary": { tools: 3, skills: 3, memory: { inbox: 2 }, secrets_missing: 1 },
      "GET /api/github/status": { hosted: true, installed: true, installation_count: 1 },
      "GET /api/tool-catalog": { tools: [{ key: "fetch", title: "Web fetch" }, { title: "x" }] },
    });
    const s = await listSecrets();
    expect(s.secrets.map((x) => x.name)).toEqual(["GITHUB_TOKEN"]);
    expect(s.secrets[0].updated_at).toBeNull();
    expect(s.missing[0]).toEqual({
      name: "LINEAR_TOKEN",
      used_by_tools: [{ id: "l", name: "linear" }],
    });
    expect(await getToolkitSummary()).toEqual({
      tools: 3,
      tools_needing_attention: 0,
      skills: 3,
      memory: { inbox: 2, active: 0, archive: 0 },
      secrets_missing: 1,
    });
    expect(await getGithubStatus()).toEqual({
      hosted: true,
      installed: true,
      installation_count: 1,
      repo_count: 0,
    });
    const catalog = await listToolCatalog();
    expect(catalog.map((c) => c.key)).toEqual(["fetch"]);
  });
});

describe("the Toolkit nav-badge loader", () => {
  it("publishes Tools, Skills, Memory inbox and Secrets missing from the summary", async () => {
    mockApi({
      "GET /api/inbox": { items: [] },
      "GET /api/toolkit/summary": {
        tools: 3,
        tools_needing_attention: 1,
        skills: 2,
        memory: { inbox: 4, active: 1, archive: 0 },
        secrets_missing: 1,
      },
    });
    await import("../../pages/badgeLoaders");
    const { result } = renderHook(() => useNavBadges());
    await act(() => refreshBadges());
    await waitFor(() =>
      expect(result.current).toMatchObject({
        tools: 3,
        skills: 2,
        memoryInbox: 4,
        secretsMissing: 1,
      }),
    );
  });
});
