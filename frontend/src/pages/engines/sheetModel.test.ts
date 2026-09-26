import { describe, expect, it } from "vitest";

import type { ProviderDirectoryEntry } from "../../lib/api/engines";
import { DIRECTORY, KEYS, SUBS, USAGE, key, sampleInputs, sub } from "./enginesTestUtils";
import {
  effectiveProvider,
  filterOptions,
  footerNote,
  pickerOptions,
  prefixError,
  replaceHint,
  saveToast,
  sheetHint,
  subscriptionNote,
} from "./sheetModel";

const HF_HINT =
  "Used by Domains ingest for BGE-small embeddings. A free token from huggingface.co works.";

/** The sample directory with the design's descriptions and huggingface's own hint. */
const directory: ProviderDirectoryEntry[] = DIRECTORY.map((d) =>
  d.provider === "huggingface"
    ? { ...d, label: "Domains BGE-small embeddings (free token)", embeddings: true, hint: HF_HINT }
    : d.provider === "openrouter"
      ? { ...d, label: "many models through one key" }
      : d,
);
const inputs = sampleInputs({ directory });

describe("picker options (ENG-63, OQ-22)", () => {
  it("lists the whole directory, team-used first, with the design's tags", () => {
    const rows = pickerOptions(inputs).map((o) => [o.provider, o.description]);
    expect(rows).toEqual([
      ["anthropic", "Anthropic models · your teams use it"],
      ["xai", "xAI models · your teams use it"],
      ["deepseek", "Saved · DeepSeek models"],
      ["openai", "OpenAI models"],
      ["huggingface", "Domains BGE-small embeddings (free token)"],
      ["nvidia_nim", "Saved · No agent uses NVIDIA NIM right now"],
      ["openrouter", "Saved · many models through one key"],
    ]);
  });

  it("describes a provider no agent runs on plainly, saved or not, and never sorts it first", () => {
    const unsaved = pickerOptions({ ...inputs, keys: [] }).find((o) => o.provider === "nvidia_nim");
    expect(unsaved?.description).toBe("No agent uses NVIDIA NIM right now");
    const onNim = {
      ...inputs,
      usage: {
        ...USAGE,
        teams: [
          {
            team_id: "t-nim",
            name: "NIM team",
            nodes: [{ ...USAGE.teams[1].nodes[0], model: "nvidia_nim/x", provider: "nvidia_nim" }],
          },
        ],
      },
    };
    const nim = pickerOptions(onNim).find((o) => o.provider === "nvidia_nim");
    expect(nim?.teamUsed).toBe(false);
    expect(pickerOptions(onNim)[0].provider).not.toBe("nvidia_nim");
  });

  it("marks saved providers (a pick replaces them, OQ-5)", () => {
    const saved = pickerOptions(inputs)
      .filter((o) => o.saved)
      .map((o) => o.provider);
    expect(saved).toEqual(["deepseek", "nvidia_nim", "openrouter"]);
  });

  it("searches slug, name and description, case-insensitively (ENG-64)", () => {
    const all = pickerOptions(inputs);
    expect(filterOptions(inputs, all, "hug").map((o) => o.provider)).toEqual(["huggingface"]);
    expect(filterOptions(inputs, all, "GROK").map((o) => o.provider)).toEqual([]);
    expect(filterOptions(inputs, all, "xAI").map((o) => o.provider)).toEqual(["xai"]);
    expect(filterOptions(inputs, all, "saved")).toHaveLength(3);
    expect(filterOptions(inputs, all, "  ")).toHaveLength(all.length);
  });
});

describe("the hint under the picker (ENG-65/66)", () => {
  it("says what the key covers, with the directory's example model", () => {
    expect(sheetHint(inputs, "anthropic")).toEqual({
      kind: "covers",
      prefix: "anthropic/",
      example: "anthropic/claude-sonnet-5",
    });
    expect(sheetHint(inputs, "mistral")).toEqual({
      kind: "covers",
      prefix: "mistral/",
      example: null,
    });
  });

  it("uses a provider's own hint, bolding Domains (EnF-PickProvider-4)", () => {
    expect(sheetHint(inputs, "huggingface")).toEqual({
      kind: "text",
      text: HF_HINT,
      strong: "Domains",
    });
  });

  it("says plainly that a NIM key won't run anything", () => {
    expect(sheetHint(inputs, "nvidia_nim")).toEqual({
      kind: "text",
      text: "No agent uses NVIDIA NIM right now, so this key won’t run anything yet.",
      strong: null,
    });
  });

  it("says a save replaces an existing key", () => {
    expect(replaceHint(inputs, "deepseek")).toBe(
      "This replaces your saved deepseek key (•••• 7d24).",
    );
    expect(replaceHint(inputs, "anthropic")).toBeNull();
  });
});

