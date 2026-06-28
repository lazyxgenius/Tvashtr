import { afterEach, describe, expect, it, vi } from "vitest";

import { inspectRepo, MODEL_PRESETS, presetsForProvider, providerOf, runTeam } from "./api";

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
