export type DomainTemplateKey =
  | "financial"
  | "legal"
  | "scientific"
  | "support"
  | "blank";

export const DOMAIN_TEMPLATE_ORDER: DomainTemplateKey[] = [
  "financial",
  "legal",
  "scientific",
  "support",
  "blank",
];

const LABELS: Record<DomainTemplateKey, string> = {
  financial: "Financial",
  legal: "Legal",
  scientific: "Scientific",
  support: "Support",
  blank: "Blank",
};

export function labelForDomainTemplate(template: string): string {
  return (LABELS as Record<string, string>)[template] ?? template;
}

export type RetrievalMode = "dense" | "lexical" | "hybrid";

export interface DomainRerankConfig {
  enabled: boolean;
  model: string | null;
  top_n: number;
}

export interface DomainGraphConfig {
  enabled: boolean;
}


/** 1536-dim embedding presets (mirrors backend domain_embedding.EMBEDDING_PRESETS). */
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

/** Phase 1 v1 config shape (matches backend defaults). */
export interface DomainConfig {
  chunking: { strategy: string; size: number; overlap: number };
  embedding: { model: string };
  retrieval: {
    top_k: number;
    mode: RetrievalMode | string;
    rerank?: DomainRerankConfig;
    graph?: DomainGraphConfig;
  };
  generation: { model: string | null };
}

export function parseDomainConfig(raw: unknown): DomainConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as DomainConfig;
  if (!c.chunking || !c.embedding || !c.retrieval || !c.generation) return null;
  return c;
}
