import { describe, expect, it } from "vitest";

import {
  DOMAIN_TEMPLATE_ORDER,
  EMBEDDING_PRESETS,
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
