import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";
import {
  countLibraryTeams,
  createFirstTeam,
  getDesktopTemplates,
  getProviderDirectory,
  listSavedKeys,
  NIM_HINT,
  saveProviderKey,
} from "./desktop";

function answer(status: number, body: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getProviderDirectory", () => {
  it("keeps valid entries in order and never lets NVIDIA NIM be picked", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, {
        provider_directory: [
          { provider: "anthropic", name: "Anthropic", label: "Claude models", serves_models: true },
          { provider: "", name: "broken" },
          // An older server without serves_models: NIM is still not pickable.
          { provider: "nvidia_nim", name: "NVIDIA NIM", label: "NIM models", hint: null },
          { provider: "xai", example_model: "xai/grok-4" },
        ],
      }),
    );
    const list = await getProviderDirectory();
    expect(list.map((e) => e.provider)).toEqual(["anthropic", "nvidia_nim", "xai"]);
    expect(list[1]).toMatchObject({ serves_models: false, hint: NIM_HINT });
    expect(list[2]).toMatchObject({
      name: "xai",
      label: "",
      example_model: "xai/grok-4",
      serves_models: true,
    });
  });

  it("an odd answer or no answer gives an empty list, never a throw", async () => {
    vi.stubGlobal("fetch", answer(200, { provider_directory: "nope" }));
    expect(await getProviderDirectory()).toEqual([]);
    vi.stubGlobal("fetch", answer(500, {}));
    expect(await getProviderDirectory()).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(await getProviderDirectory()).toEqual([]);
  });
});

describe("listSavedKeys / saveProviderKey", () => {
  it("reads the saved keys, dropping entries without a provider", async () => {
    vi.stubGlobal(
      "fetch",
      answer(200, {
        providers: [
          { provider: "anthropic", key_last4: "9c1e", created_at: "x" },
          { key_last4: "1" },
        ],
      }),
    );
    expect(await listSavedKeys()).toEqual([{ provider: "anthropic", key_last4: "9c1e" }]);
  });

  it("posts {provider, api_key} and returns what the server saved", async () => {
    const fetchMock = answer(200, { provider: "anthropic", key_last4: "9c1e", replaced: false });
    vi.stubGlobal("fetch", fetchMock);
    expect(await saveProviderKey("anthropic", "sk-ant-9c1e")).toEqual({
      provider: "anthropic",
      key_last4: "9c1e",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/providers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "anthropic",
      api_key: "sk-ant-9c1e",
    });
  });

  it("a 422 throws the server's detail", async () => {
    vi.stubGlobal("fetch", answer(422, { detail: "An API key is required." }));
    const err = await saveProviderKey("anthropic", " ").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, message: "An API key is required." });
  });
});

describe("getDesktopTemplates / createFirstTeam / countLibraryTeams (DT-34..DT-37)", () => {
  it("asks for=desktop and keeps valid templates and nodes, with a known runs_on only", async () => {
    const fetchMock = answer(200, {
      templates: [
        {
          template: "spec_only",
          name: "Spec only",
          description: "Turns an idea into a reviewed spec. No code changes.",
          shape: {
            nodes: [
              { kind: "thinker", role: "pm", label: "PM", model: "xai/grok-4.7", runs_on: "grok" },
              {
                kind: "worker",
                role: "reviewer",
                label: "Reviewer",
                model: null,
                runs_on: "codex",
              },
              { kind: "gate" },
            ],
          },
        },
        { template: "", name: "broken" },
        { template: "two_node", name: "PM → Engineer" },
      ],
      blank: "odd",
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await getDesktopTemplates();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      "/api/templates?for=desktop",
    );
    expect(out.templates.map((t) => t.template)).toEqual(["spec_only", "two_node"]);
    expect(out.templates[0].nodes).toEqual([
      { role: "pm", kind: "thinker", label: "PM", model: "xai/grok-4.7", runs_on: "grok" },
      { role: "reviewer", kind: "worker", label: "Reviewer", model: null, runs_on: null },
    ]);
    expect(out.templates[1].nodes).toEqual([]);
    expect(out.blank).toBeNull();
  });

  it("an unreadable answer throws (the step then shows no strips)", async () => {
    vi.stubGlobal("fetch", answer(500, { detail: "boom" }));
    await expect(getDesktopTemplates()).rejects.toBeInstanceOf(ApiError);
  });

  it("createFirstTeam posts use_plans and throws the 422 detail", async () => {
    const ok = answer(200, { team_graph_id: "t-1" });
    vi.stubGlobal("fetch", ok);
    await expect(createFirstTeam("review_loop", "My first team")).resolves.toEqual({
      team_graph_id: "t-1",
    });
    const init = (ok.mock.calls[0] as unknown[])[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      template: "review_loop",
      name: "My first team",
      use_plans: true,
    });
    vi.stubGlobal("fetch", answer(422, { detail: "A team name is required." }));
    await expect(createFirstTeam("blank", " ")).rejects.toMatchObject({
      status: 422,
      message: "A team name is required.",
    });
  });

  it("countLibraryTeams counts, and says null when it can't", async () => {
    vi.stubGlobal("fetch", answer(200, { teams: [{}, {}] }));
    await expect(countLibraryTeams()).resolves.toBe(2);
    vi.stubGlobal("fetch", answer(200, { teams: "odd" }));
    await expect(countLibraryTeams()).resolves.toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(countLibraryTeams()).resolves.toBeNull();
  });
});
