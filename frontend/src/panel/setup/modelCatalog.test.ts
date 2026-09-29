import { describe, expect, it } from "vitest";

import type { GraphEdge, ProviderCatalogueEntry, TeamGraphNode } from "../../lib/api";
import {
  customModelProblem,
  isCatalogueModel,
  landingModel,
  modelGroups,
  pickerNote,
  PROVEN_NOTE,
  sameModelSibling,
  searchGroups,
  seatOf,
  shortId,
  subscriptionStateText,
  unknownModel,
} from "./modelCatalog";
import type { CredentialCover } from "./modelCopy";

const entry = (
  provider: string,
  worker: string[],
  extra: Partial<ProviderCatalogueEntry> = {},
): ProviderCatalogueEntry => ({
  provider,
  thinker_default: worker[0] ?? null,
  worker_default: worker[0] ?? null,
  thinker_presets: worker,
  worker_presets: worker,
  label: provider.toUpperCase(),
  subscription: null,
  byok_probed: true,
  ...extra,
});

// Shaped like control_plane/teams.py: NIM serves no seat, gemini serves only the worker seat, and
// the subscription providers were never proven on an API key.
const CATALOGUE: ProviderCatalogueEntry[] = [
  entry("nvidia_nim", [], { label: "NVIDIA NIM" }),
  entry("openai", ["openai/gpt-4.1-mini"], { label: "OpenAI" }),
  entry("gemini", ["gemini/gemini-2.5-flash"], {
    label: "Gemini",
    thinker_default: null,
    thinker_presets: [],
  }),
  entry("anthropic", ["anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4"], {
    label: "Anthropic",
    subscription: "claude",
    byok_probed: false,
  }),
  entry("xai", ["xai/grok-4.7"], { label: "xAI", subscription: "grok", byok_probed: false }),
];

const cover = (keys: string[], subs: CredentialCover["subs"] = {}): CredentialCover => ({
  byok: new Set(keys),
  subs,
});

describe("seatOf", () => {
  it("puts sandboxed agents in the worker seat and everything else in the thinker seat", () => {
    expect(seatOf({ kind: "agent" })).toBe("worker");
    expect(seatOf({ kind: "completion" })).toBe("thinker");
  });
});

describe("modelGroups", () => {
  it("never offers NVIDIA NIM: it has no models for either seat, even with a key", () => {
    for (const seat of ["worker", "thinker"] as const) {
      const groups = modelGroups(CATALOGUE, seat, cover(["nvidia_nim", "openai"]), {
        desktop: false,
        current: "",
      });
      expect(groups.map((g) => g.provider)).not.toContain("nvidia_nim");
    }
  });

  it("lists only the models this seat can run (gemini serves workers only)", () => {
    const worker = modelGroups(CATALOGUE, "worker", cover([]), { desktop: false, current: "" });
    const thinker = modelGroups(CATALOGUE, "thinker", cover([]), { desktop: false, current: "" });
    expect(worker.map((g) => g.provider)).toContain("gemini");
    expect(thinker.map((g) => g.provider)).not.toContain("gemini");
    expect(worker.find((g) => g.provider === "anthropic")?.models).toEqual([
      "anthropic/claude-sonnet-5",
      "anthropic/claude-sonnet-4",
    ]);
  });

  it("orders the current provider first, then the subscription providers, then the catalogue", () => {
    const groups = modelGroups(CATALOGUE, "worker", cover([]), {
      desktop: false,
      current: "xai/grok-4.7",
    });
    expect(groups.map((g) => g.provider)).toEqual(["xai", "anthropic", "openai", "gemini"]);
  });

  it("on Desktop, a connected subscription runs its provider on this computer", () => {
    const groups = modelGroups(CATALOGUE, "worker", cover(["openai"], { grok: true }), {
      desktop: true,
      current: "xai/grok-4.7",
    });
    const state = Object.fromEntries(groups.map((g) => [g.provider, g.state]));
    expect(state).toEqual({
      xai: "subscription",
      anthropic: "none",
      openai: "key",
      gemini: "none",
    });
    // Desktop never shows the website's "run it in Tvashtr Desktop" explainer.
    expect(groups.some((g) => g.desktopExplainer)).toBe(false);
  });

  it("on the website, subscriptions don't run agents: a Claude or Grok group needs a key", () => {
    const groups = modelGroups(CATALOGUE, "worker", cover(["xai"], { grok: true, claude: true }), {
      desktop: false,
      current: "xai/grok-4.7",
    });
    const xai = groups.find((g) => g.provider === "xai");
    const anthropic = groups.find((g) => g.provider === "anthropic");
    expect(xai?.state).toBe("key");
    expect(anthropic?.state).toBe("none");
    expect(anthropic?.desktopExplainer).toBe(true);
    // Gemini has no subscription, so no explainer, just the key field.
    expect(groups.find((g) => g.provider === "gemini")?.desktopExplainer).toBe(false);
  });
});

