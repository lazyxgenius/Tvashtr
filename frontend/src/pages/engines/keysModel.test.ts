import { describe, expect, it } from "vitest";

import type { UsageDomain } from "../../lib/api/engines";
import { KEYS, USAGE, key, node, sampleInputs, sub } from "./enginesTestUtils";
import {
  EMBEDDINGS_SUGGESTION,
  addedLabel,
  embeddingsSection,
  inFlightLine,
  joinAnd,
  keyRows,
  keyUsage,
  removeCopy,
  replaceCopy,
  suggestedKeys,
} from "./keysModel";

const NOW = new Date("2026-09-26T12:00:00+00:00");

const domain = (id: string, name: string, embedding: string | null): UsageDomain => ({
  domain_id: id,
  name,
  embedding_model: embedding,
  embedding_provider: embedding ? embedding.split("/")[0] : null,
  generation_model: null,
  generation_provider: null,
});

describe("joinAnd", () => {
  it("joins one, two and three names", () => {
    expect(joinAnd(["a"])).toBe("a");
    expect(joinAnd(["a", "b"])).toBe("a and b");
    expect(joinAnd(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("addedLabel (ENG-53)", () => {
  it("reads Just now under a minute, else a short date", () => {
    expect(addedLabel("2026-09-26T11:59:30+00:00", NOW)).toBe("Just now");
    expect(addedLabel("2026-09-12T12:00:00+00:00", NOW)).toBe("Sep 12");
    expect(addedLabel("2025-12-01T12:00:00+00:00", NOW)).toBe("Dec 1, 2025");
    expect(addedLabel("not a date", NOW)).toBe("");
  });
});

describe("keyRows (ENG-53)", () => {
  it("lists the keys newest first with who uses each, and the NVIDIA NIM note", () => {
    const rows = keyRows(sampleInputs(), NOW);
    expect(rows.map((r) => r.provider)).toEqual(["deepseek", "nvidia_nim", "openrouter"]);
    expect(rows[0]).toMatchObject({
      monogram: "D",
      last4: "7d24",
      usedBy: "Writer · Docs team",
      unused: false,
      added: "Sep 12",
    });
    expect(rows[1].usedBy).toBe("No agent uses NVIDIA NIM right now.");
    expect(rows[2]).toMatchObject({ usedBy: "Not used by any team", unused: true });
  });

  it("puts a just-saved key on top and dates a replaced key by its new save", () => {
    const replaced = {
      ...key("openrouter", "Qm81", "2026-08-28"),
      updated_at: "2026-09-26T11:59:50+00:00",
    };
    const rows = keyRows(
      sampleInputs({ keys: [replaced, ...KEYS.filter((k) => k.provider !== "openrouter")] }),
      NOW,
    );
    expect(rows[0]).toMatchObject({
      provider: "openrouter",
      last4: "Qm81",
      added: "Just now",
      addedTitle: "Added Aug 28",
    });
  });

  it("lists fallbacks and Domains, and cuts off past two uses", () => {
    const usage = {
      ...USAGE,
      teams: [
        ...USAGE.teams,
        {
          team_id: "t-3",
          name: "Third team",
          nodes: [node("n-x", "engineer", "xai/grok-4.7", null, "openrouter/openai/gpt-4o-mini")],
        },
      ],
      domains: [domain("d-1", "Research", "openrouter/openai/text-embedding-3-small")],
    };
    const rows = keyRows(sampleInputs({ usage }), NOW);
    const openrouter = rows.find((r) => r.provider === "openrouter")!;
    expect(openrouter.usedBy).toBe("Engineer (fallback) · Third team; Domains ingest");
    const heavy = {
      ...usage,
      teams: usage.teams.map((t) => ({
        ...t,
        nodes: [...t.nodes, node(`${t.team_id}-d`, "reviewer", "deepseek/deepseek-chat")],
      })),
    };
    const deepseek = keyRows(sampleInputs({ usage: heavy }), NOW)[0];
    expect(deepseek.usedBy).toBe(
      "Reviewer · Indicator sprint team; Writer, Reviewer · Docs team +1 more",
    );
    expect(deepseek.usedByFull).toContain("Reviewer · Third team");
  });
});

describe("suggestedKeys (ENG-52)", () => {
  it("names the providers the teams use with no key, never a no-seat one", () => {
    expect(suggestedKeys(sampleInputs())).toEqual(["anthropic", "xai"]);
    expect(suggestedKeys(sampleInputs({ keys: [...KEYS, key("anthropic", "wQ3f")] }))).toEqual([
      "xai",
    ]);
    const nim = {
      ...USAGE,
      teams: [{ team_id: "t", name: "T", nodes: [node("n", "engineer", "nvidia_nim/x")] }],
    };
    expect(suggestedKeys(sampleInputs({ usage: nim, keys: [] }))).toEqual([]);
  });
});

describe("embeddingsSection (ENG-59, OQ-7)", () => {
  it("suggests Hugging Face while no domain exists", () => {
    expect(embeddingsSection(sampleInputs())).toEqual({
      mode: "suggest",
      description: EMBEDDINGS_SUGGESTION,
      items: [{ provider: "huggingface", last4: null }],
    });
    const withGemini = embeddingsSection(sampleInputs({ keys: [...KEYS, key("gemini", "g3m1")] }));
    expect(withGemini.items).toEqual([{ provider: "gemini", last4: "g3m1" }]);
  });

  it("follows the providers the user's domains embed with", () => {
    const usage = {
      ...USAGE,
      domains: [
        domain("d-1", "Research", "openai/text-embedding-3-small"),
        domain("d-2", "Notes", "huggingface/BAAI/bge-small-en-v1.5"),
        domain("d-3", "Docs", "openai/text-embedding-3-small"),
      ],
    };
    const missing = embeddingsSection(sampleInputs({ usage }));
    expect(missing.mode).toBe("domains");
    expect(missing.items).toEqual([
      { provider: "openai", last4: null },
      { provider: "huggingface", last4: null },
    ]);
    expect(missing.description).toBe(
      "Your domains embed documents with OpenAI and Hugging Face. Add the missing keys to ingest documents.",
    );
    const ready = embeddingsSection(
      sampleInputs({ usage, keys: [key("openai", "0p3n"), key("huggingface", "f0Tk")] }),
    );
    expect(ready.description).toBe(
      "Your domains embed documents with OpenAI and Hugging Face. Their keys are saved, so Domains can ingest documents.",
    );
  });
});

describe("keyUsage (ENG-55, OQ-13)", () => {
  it("lists each agent with its team and model, and the footer", () => {
    expect(keyUsage(sampleInputs(), "deepseek")).toEqual({
      heading: "deepseek is used by",
      rows: [
        {
          kind: "node",
          title: "Writer",
          detail: "Docs team · deepseek/deepseek-chat",
          role: "writer",
          teamId: "t-docs",
          nodeId: "n-writer",
        },
      ],
      empty: "No team uses deepseek yet.",
      footer: "Works for website runs and Desktop runs.",
    });
  });

  it("adds fallback and Domains rows; a no-seat provider gets the plain note", () => {
    const usage = {
      ...USAGE,
      teams: [
        {
          team_id: "t",
          name: "T",
          nodes: [node("n", "engineer", "xai/grok-4.7", null, "openrouter/m")],
        },
      ],
      domains: [domain("d", "Research", "openrouter/openai/text-embedding-3-small")],
    };
    const rows = keyUsage(sampleInputs({ usage }), "openrouter").rows;
    expect(rows.map((r) => [r.kind, r.title, r.detail])).toEqual([
      ["fallback", "Engineer (fallback)", "T · openrouter/m"],
      ["domain", "Research", "embeddings (openrouter/openai/text-embedding-3-small)"],
    ]);
    const nim = keyUsage(sampleInputs(), "nvidia_nim");
    expect(nim.rows).toEqual([]);
    expect(nim.empty).toBe("No agent uses NVIDIA NIM right now.");
    expect(nim.footer).toBeNull();
    expect(keyUsage(sampleInputs(), "openrouter").empty).toBe("No team uses openrouter yet.");
  });
});

describe("replaceCopy (ENG-56)", () => {
  it("names the one agent that uses the key", () => {
    expect(replaceCopy(sampleInputs(), "deepseek")).toEqual({
      title: "Replace the deepseek key",
      body: "The old key is deleted when you save. Writer uses the new one on its next run.",
      toast: "deepseek key replaced. Writer uses it on its next run.",
    });
  });

  it("stays general for several agents or none, and plain for a no-seat provider", () => {
    const withXai = sampleInputs({ keys: [...KEYS, key("xai", "x41x")] });
    expect(replaceCopy(withXai, "xai")).toMatchObject({
      body: "The old key is deleted when you save. Agents use the new one on their next run.",
      toast: "xai key replaced.",
    });
    expect(replaceCopy(sampleInputs(), "nvidia_nim").body).toBe(
      "The old key is deleted when you save. No agent uses NVIDIA NIM right now.",
    );
  });
});

describe("removeCopy (ENG-57, OQ-13)", () => {
  it("states the impact (the design's words)", () => {
    expect(removeCopy(sampleInputs(), "deepseek")).toEqual({
      title: "Remove the deepseek key?",
      body: "Writer in Docs team uses deepseek. Docs team can’t run on the website, or on Desktop, until you add a key again. You can’t undo this.",
      teamIds: ["t-docs"],
      toast: "deepseek key removed.",
    });
  });

  it("keeps Desktop running on a connected subscription", () => {
    const i = sampleInputs({ keys: [...KEYS, key("anthropic", "wQ3f")] });
    expect(removeCopy(i, "anthropic").body).toBe(
      "Engineer in Indicator sprint team uses anthropic. Indicator sprint team can’t run on the website until you add a key again. On Desktop it still runs on your Claude subscription. You can’t undo this.",
    );
    const noClaude = { ...i, subs: [sub("claude", "disconnected"), ...i.subs.slice(1)] };
    expect(removeCopy(noClaude, "anthropic").body).toContain(
      "can’t run on the website, or on Desktop, until",
    );
  });

  it("covers several roles, fallbacks, Domains, no users and a no-seat provider", () => {
    const withXai = sampleInputs({ keys: [...KEYS, key("xai", "x41x")] });
    expect(removeCopy(withXai, "xai").body).toMatch(
      /^Product manager and Reviewer in Indicator sprint team use xai\./,
    );
    const usage = {
      ...USAGE,
      teams: [
        {
          team_id: "t",
          name: "T",
          nodes: [node("n", "engineer", "xai/grok-4.7", null, "openrouter/m")],
        },
      ],
      domains: [domain("d", "Research", "openrouter/openai/text-embedding-3-small")],
    };
    expect(removeCopy(sampleInputs({ usage }), "openrouter").body).toBe(
      "openrouter is the fallback for Engineer in T. Research embeds documents with openrouter and can’t ingest until you add a key again. You can’t undo this.",
    );
    expect(removeCopy(sampleInputs(), "openrouter").body).toBe(
      "No team uses openrouter. You can’t undo this.",
    );
    expect(removeCopy(sampleInputs(), "nvidia_nim").body).toBe(
      "No agent uses NVIDIA NIM right now. You can’t undo this.",
    );
  });
});

describe("inFlightLine (OQ-21)", () => {
  it("warns about runs in progress", () => {
    expect(inFlightLine(sampleInputs(), "deepseek", [])).toBeNull();
    expect(inFlightLine(sampleInputs(), "deepseek", ["Docs team"])).toBe(
      "A run of Docs team is in progress and will fail at its next deepseek step.",
    );
    expect(inFlightLine(sampleInputs(), "deepseek", ["A", "B"])).toBe(
      "Runs of A and B are in progress and will fail at their next deepseek step.",
    );
    expect(inFlightLine(sampleInputs(), "anthropic", ["Indicator sprint team"])).toBe(
      "A run of Indicator sprint team is in progress. On the website it will fail at its next anthropic step.",
    );
  });
});
