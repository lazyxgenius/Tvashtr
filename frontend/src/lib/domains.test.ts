import { describe, expect, it } from "vitest";

import {
  DOMAIN_TEMPLATE_ORDER,
  EMBEDDING_PRESETS,
  GENERATION_PRESETS,
  domainsAskWhenToUseWhat,
  domainsChatAskHint,
  domainsEvalGoldenSetsHint,
  domainsEvalGraphGuidedHint,
  domainsGraphLiteConfigHint,
  domainsMcpToggleHint,
  domainsQueryNodeHint,
  embeddingSwitchNeedsReingest,
  labelForDomainTemplate,
  normalizeEmbeddingModel,
  providerOfEmbedding,
} from "./domains";

describe("domains helpers", () => {
  it("orders templates financial → legal → scientific → support → blank", () => {
    expect(DOMAIN_TEMPLATE_ORDER).toEqual(["financial", "legal", "scientific", "support", "blank"]);
  });

  it("labels known templates", () => {
    expect(labelForDomainTemplate("legal")).toBe("Legal");
    expect(labelForDomainTemplate("support")).toBe("Support");
  });
});

describe("embedding presets", () => {
  it("normalizes bare default to openai slug", () => {
    expect(normalizeEmbeddingModel("text-embedding-3-small")).toBe("openai/text-embedding-3-small");
    expect(normalizeEmbeddingModel("")).toBe("openai/text-embedding-3-small");
  });

  it("preserves openrouter slug and derives provider", () => {
    const slug = "openrouter/openai/text-embedding-3-small";
    expect(normalizeEmbeddingModel(slug)).toBe(slug);
    expect(providerOfEmbedding(slug)).toBe("openrouter");
    expect(EMBEDDING_PRESETS.some((p) => p.slug === slug && p.dim === 1536)).toBe(true);
  });

  it("includes Hugging Face BGE-small 384 free/rate-limited preset", () => {
    const slug = "huggingface/BAAI/bge-small-en-v1.5";
    expect(normalizeEmbeddingModel(slug)).toBe(slug);
    expect(providerOfEmbedding(slug)).toBe("huggingface");
    const preset = EMBEDDING_PRESETS.find((p) => p.slug === slug);
    expect(preset?.dim).toBe(384);
    expect(preset?.provider).toBe("huggingface");
    expect(preset?.label.toLowerCase()).toMatch(/free|rate/);
  });
});

describe("generation presets", () => {
  it("includes groq gpt-oss-120b plus OpenAI and OpenRouter chat equivalents", () => {
    const slugs = GENERATION_PRESETS.map((p) => p.slug);
    expect(slugs).toContain("groq/openai/gpt-oss-120b");
    expect(slugs).toContain("openai/gpt-4o-mini");
    expect(slugs).toContain("openrouter/openai/gpt-4o-mini");
    expect(slugs).toContain(null); // account default
  });
});

describe("embeddingSwitchNeedsReingest", () => {
  it("is true when dim changes (openai 1536 → gemini 768)", () => {
    expect(
      embeddingSwitchNeedsReingest("openai/text-embedding-3-small", "gemini/gemini-embedding-001"),
    ).toBe(true);
  });

  it("is true when provider changes at same dim (openai → openrouter)", () => {
    expect(
      embeddingSwitchNeedsReingest(
        "openai/text-embedding-3-small",
        "openrouter/openai/text-embedding-3-small",
      ),
    ).toBe(true);
  });

  it("is false when model is unchanged", () => {
    expect(
      embeddingSwitchNeedsReingest("text-embedding-3-small", "openai/text-embedding-3-small"),
    ).toBe(false);
  });
});

describe("domains ask discoverability copy (#5)", () => {
  it("when-to-use-what blurb names Chat/Ask, Query domain, and Domains MCP", () => {
    const copy = domainsAskWhenToUseWhat();
    expect(copy).toMatch(/Chat|Ask/i);
    expect(copy).toMatch(/Query domain/i);
    expect(copy).toMatch(/Domains MCP/i);
    expect(copy).toMatch(/team|agent|canvas|run/i);
  });

  it("Chat/Ask hint: explore/curate interactively; not a team-run step", () => {
    const copy = domainsChatAskHint();
    expect(copy).toMatch(/Chat|Ask/i);
    expect(copy).toMatch(/cit(e|ation)/i);
    expect(copy).toMatch(/Query domain|Domains MCP/i);
  });

  it("Query domain hint: fixed canvas step in a team run", () => {
    const copy = domainsQueryNodeHint();
    expect(copy).toMatch(/Query domain/i);
    expect(copy).toMatch(/canvas|team|run|flow|step/i);
    expect(copy).toMatch(/Chat|Domains MCP/i);
  });

  it("Domains MCP hint: agent-driven ask/retrieve during a run", () => {
    const copy = domainsMcpToggleHint();
    expect(copy).toMatch(/Domains MCP/i);
    expect(copy).toMatch(/agent|thinker|worker|tool/i);
    expect(copy).toMatch(/Chat|Query domain/i);
  });
});

describe("domains eval / graph-lite operator path copy (#7)", () => {
  it("Eval golden-sets hint names Eval scoring and Config graph-lite", () => {
    const copy = domainsEvalGoldenSetsHint();
    expect(copy).toMatch(/golden|Eval/i);
    expect(copy).toMatch(/hit@k|keyword_hit/i);
    expect(copy).toMatch(/graph-lite|Config/i);
  });

  it("Guided-path eval/graph hint points operators to Eval tab + Config toggle", () => {
    const copy = domainsEvalGraphGuidedHint();
    expect(copy).toMatch(/Eval/i);
    expect(copy).toMatch(/golden/i);
    expect(copy).toMatch(/graph-lite|Graph-lite/i);
    expect(copy).toMatch(/Config/i);
  });

  it("Config graph-lite hint: mention expansion + Eval to measure", () => {
    const copy = domainsGraphLiteConfigHint();
    expect(copy).toMatch(/mention|neighbor|chunk/i);
    expect(copy).toMatch(/Eval/i);
  });
});