describe("searchGroups", () => {
  const groups = modelGroups(CATALOGUE, "worker", cover(["openai"]), {
    desktop: false,
    current: "",
  });

  it("keeps a provider whole when its name matches, and only matching models otherwise", () => {
    expect(searchGroups(groups, "anthro").map((g) => g.models.length)).toEqual([2]);
    const sonnet4 = searchGroups(groups, "sonnet-4");
    expect(sonnet4.map((g) => g.models)).toEqual([["anthropic/claude-sonnet-4"]]);
    expect(searchGroups(groups, "OpenAI").map((g) => g.provider)).toEqual(["openai"]);
    expect(searchGroups(groups, "nothing like it")).toEqual([]);
    expect(searchGroups(groups, "  ")).toHaveLength(groups.length);
  });
});

describe("pickerNote", () => {
  it("says every model is proven only when every listed provider is", () => {
    const desktop = modelGroups(
      CATALOGUE,
      "worker",
      cover(["openai"], { grok: true, claude: true }),
      {
        desktop: true,
        current: "",
      },
    );
    expect(pickerNote(desktop)).toBe(PROVEN_NOTE);
  });

  it("names the providers that were never proven on an API key", () => {
    const web = modelGroups(CATALOGUE, "worker", cover(["xai", "openai"]), {
      desktop: false,
      current: "",
    });
    expect(pickerNote(web)).toBe(
      "Proven to run a full build, except Anthropic and xAI models on an API key.",
    );
  });
});

describe("model helpers", () => {
  it("shortId drops the provider", () => {
    expect(shortId("xai/grok-4.7")).toBe("grok-4.7");
    expect(shortId("openrouter/openai/gpt-4o-mini")).toBe("openai/gpt-4o-mini");
    expect(shortId("bare")).toBe("bare");
  });

  it("subscriptionStateText names the subscription", () => {
    expect(subscriptionStateText("grok")).toBe("Grok subscription · this computer");
    expect(subscriptionStateText("claude")).toBe("Claude subscription · this computer");
  });

  it("unknownModel flags a slug the catalogue doesn't list, for either seat", () => {
    expect(unknownModel("openai/gpt-4o-mni", CATALOGUE)).toBe("openai/gpt-4o-mni");
    expect(unknownModel(" openai/gpt-4.1-mini ", CATALOGUE)).toBeNull();
    expect(unknownModel("", CATALOGUE)).toBeNull();
    // An empty catalogue (still loading) can't call anything unknown.
    expect(unknownModel("openai/gpt-4o-mni", [])).toBeNull();
    expect(isCatalogueModel("xai/grok-4.7", CATALOGUE)).toBe(true);
  });

  it("customModelProblem wants provider/model", () => {
    expect(customModelProblem("openai/gpt-4o")).toBeNull();
    expect(customModelProblem(" openrouter/meta/llama ")).toBeNull();
    for (const bad of ["", "gpt-4o", "/gpt-4o", "openai/", "open ai/gpt"]) {
      expect(customModelProblem(bad)).toBe("Use provider/model, for example openai/gpt-4.1-mini.");
    }
  });

  it("landingModel is the seat's default, else the first preset", () => {
    const groups = modelGroups(CATALOGUE, "worker", cover([]), { desktop: false, current: "" });
    const gemini = groups.find((g) => g.provider === "gemini");
    expect(gemini && landingModel(gemini, CATALOGUE, "worker")).toBe("gemini/gemini-2.5-flash");
    const anthropic = groups.find((g) => g.provider === "anthropic");
    expect(anthropic && landingModel(anthropic, CATALOGUE, "worker")).toBe(
      "anthropic/claude-sonnet-5",
    );
  });
});

describe("sameModelSibling", () => {
  const node = (id: string, kind: TeamGraphNode["kind"], model: string, title: string) =>
    ({ id, kind, model, config: { title } }) as unknown as TeamGraphNode;
  const nodes = [
    node("n-pm", "completion", "openai/gpt-4.1-mini", "Product manager"),
    node("n-eng", "agent", "xai/grok-4.7", "Engineer"),
    node("n-rev", "agent", "xai/grok-4.7", "Reviewer"),
    node("n-other", "agent", "xai/grok-4.7", "Unconnected"),
  ];
  const edges = [
    { id: "e1", source_node_id: "n-pm", target_node_id: "n-eng" },
    { id: "e2", source_node_id: "n-eng", target_node_id: "n-rev" },
  ] as GraphEdge[];

  it("names a connected agent running the same model, for a verdict agent", () => {
    expect(sameModelSibling(nodes[2], "xai/grok-4.7", nodes, edges, { verdict: true })).toBe(
      "Engineer",
    );
  });

  it("stays quiet for a non-verdict agent, another model, or no model", () => {
    expect(sameModelSibling(nodes[2], "xai/grok-4.7", nodes, edges, { verdict: false })).toBeNull();
    expect(
      sameModelSibling(nodes[2], "openai/gpt-4.1-mini", nodes, edges, { verdict: true }),
    ).toBeNull();
    expect(sameModelSibling(nodes[2], " ", nodes, edges, { verdict: true })).toBeNull();
  });
});
