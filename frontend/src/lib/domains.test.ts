import { describe, expect, it } from "vitest";

import {
  domainsMcpAccountToolsHint,
  sameEmbeddingWeights,
  normalizeEmbeddingModel,
} from "./domains";

describe("normalizeEmbeddingModel", () => {
  it("normalizes bare default to openai slug", () => {
    expect(normalizeEmbeddingModel("text-embedding-3-small")).toBe("openai/text-embedding-3-small");
    expect(normalizeEmbeddingModel("")).toBe("openai/text-embedding-3-small");
  });
});

describe("sameEmbeddingWeights (OQ-17)", () => {
  it("re-reads when the dimension changes (openai 1536 → gemini 768)", () => {
    expect(
      sameEmbeddingWeights("openai/text-embedding-3-small", "gemini/gemini-embedding-001"),
    ).toBe(false);
  });

  it("re-reads when the weights change at the same dimension (3-small → ada-002)", () => {
    expect(
      sameEmbeddingWeights("openai/text-embedding-3-small", "openai/text-embedding-ada-002"),
    ).toBe(false);
  });

  it("keeps the vectors for the same weights through OpenRouter", () => {
    expect(
      sameEmbeddingWeights(
        "openai/text-embedding-3-small",
        "openrouter/openai/text-embedding-3-small",
      ),
    ).toBe(true);
  });

  it("keeps them when the model is unchanged", () => {
    expect(sameEmbeddingWeights("text-embedding-3-small", "openai/text-embedding-3-small")).toBe(
      true,
    );
  });
});

describe("domains ask discoverability copy (#5)", () => {
  it("account Tools shelf hint points to node Tools for Domains MCP", () => {
    const copy = domainsMcpAccountToolsHint();
    expect(copy).toMatch(/Domains MCP/i);
    expect(copy).toMatch(/node|Tools panel|team/i);
    expect(copy).toMatch(/not here|library/i);
  });
});
