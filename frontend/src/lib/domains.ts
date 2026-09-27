/** Embedding presets (mirrors backend domain_embedding.EMBEDDING_PRESETS; multi-dim). */
export interface EmbeddingPreset {
  id: string;
  label: string;
  slug: string;
  provider: string;
  dim: number;
  notes: string;
}

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_SLUG = "openai/text-embedding-3-small";

export const EMBEDDING_PRESETS: EmbeddingPreset[] = [
  {
    id: "openai-3-small",
    label: "OpenAI text-embedding-3-small (default)",
    slug: "openai/text-embedding-3-small",
    provider: "openai",
    dim: 1536,
    notes: "Requires Engines key for provider openai.",
  },
  {
    id: "openai-ada-002",
    label: "OpenAI text-embedding-ada-002",
    slug: "openai/text-embedding-ada-002",
    provider: "openai",
    dim: 1536,
    notes: "Legacy 1536; requires Engines key for provider openai.",
  },
  {
    id: "openrouter-3-small",
    label: "OpenRouter → text-embedding-3-small",
    slug: "openrouter/openai/text-embedding-3-small",
    provider: "openrouter",
    dim: 1536,
    notes:
      "Cheapest 1536 path without an OpenAI Engines key. Add an OpenRouter key under Engines. Still OpenAI upstream via OpenRouter billing — not covered by SuperGrok/subscription.",
  },
  {
    id: "gemini-embedding-001",
    label: "Gemini gemini-embedding-001 (768)",
    slug: "gemini/gemini-embedding-001",
    provider: "gemini",
    dim: 768,
    notes:
      "Google AI Studio embed (output_dimensionality=768). Add a gemini Engines key. text-embedding-004 is shut down. Switching dims clears ready embeddings and forces re-ingest.",
  },
  {
    id: "hf-bge-small-en-v1.5",
    label: "Hugging Face BGE-small-en-v1.5 (384, free/rate-limited)",
    slug: "huggingface/BAAI/bge-small-en-v1.5",
    provider: "huggingface",
    dim: 384,
    notes:
      "Free HF Inference feature-extraction embed (BAAI/bge-small-en-v1.5, native 384-dim). Add a free huggingface token under Engines (Inference Providers permission). Rate limits and cold starts apply; for testing. Prefer Gemini or OpenRouter for steadier throughput.",
  },
];

/** Normalize bare model names to openai/… LiteLLM slugs (FE mirror of backend). */
export function normalizeEmbeddingModel(model: string): string {
  const m = (model || "").trim() || DEFAULT_EMBEDDING_MODEL;
  if (!m.includes("/")) return `openai/${m}`;
  return m;
}

export function providerOfEmbedding(model: string): string {
  return normalizeEmbeddingModel(model).split("/")[0]?.toLowerCase() || "openai";
}

/**
 * Two embed slugs name the same weights when they differ only by the OpenRouter route (OQ-17):
 * switching between them keeps the vectors; any other switch re-reads every file. Mirrors backend
 * `domain_embedding.same_embedding_weights`. "text-embedding-3-small" ≡
 * "openrouter/openai/text-embedding-3-small".
 */
export function sameEmbeddingWeights(a: string, b: string): boolean {
  const weights = (s: string) =>
    normalizeEmbeddingModel(normalizeEmbeddingModel(s).replace(/^openrouter\//i, "")).toLowerCase();
  return weights(a) === weights(b);
}

/**
 * E2E gap #5 — Chat/Ask vs Query domain vs Domains MCP discoverability.
 * Short copy for Guided path / Overview / Domains Chat / ToolsSection / Query node drawer / Tools shelf.
 */

/** Canvas Query domain node drawer hint. */
export function domainsQueryNodeHint(): string {
  return (
    "Query domain is a fixed canvas step: one cited ask in the team flow (answer + citations on the run log). " +
    "Use Domains Chat/Ask to explore interactively; enable Domains MCP when an agent should decide when to query."
  );
}

/** ToolsSection Domains MCP toggle hint. */
export function domainsMcpToggleHint(): string {
  return (
    "Domains MCP lets this agent call domain ask/retrieve as tools during a run. " +
    "Prefer Chat/Ask to explore yourself, or a Query domain node for a fixed canvas step."
  );
}

/** Account Tools shelf one-liner — Domains MCP is on node Tools, not the library. */
export function domainsMcpAccountToolsHint(): string {
  return (
    "Domains MCP is enabled on each team node's Tools panel (not here). " +
    "This shelf holds reusable MCP servers you reference from those panels."
  );
}
