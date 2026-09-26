import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonError, mockApi } from "../../pages/home/homeTestUtils";
import { __resetBackendStatusForTests } from "../backendStatus";
import {
  getMemoryCounts,
  getReviewMode,
  listMemories,
  listMemoryRepos,
  parseMemory,
  promoteMemory,
  requeueMemory,
  setReviewMode,
  updateMemory,
} from "./memory";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetBackendStatusForTests();
});

const row = {
  id: "m1",
  content: "Run `uv run pytest -q` before shipping.",
  polarity: "require",
  repo_key: "lazyxgenius/trade_mcp",
  repo_label: "lazyxgenius/trade_mcp",
  node_id: "n1",
  tier: "node",
  pinned: false,
  status: "pending_review",
  confirmation_count: 1,
  source_run_id: "r1",
  source_node_id: "n1",
  superseded_by: null,
  valid_from: "2026-09-25T09:12:03Z",
  invalid_at: null,
  edited_at: null,
  created_at: "2026-09-25T09:12:03Z",
  updated_at: "2026-09-25T09:12:03Z",
  agent: {
    node_id: "n1",
    role_name: "reviewer",
    title: null,
    team_id: "t1",
    team_name: "Indicator sprint team",
  },
  source: {
    kind: "run",
    run_id: "r1",
    run_title: "Add an RSI indicator",
    run_status: "completed",
    run_succeeded: true,
    round: 3,
    agent_role: "reviewer",
    team_name: "Indicator sprint team",
    node_id: "n1",
  },
};

describe("parseMemory", () => {
  it("keeps a well-formed row", () => {
    expect(parseMemory(row)).toEqual(row);
  });

  it("fills what an older server leaves out (repo_label, tier, source, agent)", () => {
    const m = parseMemory({
      id: "m2",
      content: "x",
      polarity: "context",
      status: "active",
      repo_key: "octo/app",
      node_id: null,
      source_run_id: "r9",
      created_at: "2026-01-01T00:00:00Z",
    });
    expect(m).toMatchObject({
      repo_label: "octo/app",
      tier: "repo",
      agent: null,
      confirmation_count: 1,
      updated_at: "2026-01-01T00:00:00Z",
      source: { kind: "run", run_id: "r9", run_title: null, round: null },
    });
    expect(
      parseMemory({ id: "m3", content: "y", polarity: "allow", status: "active" }),
    ).toMatchObject({ tier: "account", source: { kind: "manual", run_id: null } });
  });

  it("drops a row it can't read", () => {
    expect(parseMemory({ ...row, polarity: "sometimes" })).toBeNull();
    expect(parseMemory({ ...row, status: "deleted" })).toBeNull();
    expect(parseMemory({ ...row, content: 3 })).toBeNull();
    expect(parseMemory(null)).toBeNull();
  });
});

describe("memory client", () => {
  it("lists one status and drops malformed rows", async () => {
    const calls = mockApi({
      "GET /api/memories": { memories: [row, { id: "bad" }] },
    });
    const list = await listMemories("pending_review");
    expect(list.map((m) => m.id)).toEqual(["m1"]);
    expect(calls.at(-1)?.path).toBe("/api/memories?status=pending_review");
  });

  it("treats a list in another shape as a failed load", async () => {
    mockApi({ "GET /api/memories": [row] });
    await expect(listMemories("active")).rejects.toThrow(/Unexpected answer/);
  });

  it("reads the counts and the review switch", async () => {
    const calls = mockApi({
      "GET /api/memories/counts": { inbox: 2, active: 14, archive: 3 },
      "GET /api/memory/review-mode": { review_mode: true },
      "PATCH /api/memory/review-mode": (_u: URL, b: unknown) => b,
    });
    expect(await getMemoryCounts()).toEqual({ inbox: 2, active: 14, archive: 3 });
    expect(await getReviewMode()).toBe(true);
    expect(await setReviewMode(false)).toBe(false);
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      body: { review_mode: false },
    });
  });

  it("rejects counts in another shape", async () => {
    mockApi({ "GET /api/memories/counts": { inbox: "2" } });
    await expect(getMemoryCounts()).rejects.toThrow(/Unexpected answer/);
  });

  it("promote: a merge answers the existing memory and the id Undo must requeue", async () => {
    mockApi({
      "POST /api/memories/:id/promote": {
        ...row,
        id: "m-old",
        status: "active",
        action: "promote_merged",
        merged_id: "m1",
      },
    });
    const res = await promoteMemory("m1");
    expect(res).toMatchObject({ action: "promote_merged", mergedId: "m1" });
    expect(res.memory.id).toBe("m-old");
  });

  it("promote: a plain keep has no merged id", async () => {
    mockApi({
      "POST /api/memories/:id/promote": { ...row, status: "active", action: "promote" },
    });
    expect(await promoteMemory("m1")).toMatchObject({ action: "promote", mergedId: null });
  });

  it("requeue answers the memory back in the Inbox", async () => {
    mockApi({
      "POST /api/memories/:id/requeue": {
        ...row,
        action: "requeue",
        restored: ["m7"],
        unmerged_from: null,
      },
    });
    const res = await requeueMemory("m1");
    expect(res).toMatchObject({ action: "requeue", restored: ["m7"], unmergedFrom: null });
    expect(res.memory.status).toBe("pending_review");
  });

  it("an edit sends only the patch and surfaces the backend's refusal", async () => {
    const calls = mockApi({
      "PATCH /api/memories/:id": (_u: URL, b: unknown) =>
        (b as { scope?: string }).scope === "agent"
          ? jsonError(422, "This memory has no agent to scope to.")
          : { ...row, ...(b as object) },
    });
    const m = await updateMemory("m1", { polarity: "forbid" });
    expect(m.polarity).toBe("forbid");
    expect(calls.at(-1)).toMatchObject({ path: "/api/memories/m1", body: { polarity: "forbid" } });
    await expect(updateMemory("m1", { scope: "agent" })).rejects.toMatchObject({
      status: 422,
      message: "This memory has no agent to scope to.",
    });
  });

  it("lists the repos a memory can be scoped to", async () => {
    mockApi({
      "GET /api/memory/repos": {
        repos: [
          {
            repo_key: "lazyxgenius/trade_mcp",
            label: "lazyxgenius/trade_mcp",
            memory_count: 9,
            pending_count: 2,
            last_run_at: "2026-09-25T09:02:44Z",
          },
          { label: "no key" },
        ],
      },
    });
    expect(await listMemoryRepos()).toEqual([
      {
        repo_key: "lazyxgenius/trade_mcp",
        label: "lazyxgenius/trade_mcp",
        memory_count: 9,
        pending_count: 2,
        last_run_at: "2026-09-25T09:02:44Z",
      },
    ]);
  });
});
