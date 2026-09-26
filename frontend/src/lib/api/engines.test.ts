import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetBackendStatusForTests, useBackendStatus } from "../backendStatus";
import {
  __resetEnginesConfigForTests,
  completeStatuses,
  getEngineUsage,
  getEnginesConfig,
  getSubscriptions,
  listKeys,
  removeKey,
  saveKey,
} from "./engines";
import { ApiDetailError } from "./runs";

function reply(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetEnginesConfigForTests();
  __resetBackendStatusForTests();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("getEnginesConfig", () => {
  it("reads the directory, catalogue and presets, dropping malformed entries", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        hosted_mode: true,
        provider_directory: [
          {
            provider: "nvidia_nim",
            monogram: "N",
            name: "NVIDIA NIM",
            label: "Open models on NVIDIA NIM",
            example_model: null,
            subscription: null,
            embeddings: false,
            hint: null,
          },
          { monogram: "?" },
          "junk",
        ],
        provider_catalogue: [
          {
            provider: "nvidia_nim",
            thinker_default: null,
            worker_default: null,
            thinker_presets: [],
            worker_presets: [],
          },
          { thinker_default: "x/y" },
        ],
        embedding_presets: [{ slug: "openai/text-embedding-3-small", provider: "openai" }],
      }),
    );
    const cfg = await getEnginesConfig();
    expect(cfg.directory).toEqual([
      expect.objectContaining({ provider: "nvidia_nim", monogram: "N", example_model: null }),
    ]);
    expect(cfg.catalogue).toHaveLength(1);
    expect(cfg.catalogue[0]).toMatchObject({ provider: "nvidia_nim", thinker_default: null });
    expect(cfg.embeddingPresets[0]).toMatchObject({ provider: "openai", dim: null });
    // Cached for the session.
    await getEnginesConfig();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an older server without the new keys gives empty lists, not a crash", async () => {
    fetchMock.mockResolvedValueOnce(reply({ hosted_mode: false }));
    await expect(getEnginesConfig()).resolves.toEqual({
      directory: [],
      catalogue: [],
      embeddingPresets: [],
    });
  });

  it("retries after a failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(getEnginesConfig()).rejects.toThrow();
    expect(renderHook(() => useBackendStatus()).result.current.state).toBe("offline");
    fetchMock.mockResolvedValueOnce(reply({ provider_directory: [] }));
    await expect(getEnginesConfig()).resolves.toMatchObject({ directory: [] });
  });
});

describe("getEngineUsage", () => {
  it("validates teams, nodes, domains and by_provider", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        teams: [
          {
            team_id: "t1",
            name: "Indicator sprint team",
            nodes: [
              {
                node_id: "n1",
                role_name: "pm",
                title: null,
                kind: "completion",
                model: "xai/grok-4.7",
                provider: "xai",
                fallback_model: null,
                fallback_provider: null,
              },
              {
                node_id: "n2",
                role_name: "writer",
                model: null,
                provider: "stale",
              },
              { role_name: "no id" },
            ],
          },
        ],
        domains: [{ domain_id: "d1", name: "Research", embedding_provider: "huggingface" }],
        by_provider: {
          xai: { teams: [{ team_id: "t1", name: "Indicator sprint team", roles: ["pm"] }] },
          huggingface: { domains: [{ domain_id: "d1", name: "Research", use: "embedding" }] },
          bad: "nope",
        },
      }),
    );
    const usage = await getEngineUsage();
    expect(usage.teams[0].nodes).toHaveLength(2);
    // A node with no model uses no provider.
    expect(usage.teams[0].nodes[1]).toMatchObject({ model: null, provider: null });
    expect(usage.domains[0]).toMatchObject({ embedding_provider: "huggingface" });
    expect(usage.by_provider.xai.teams[0]).toMatchObject({ roles: ["pm"], node_ids: [] });
    expect(usage.by_provider.huggingface.domains).toHaveLength(1);
    expect(usage.by_provider.bad).toBeUndefined();
  });

  it("throws on an answer that isn't the usage shape", async () => {
    fetchMock.mockResolvedValueOnce(reply({ detail: "?" }));
    await expect(getEngineUsage()).rejects.toThrow("Unexpected answer");
  });
});

describe("getSubscriptions", () => {
  it("always returns Claude, Grok, Codex and the runner", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        subscriptions: [
          { provider: "grok", connected: false, state: "needs_login" },
          { provider: "claude", connected: true, state: "weird", account_hint: "Claude Pro" },
          { provider: "openai", connected: true },
        ],
        runner: { fresh: true, last_seen_at: "2026-09-26T09:00:00+00:00", providers: ["claude"] },
      }),
    );
    const out = await getSubscriptions();
    expect(out.subscriptions.map((s) => [s.provider, s.state])).toEqual([
      ["claude", "connected"],
      ["grok", "needs_login"],
      ["codex", "disconnected"],
    ]);
    expect(out.runner).toEqual({
      fresh: true,
      last_seen_at: "2026-09-26T09:00:00+00:00",
      providers: ["claude"],
    });
  });

  it("an older server with no runner reads as never checked in", async () => {
    fetchMock.mockResolvedValueOnce(reply({ subscriptions: [] }));
    const out = await getSubscriptions();
    expect(out.runner).toEqual({ fresh: false, last_seen_at: null, providers: [] });
    expect(out.subscriptions).toEqual(completeStatuses([]));
  });
});

describe("keys", () => {
  it("lists keys, filling updated_at from created_at on an older server", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        providers: [
          { provider: "deepseek", key_last4: "7d24", created_at: "2026-09-12T08:00:00+00:00" },
          { key_last4: "none" },
        ],
      }),
    );
    expect(await listKeys()).toEqual([
      {
        provider: "deepseek",
        key_last4: "7d24",
        created_at: "2026-09-12T08:00:00+00:00",
        updated_at: "2026-09-12T08:00:00+00:00",
      },
    ]);
  });

  it("save returns whether it replaced a key", async () => {
    fetchMock.mockResolvedValueOnce(
      reply({
        provider: "anthropic",
        key_last4: "wQ3f",
        created_at: "2026-09-25T10:41:00+00:00",
        updated_at: "2026-09-26T10:41:00+00:00",
        replaced: true,
      }),
    );
    const out = await saveKey("anthropic", "sk-ant-secret");
    expect(out).toMatchObject({ provider: "anthropic", key_last4: "wQ3f", replaced: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/providers");
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "anthropic",
      api_key: "sk-ant-secret",
    });
  });

  it("a 422 carries the server's plain detail for the inline error", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(
        { detail: "Use just the model prefix — the part before the slash, like mistral." },
        422,
      ),
    );
    const err = await saveKey("mis tral", "k").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiDetailError);
    expect((err as ApiDetailError).status).toBe(422);
    expect((err as ApiDetailError).message).toBe(
      "Use just the model prefix — the part before the slash, like mistral.",
    );
  });

  it("remove sends DELETE and accepts 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await removeKey("nvidia_nim");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/providers/nvidia_nim");
    expect(init.method).toBe("DELETE");
  });
});
