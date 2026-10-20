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
  getConfig,
  rewriteGithubInstallUrlForDesktop,
  getGithubRepos,
  getGraph,
  getProviderCatalogue,
  getRunEvents,
  inspectRepo,
  listMemories,
  promoteMemory,
  providerOf,
  rejectMemory,
  setProviderCatalogue,
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

describe("rewriteGithubInstallUrlForDesktop", () => {
  const flyUrl =
    "https://github.com/login/oauth/authorize?client_id=Iv1.abc" +
    "&redirect_uri=https%3A%2F%2Ftvashtr.fly.dev%2Fapi%2Fauth%2Fgithub%2Fcallback";

  afterEach(() => {
    delete window.tvashtrDesktop;
  });

  it("is a no-op when not running inside the desktop shell", () => {
    expect(rewriteGithubInstallUrlForDesktop(flyUrl)).toBe(flyUrl);
    expect(rewriteGithubInstallUrlForDesktop("")).toBe("");
  });

  it("rewrites redirect_uri to the current loopback origin when tvashtrDesktop is set", () => {
    window.tvashtrDesktop = {
      engines: {
        getStatus: () => Promise.resolve([]),
        connect: () => Promise.reject(new Error("not implemented in test stub")),
        disconnect: () => Promise.reject(new Error("not implemented in test stub")),
        refresh: () => Promise.reject(new Error("not implemented in test stub")),
      },
    };
    // jsdom location is http://localhost:3000 by default in this suite setup — accept whatever origin.
    const out = rewriteGithubInstallUrlForDesktop(flyUrl);
    const parsed = new URL(out);
    expect(parsed.origin).toBe("https://github.com");
    expect(parsed.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      `${window.location.origin}/api/auth/github/callback`,
    );
  });
});

describe("getConfig — caches the served provider catalogue (M-runnable)", () => {
  it("populates the provider-catalogue cache from the served config", async () => {
    setProviderCatalogue([]); // start empty — prove getConfig fills it
    const served = {
      hosted_mode: false,
      github_install_url: "",
      github_manage_url: "",
      provider_catalogue: [
        {
          provider: "deepseek",
          thinker_default: "deepseek/deepseek-chat",
          worker_default: null,
          thinker_presets: ["deepseek/deepseek-chat", "deepseek/deepseek-reasoner"],
          worker_presets: [],
        },
        {
          provider: "openai",
          thinker_default: "openai/gpt-4o-mini",
          worker_default: "openai/gpt-4.1-mini",
          thinker_presets: ["openai/gpt-4o-mini"],
          worker_presets: ["openai/gpt-4.1-mini"],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(served))),
    );
    const cfg = await getConfig();
    expect(cfg.provider_catalogue).toHaveLength(2);
    expect(getProviderCatalogue()).toEqual(served.provider_catalogue);
  });

  it("returns the empty-catalogue fallback and never clobbers the cache when the endpoint is down", async () => {
    const stable = [
      {
        provider: "openai",
        thinker_default: "openai/gpt-4o-mini",
        worker_default: "openai/gpt-4.1-mini",
        thinker_presets: ["openai/gpt-4o-mini"],
        worker_presets: ["openai/gpt-4.1-mini"],
      },
    ];
    setProviderCatalogue(stable);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() =>
        Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response),
      ),
    );
    const cfg = await getConfig();
    expect(cfg.provider_catalogue).toEqual([]); // resilient fallback for the returned value
    expect(getProviderCatalogue()).toEqual(stable); // last-known catalogue is NOT wiped
  });
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

describe("getGithubRepos (M-h1b hosted-mode repo list)", () => {
  it("GETs /api/github/repos and returns the repos + installation_count", async () => {
    const payload = {
      repos: [
        {
          name: "app",
          full_name: "octo/app",
          private: false,
          default_branch: "main",
          html_url: "u",
        },
      ],
      installation_count: 2,
    };
    const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(payload)));
    vi.stubGlobal("fetch", fetchMock);
    const out = await getGithubRepos();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/github/repos");
    expect(out.installation_count).toBe(2);
    expect(out.repos[0].full_name).toBe("octo/app");
    expect(out.repos[0].private).toBe(false);
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
// query-string builder is the load-bearing bit (a wrong param name fails here). ----
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

describe("connectors in a run (contract: What a run shows)", () => {
  const call = (over: Record<string, unknown>) => ({
    connection_id: "c1",
    name: "Linear",
    tool: "create_issue",
    write: true,
    ok: true,
    blocked: false,
    arg: "Follow-up",
    at: "2026-09-30T10:06:00+00:00",
    duration_ms: 900,
    ...over,
  });

  it("getGraph reads each invocation's connectors block, and only an https result is an address", async () => {
    const graph = {
      run_id: "r1",
      team_graph_id: "g1",
      edges: [],
      nodes: [
        {
          id: "n1",
          invocations: [
            {
              iteration: 1,
              connectors: {
                used: [{ connection_id: "c1", name: "Linear", slug: "linear", writes: 2 }],
                calls: [
                  call({ result_url: "https://linear.app/x/issue/LIN-214" }),
                  call({ result_url: "javascript:alert(1)" }),
                ],
                total_calls: 2,
                skipped: [
                  { connection_id: null, name: "a connector", reason: "it was disconnected" },
                ],
              },
            },
            { iteration: 2, connectors: null },
            { iteration: 3 },
          ],
        },
        { id: "gate", invocations: [] },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonOk(graph))),
    );
    const out = await getGraph("r1");
    const [first, second, third] = out.nodes[0].invocations;
    expect(first.connectors?.used).toEqual([
      { connection_id: "c1", name: "Linear", slug: "linear", reads: 0, writes: 2 },
    ]);
    expect(first.connectors?.calls.map((c) => c.result_url)).toEqual([
      "https://linear.app/x/issue/LIN-214",
      null,
    ]);
    expect(first.connectors?.skipped).toEqual([
      { connection_id: null, name: "a connector", reason: "it was disconnected" },
    ]);
    expect(second.connectors).toBeNull();
    expect(third.connectors).toBeNull();
  });

  it("getRunEvents leaves the connector rows out of the feed", async () => {
    const event = (seq: number, kind: string) => ({
      seq,
      kind,
      payload: {},
      created_at: "2026-09-30T10:03:41+00:00",
      invocation_id: 1,
      node_id: "n1",
      iteration: 1,
    });
    const events = [
      event(1, "action"),
      event(2, "observation"),
      event(1_000_000_000, "connector_skipped"),
      event(1_000_000_001, "connector_call"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => Promise.resolve(jsonOk({ run_id: "r1", events }))),
    );
    const out = await getRunEvents("r1");
    expect(out.run_id).toBe("r1");
    expect(out.events.map((e) => e.kind)).toEqual(["action", "observation"]);
  });
});