describe("Other: the model prefix (ENG-70)", () => {
  it("wants just the part before the slash", () => {
    expect(prefixError("mistral/")).toBe("Just the part before the slash: mistral.");
    expect(prefixError(" Mistral/large ")).toBe("Just the part before the slash: mistral.");
    expect(prefixError("/large")).toBe("Just the part before the slash, like mistral.");
  });

  it("accepts the server's alphabet only", () => {
    expect(prefixError("")).toBeNull();
    expect(prefixError("mistral")).toBeNull();
    expect(prefixError("my_gw.v2-eu")).toBeNull();
    expect(prefixError("_x")).toBe("Start with a letter or a number.");
    expect(prefixError("mis tral")).toBe("Use letters, numbers, _ . or - only.");
    expect(prefixError("a".repeat(65))).toBe("Keep it to 64 characters or fewer.");
  });

  it("saves to the typed prefix, lowercased and trimmed, only when it is valid", () => {
    expect(effectiveProvider({ kind: "other" }, " Mistral ")).toBe("mistral");
    expect(effectiveProvider({ kind: "other" }, "mistral/")).toBe("");
    expect(effectiveProvider({ kind: "provider", provider: "xai" }, "")).toBe("xai");
    expect(effectiveProvider({ kind: "none" }, "mistral")).toBe("");
  });
});

describe("notes and footer (ENG-68)", () => {
  it("adds the subscription note only while that subscription is connected", () => {
    expect(subscriptionNote(inputs, "anthropic")).toBe(
      "On Tvashtr Desktop your Claude subscription still runs first. This key covers website runs, and Desktop runs if you disconnect Claude.",
    );
    // Grok needs sign-in in the sample.
    expect(subscriptionNote(inputs, "xai")).toBeNull();
    const grok = sampleInputs({ subs: [SUBS[0], sub("grok", "connected"), SUBS[2]] });
    expect(subscriptionNote(grok, "xai")).toContain("your Grok subscription still runs first");
    expect(subscriptionNote(inputs, "openai")).toBeNull();
  });

  it("says who uses the picked provider", () => {
    const at = (provider: string) => footerNote(inputs, { kind: "provider", provider }, "");
    expect(at("anthropic")).toBe("Used by Engineer · Indicator sprint team");
    expect(at("xai")).toBe("Used by Product manager, Reviewer · Indicator sprint team");
    expect(at("openai")).toBeNull();
    expect(at("nvidia_nim")).toBeNull();
    // An embeddings-only key is only ever used by Domains ingest.
    expect(at("huggingface")).toBe("Used by Domains ingest");
    expect(footerNote(inputs, { kind: "none" }, "")).toBeNull();
  });

  it("says a model provider is used by Domains ingest only when a domain embeds with it", () => {
    const withDomain = sampleInputs({
      directory,
      usage: {
        ...USAGE,
        domains: [
          {
            domain_id: "d1",
            name: "Research",
            embedding_model: "openai/text-embedding-3-small",
            embedding_provider: "openai",
            generation_model: null,
            generation_provider: null,
          },
        ],
      },
    });
    expect(footerNote(withDomain, { kind: "provider", provider: "openai" }, "")).toBe(
      "Used by Domains ingest",
    );
  });

  it("shows what a typed prefix covers once it is valid", () => {
    expect(footerNote(inputs, { kind: "other" }, "mistral")).toBe("Covers mistral/… models");
    expect(footerNote(inputs, { kind: "other" }, "mistral/")).toBeNull();
    expect(footerNote(inputs, { kind: "other" }, "")).toBeNull();
  });
});

describe("save toast", () => {
  it("never celebrates a key no agent uses; says replaced for a replace", () => {
    expect(saveToast(inputs, "nvidia_nim", true)).toBe(
      "nvidia_nim key saved. No agent uses NVIDIA NIM right now.",
    );
    expect(saveToast(inputs, "deepseek", true)).toBe(
      "deepseek key replaced. Writer uses it on its next run.",
    );
    expect(saveToast({ ...inputs, keys: [...KEYS, key("openai", "abcd")] }, "openai", false)).toBe(
      "openai key saved.",
    );
  });
});
