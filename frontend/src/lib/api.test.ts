import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ContextManifest,
  InlineSkillSource,
  InvocationCost,
  LibrarySkillSource,
  NodeInvocation,
  ProjectRulesSkillSource,
  RepoSkillSource,
  RunEvent,
  SkillLibraryItem,
  SkillSource,
  ToolLibraryItem,
} from "./api";
import {
  createMemory,
  createSkillLibraryItem,
  createToolLibraryItem,
  getReviewMode,
  getRunDocuments,
  inspectRepo,
  listMemories,
  MODEL_PRESETS,
  presetsForProvider,
  promoteMemory,
  providerOf,
  rejectMemory,
  runTeam,
  setReviewMode,
  updateTeamNode,
  updateTerminalNode,
} from "./api";

describe("providerOf — parity with the backend provider_for_model", () => {
  // The SAME cases the backend test asserts (tests/test_resolve_owner_key.py): leading slug segment,
  // lower-cased + trimmed; a bare slug (no "/") is the whole string.
  it("derives the lower-cased leading slug segment", () => {
    expect(providerOf("OpenRouter/Foo/Bar")).toBe("openrouter");
    expect(providerOf("nvidia_nim/meta/llama-3.3-70b-instruct")).toBe("nvidia_nim");
    expect(providerOf("gpt-4o-mini")).toBe("gpt-4o-mini"); // no slash → the whole slug
  });

  it("scopes MODEL_PRESETS quick-picks to one provider", () => {
    const openrouter = presetsForProvider("openrouter");
    expect(openrouter.length).toBeGreaterThan(0);
    expect(openrouter.every((m) => providerOf(m) === "openrouter")).toBe(true);
    // Every preset's provider canonicalizes to itself, and gemini/groq are covered (the map parity).
    expect(MODEL_PRESETS.some((m) => providerOf(m) === "gemini")).toBe(true);
    expect(MODEL_PRESETS.some((m) => providerOf(m) === "groq")).toBe(true);
  });
});

function jsonOk(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as unknown as Response;
}

function bodyOf(call: unknown[]): unknown {
  return JSON.parse((call[1] as RequestInit).body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("updateTerminalNode — PATCHes terminal_kind (M-endpoint-editable)", () => {
  it("POSTs terminal_kind to the node endpoint and returns the node", async () => {
    const echo = {
      id: "n-ship",
      role_name: "stop",
      kind: "terminal",
      config: { terminal_kind: "stop" },
    };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(echo)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await updateTerminalNode("team-1", "n-ship", "stop");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/teams/team-1/nodes/n-ship");
    expect((init as RequestInit).method).toBe("PATCH");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ terminal_kind: "stop" });
    expect(out).toEqual(echo);
  });

  it("throws when the server rejects the PATCH", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) } as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(updateTerminalNode("team-1", "n-ship", "stop")).rejects.toThrow(
      /PATCH terminal .* -> 409/,
    );
  });
});

describe("updateTeamNode — memory_remember_enabled sent only when passed", () => {
  it("omits memory_remember_enabled when the caller does not pass it", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchMock);
    await updateTeamNode("team-1", "n1", "p", "m");
    const body = bodyOf(fetchMock.mock.calls[0]) as Record<string, unknown>;
    expect("memory_remember_enabled" in body).toBe(false);
    expect(body).toEqual({ prompt: "p", model: "m" });
  });

  it("sends memory_remember_enabled (true AND false) when passed as the trailing arg", async () => {
    const fetchOn = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchOn);
    // Positional tail: capability, toolConfig, skills, editsAllowed, memoryRememberEnabled.
    await updateTeamNode(
      "team-1",
      "n1",
      "p",
      "m",
      undefined,
      undefined,
      undefined,
      undefined,
      true,
    );
    expect(bodyOf(fetchOn.mock.calls[0])).toEqual({
      prompt: "p",
      model: "m",
      memory_remember_enabled: true,
    });

    const fetchOff = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchOff);
    await updateTeamNode(
      "team-1",
      "n1",
      "p",
      "m",
      undefined,
      undefined,
      undefined,
      undefined,
      false,
    );
    expect(bodyOf(fetchOff.mock.calls[0])).toEqual({
      prompt: "p",
      model: "m",
      memory_remember_enabled: false,
    });
  });
});

