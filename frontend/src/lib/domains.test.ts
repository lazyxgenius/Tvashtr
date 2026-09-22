import { describe, expect, it } from "vitest";

import {
  DOMAIN_TEMPLATE_ORDER,
  EMBEDDING_PRESETS,
  GENERATION_PRESETS,
  embeddingSwitchNeedsReingest,
  labelForDomainTemplate,
  normalizeEmbeddingModel,
  providerOfEmbedding,
} from "./domains";

describe("domains helpers", () => {
  it("orders templates financial → legal → scientific → support → blank", () => {
    expect(DOMAIN_TEMPLATE_ORDER).toEqual([
      "financial",
      "legal",
      "scientific",
      "support",
      "blank",
    ]);
  });

  it("labels known templates", () => {
    expect(labelForDomainTemplate("legal")).toBe("Legal");
    expect(labelForDomainTemplate("support")).toBe("Support");
  });
});

describe("embedding presets", () => {
  it("normalizes bare default to openai slug", () => {
    expect(normalizeEmbeddingModel("text-embedding-3-small")).toBe(
      "openai/text-embedding-3-small",
    );
    expect(normalizeEmbeddingModel("")).toBe("openai/text-embedding-3-small");
  });

  it("preserves openrouter slug and derives provider", () => {
    const slug = "openrouter/openai/text-embedding-3-small";
    expect(normalizeEmbeddingModel(slug)).toBe(slug);
    expect(providerOfEmbedding(slug)).toBe("openrouter");
    expect(EMBEDDING_PRESETS.some((p) => p.slug === slug && p.dim === 1536)).toBe(true);
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
  it("is true when dim changes (openai 1536 → groq 768)", () => {
    expect(
      embeddingSwitchNeedsReingest(
        "openai/text-embedding-3-small",
        "groq/nomic-embed-text-v1_5",
      ),
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
      embeddingSwitchNeedsReingest(
        "text-embedding-3-small",
        "openai/text-embedding-3-small",
      ),
    ).toBe(false);
  });
});
