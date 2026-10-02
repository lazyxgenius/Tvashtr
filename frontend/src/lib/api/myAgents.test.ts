import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../backendStatus";
import {
  basedOnOf,
  deleteMyAgent,
  detachAgent,
  listMyAgents,
  listRecentTasks,
  renameMyAgent,
  saveMyAgent,
  undoAgent,
  updateTeamAgent,
  applyAgentToNode,
  addAgentToTeam,
} from "./myAgents";
import { ApiDetailError } from "./runs";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const AGENT = {
  id: "a1",
  name: "Strict reviewer",
  purpose: "Reviews Python changes against the spec.",
  latest: 2,
  updated_at: "2026-10-01T10:00:00Z",
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [],
  used_in: [],
  behind: [],
};

describe("my agents client", () => {
  it("lists the account's saved agents; a body without a list reads as none", async () => {
    mockApi({ "GET /api/my-agents": { agents: [AGENT] } });
    expect(await listMyAgents()).toEqual([AGENT]);
    mockApi({ "GET /api/my-agents": {} });
    expect(await listMyAgents()).toEqual([]);
  });

  it("saves a node as my agent with the included parts", async () => {
    const calls = mockApi({
      "POST /api/my-agents": { agent: AGENT, version: 2, created: false },
    });
    const out = await saveMyAgent({
      team_id: "t1",
      node_id: "n1",
      name: "Strict reviewer",
      purpose: "Reviews.",
      include: ["instructions", "model"],
    });
    expect(out.version).toBe(2);
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/my-agents",
      body: {
        team_id: "t1",
        node_id: "n1",
        name: "Strict reviewer",
        purpose: "Reviews.",
        include: ["instructions", "model"],
      },
    });
  });

  it("throws the server's words (422, 409)", async () => {
    mockApi({ "PATCH /api/my-agents/:id": jsonError(409, "You already have an agent called X.") });
    await expect(renameMyAgent("a1", { name: "X" })).rejects.toThrow(
      "You already have an agent called X.",
    );
    await expect(renameMyAgent("a1", { name: "X" })).rejects.toBeInstanceOf(ApiDetailError);
  });

  it("uses, undoes and detaches an agent on a node; deletes; updates a team; uses in a team", async () => {
    const calls = mockApi({
      "POST /api/teams/:t/nodes/:n/use-agent": {
        node: { id: "n1" },
        before: { prompt: "old" },
        text: "Reviewer now uses Strict reviewer v2",
      },
      "POST /api/teams/:t/nodes/:n/undo-agent": { id: "n1" },
      "POST /api/teams/:t/nodes/:n/detach-agent": { id: "n1" },
      "DELETE /api/my-agents/:id": new Response(null, { status: 204 }),
      "POST /api/my-agents/:id/update-team": {
        updated: [{ node_id: "n9", before: { prompt: "v1" } }],
        text: "Bugfix squad now uses Strict reviewer v2",
      },
      "POST /api/my-agents/:id/use-in-team": { team_id: "t2", node_id: "n10" },
    });
    const used = await applyAgentToNode("t1", "n1", "a1");
    expect(used.text).toBe("Reviewer now uses Strict reviewer v2");
    await undoAgent("t1", "n1", used.before);
    await detachAgent("t1", "n1");
    await deleteMyAgent("a1");
    const upd = await updateTeamAgent("a1", "t2");
    expect(upd.updated).toHaveLength(1);
    expect(await addAgentToTeam("a1", "t2")).toEqual({ team_id: "t2", node_id: "n10" });
    expect(calls.slice(-6).map((c) => [c.method, c.path, c.body])).toEqual([
      ["POST", "/api/teams/t1/nodes/n1/use-agent", { agent_id: "a1" }],
      ["POST", "/api/teams/t1/nodes/n1/undo-agent", { before: { prompt: "old" } }],
      ["POST", "/api/teams/t1/nodes/n1/detach-agent", undefined],
      ["DELETE", "/api/my-agents/a1", undefined],
      ["POST", "/api/my-agents/a1/update-team", { team_id: "t2" }],
      ["POST", "/api/my-agents/a1/use-in-team", { team_id: "t2" }],
    ]);
  });

  it("asks for recent tasks with q and limit; a body without a list reads as none", async () => {
    const task = {
      task: "Add an RSI indicator",
      team: { id: "t1", name: "Indicator sprint team" },
      status: "completed",
      status_group: "done",
      run_id: "r12",
      number: 12,
      created_at: "2026-10-02T08:00:00Z",
    };
    const calls = mockApi({ "GET /api/recent-tasks": { tasks: [task] } });
    expect(await listRecentTasks("add a")).toEqual([task]);
    expect(calls.at(-1)?.path).toBe("/api/recent-tasks?q=add+a&limit=6");
    mockApi({ "GET /api/recent-tasks": {} });
    expect(await listRecentTasks("x")).toEqual([]);
  });
});

describe("basedOnOf", () => {
  it("reads a node's based_on, or null when it has none or it's malformed", () => {
    expect(basedOnOf({ based_on: { id: "a1", name: "Strict reviewer", version: 2 } })).toEqual({
      id: "a1",
      name: "Strict reviewer",
      version: 2,
    });
    expect(basedOnOf(null)).toBeNull();
    expect(basedOnOf({})).toBeNull();
    expect(basedOnOf({ based_on: { name: "x" } })).toBeNull();
  });
});