describe("updateTeamNode — writes_to / reads_from (M-docs)", () => {
  it("omits writes_to/reads_from when not passed (byte-identical PATCH)", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchMock);
    await updateTeamNode("team-1", "n1", "p", "m");
    const body = bodyOf(fetchMock.mock.calls[0]) as Record<string, unknown>;
    expect("writes_to" in body).toBe(false);
    expect("reads_from" in body).toBe(false);
  });

  it("sends writes_to + reads_from as the trailing args", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchMock);
    // tail: capability, toolConfig, skills, editsAllowed, memoryRememberEnabled, writesTo, readsFrom
    await updateTeamNode(
      "team-1",
      "n1",
      "p",
      "m",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "design",
      ["spec", "design"],
    );
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      prompt: "p",
      model: "m",
      writes_to: "design",
      reads_from: ["spec", "design"],
    });
  });

  it("sends empty writes_to / reads_from to CLEAR them", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ id: "n1" })));
    vi.stubGlobal("fetch", fetchMock);
    await updateTeamNode(
      "team-1",
      "n1",
      "p",
      "m",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "",
      [],
    );
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      prompt: "p",
      model: "m",
      writes_to: "",
      reads_from: [],
    });
  });
});

describe("getRunDocuments (M-docs run-view picker)", () => {
  it("GETs the run's documents list", async () => {
    const payload = {
      run_id: "r1",
      documents: [
        {
          id: "d1",
          name: "spec",
          title: "Mini-PRD",
          doc_type: "prd",
          created_at: "",
          updated_at: "",
        },
        {
          id: "d2",
          name: "design",
          title: "Document: design",
          doc_type: "design",
          created_at: "",
          updated_at: "",
        },
      ],
    };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(payload)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await getRunDocuments("r1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/runs/r1/documents");
    expect(out.documents.map((d) => d.name)).toEqual(["spec", "design"]);
  });
});

describe("runTeam — POST body shaping (greenfield byte-for-byte)", () => {
  it("posts ONLY { team_graph_id } when called with no opts", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r1" })));
    vi.stubGlobal("fetch", fetchMock);
    const id = await runTeam("team-1");
    expect(id).toBe("r1");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/runs");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ team_graph_id: "team-1" });
  });

  it("omits empty-string fields ⇒ a greenfield body (the byte-for-byte contract)", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r2" })));
    vi.stubGlobal("fetch", fetchMock);
    await runTeam("team-1", { idea: "", repo_path: "", base_ref: "" });
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ team_graph_id: "team-1" });
  });

  it("includes idea + brownfield fields when set", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r3" })));
    vi.stubGlobal("fetch", fetchMock);
    await runTeam("team-1", { idea: "add subtract", repo_path: "/repo", base_ref: "main" });
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      team_graph_id: "team-1",
      idea: "add subtract",
      repo_path: "/repo",
      base_ref: "main",
    });
  });

  it("includes only idea for a greenfield run with a feature request (no repo)", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r4" })));
    vi.stubGlobal("fetch", fetchMock);
    await runTeam("team-1", { idea: "ship a greeting" });
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      team_graph_id: "team-1",
      idea: "ship a greeting",
    });
  });

  it("includes subpath when a package is scoped (a wrong key / dropped line fails this)", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r5" })));
    vi.stubGlobal("fetch", fetchMock);
    await runTeam("team-1", { repo_path: "/repo", base_ref: "main", subpath: "core" });
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      team_graph_id: "team-1",
      repo_path: "/repo",
      base_ref: "main",
      subpath: "core",
    });
  });
});

