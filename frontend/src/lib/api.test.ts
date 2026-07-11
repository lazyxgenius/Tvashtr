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
  createSkillLibraryItem,
  createToolLibraryItem,
  inspectRepo,
  MODEL_PRESETS,
  presetsForProvider,
  providerOf,
  runTeam,
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