describe("inspectRepo", () => {
  it("POSTs { path } and returns the is_git:true discriminated result", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonOk({
          is_git: true,
          current_branch: "main",
          branches: ["main", "dev"],
          tracked_file_count: 5,
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await inspectRepo("/repo");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/repo/inspect");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ path: "/repo" });
    expect(result).toEqual({
      is_git: true,
      current_branch: "main",
      branches: ["main", "dev"],
      tracked_file_count: 5,
    });
  });

  it("returns the is_git:false discriminated result (a result, never a throw)", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonOk({ is_git: false, error: "not a git work tree" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await inspectRepo("/nope");
    expect(result.is_git).toBe(false);
    if (!result.is_git) expect(result.error).toContain("not a git");
  });
});

// ---- M-ledger C6 wire contract: the ADDITIVE `/graph` invocation fields + `/spike/run-events`
// event fields. Constructing the literals is the compile-time type check; the assertions exercise
// the present + null (thinker/gate/legacy) cases the backend emits. ----
describe("M-ledger C6 additive types round-trip", () => {
  it("NodeInvocation carries context_manifest + cost (a worker round and a null gate round)", () => {
    const manifest: ContextManifest = {
      parts: [
        { name: "system", tokens: 900 },
        { name: "spec", tokens: 2100 },
      ],
      total_tokens: 3000,
      budget: 8000,
      handle_used: true,
    };
    const cost: InvocationCost = {
      prompt_tokens: 1240,
      completion_tokens: 320,
      total_tokens: 1560,
      cost_usd: 0.0041,
    };
    const worker: NodeInvocation = {
      iteration: 1,
      status: "done",
      outcome: "built",
      outcome_detail: null,
      started_at: "2026-01-01T00:00:00Z",
      ended_at: "2026-01-01T00:01:00Z",
      context_manifest: manifest,
      cost,
    };
    const gate: NodeInvocation = {
      iteration: 1,
      status: "done",
      outcome: null,
      outcome_detail: null,
      started_at: "2026-01-01T00:00:00Z",
      ended_at: null,
      context_manifest: null,
      cost: null,
    };
    expect(worker.context_manifest?.parts).toHaveLength(2);
    expect(worker.context_manifest?.handle_used).toBe(true);
    expect(worker.cost?.total_tokens).toBe(1560);
    expect(gate.context_manifest).toBeNull();
    expect(gate.cost).toBeNull();
  });

  it("RunEvent carries invocation_id + node_id + iteration (a ledger row and a legacy-null row)", () => {
    const ledger: RunEvent = {
      seq: 1,
      kind: "action",
      payload: { thought: "x" },
      created_at: "2026-01-01T00:00:00Z",
      invocation_id: 10,
      node_id: "n-eng",
      iteration: 2,
    };
    const legacy: RunEvent = {
      seq: 2,
      kind: "message",
      payload: {},
      created_at: "2026-01-01T00:00:00Z",
      invocation_id: null,
      node_id: null,
      iteration: null,
    };
    expect(ledger.invocation_id).toBe(10);
    expect(ledger.node_id).toBe("n-eng");
    expect(ledger.iteration).toBe(2);
    expect(legacy.invocation_id).toBeNull();
    expect(legacy.node_id).toBeNull();
    expect(legacy.iteration).toBeNull();
  });
});

// ---- M-tools C7.B: the skill-source union type-checks. Constructing the literals IS the compile-time
// check; the assertions exercise the discriminant + the inline modes + the optional repo filter. ----
describe("M-tools C7.B skill-source types", () => {
  it("constructs each skill-source variant with the right discriminant", () => {
    const inline: InlineSkillSource = {
      type: "inline",
      name: "house-style",
      content: "prefer small diffs",
      mode: "trigger",
      triggers: ["database"],
    };
    const repo: RepoSkillSource = {
      type: "repo",
      url: "https://github.com/org/skills",
      ref: "v1.0.0",
      filter: "greet",
    };
    const rules: ProjectRulesSkillSource = { type: "project_rules" };
    const sources: SkillSource[] = [inline, repo, rules];

    expect(sources.map((s) => s.type)).toEqual(["inline", "repo", "project_rules"]);
    // Narrowing on the discriminant reaches variant-only fields (the compile-time proof).
    expect(inline.mode).toBe("trigger");
    expect(inline.triggers).toEqual(["database"]);
    expect(repo.filter).toBe("greet");
  });

  it("allows the three inline disclosure modes and an optional repo filter", () => {
    const modes: InlineSkillSource["mode"][] = ["always", "trigger", "agent"];
    expect(modes).toHaveLength(3);
    const repoNoFilter: RepoSkillSource = { type: "repo", url: "u", ref: "r" };
    expect(repoNoFilter.filter).toBeUndefined();
  });
});

describe("M-tools C7.C — library types + clients", () => {
  it("type-checks the new library item types and the `library` SkillSource variant", () => {
    const tool: ToolLibraryItem = {
      id: "t1",
      name: "fetch",
      server_config: { command: "uvx" },
      created_at: "x",
    };
    const skill: SkillLibraryItem = {
      id: "s1",
      name: "house",
      source: { type: "inline", name: "house", content: "B", mode: "always" },
      created_at: "x",
    };
    const ref: LibrarySkillSource = { type: "library", id: "s1" };
    const asSource: SkillSource = ref; // the union now includes the library variant
    expect(tool.name).toBe("fetch");
    expect(skill.source.type).toBe("inline");
    expect(asSource.type).toBe("library");
  });

  it("createToolLibraryItem POSTs { name, server_config }", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonOk({ id: "t1", name: "fetch" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await createToolLibraryItem("fetch", { command: "uvx" });
    expect(out).toEqual({ id: "t1", name: "fetch" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/tool-library");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      name: "fetch",
      server_config: { command: "uvx" },
    });
  });

  it("createSkillLibraryItem POSTs { name, source }", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonOk({ id: "s1", name: "house" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createSkillLibraryItem("house", {
      type: "inline",
      name: "house",
      content: "B",
      mode: "always",
    });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/skill-library");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      name: "house",
      source: { type: "inline", name: "house", content: "B", mode: "always" },
    });
  });
});

// ---- M-memory S5a: the memory client — the request-shaping the shelf drives. The listMemories
// query-string builder and the SINGULAR /api/memory/review-mode path are the load-bearing bits (a
// wrong param name / a collision with /api/memories/{id} fails here). ----
describe("M-memory S5 — the memory client", () => {
  it("listMemories with no params GETs /api/memories (no query) and unwraps { memories }", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonOk({ memories: [{ id: "m1" }] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const rows = await listMemories();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memories");
    expect(rows).toEqual([{ id: "m1" }]);
  });

  it("listMemories encodes repo_key / status / include_superseded as query params", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ memories: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await listMemories({ repo_key: "/srv/app", status: "rejected", include_superseded: true });
    const [path, query] = (fetchMock.mock.calls[0][0] as string).split("?");
    expect(path).toBe("/api/memories");
    const sp = new URLSearchParams(query);
    expect(sp.get("repo_key")).toBe("/srv/app");
    expect(sp.get("status")).toBe("rejected");
    expect(sp.get("include_superseded")).toBe("true");
  });

  it("listMemories omits include_superseded when it is false", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ memories: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await listMemories({ include_superseded: false });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memories");
  });

  it("createMemory POSTs { content, polarity, repo_key } and returns the row", async () => {
    const row = { id: "m1", content: "use pnpm", polarity: "require", repo_key: null };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(row)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await createMemory({ content: "use pnpm", polarity: "require", repo_key: null });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memories");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      content: "use pnpm",
      polarity: "require",
      repo_key: null,
    });
    expect(out).toEqual(row);
  });

  it("getReviewMode GETs the SINGULAR /api/memory/review-mode and unwraps review_mode", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ review_mode: true })));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getReviewMode()).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memory/review-mode");
  });

  it("setReviewMode PATCHes { review_mode } to /api/memory/review-mode and returns the value", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ review_mode: false })));
    vi.stubGlobal("fetch", fetchMock);
    const out = await setReviewMode(false);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memory/review-mode");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ review_mode: false });
    expect(out).toBe(false);
  });

  it("promoteMemory / rejectMemory POST the S4 review-queue sub-paths", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonOk({ id: "m1", status: "active" })),
    );
    vi.stubGlobal("fetch", fetchMock);
    await promoteMemory("m1");
    await rejectMemory("m2");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/memories/m1/promote");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/memories/m2/reject");
  });
});
