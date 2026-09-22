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
    id: "groq-nomic-v1_5",
    label: "Groq nomic-embed-text-v1.5 (768)",
    slug: "groq/nomic-embed-text-v1_5",
    provider: "groq",
    dim: 768,
    notes:
      "Native 768-dim via Groq. Add a groq API key under Engines. Switching to/from a 1536 model clears ready embeddings and forces re-ingest.",
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


export function dimOfEmbedding(model: string): number {
  const slug = normalizeEmbeddingModel(model);
  const preset = EMBEDDING_PRESETS.find((p) => p.slug === slug);
  return preset?.dim ?? 1536;
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

/** Generation chat presets (Domain Config Ask model; mirrors Engines catalogue defaults). */
export interface GenerationPreset {
  id: string;
  label: string;
  /** null = leave unset; ask_domain falls back to account thinker default. */
  slug: string | null;
  provider: string | null;
  notes: string;
}

export const GENERATION_PRESETS: GenerationPreset[] = [
  {
    id: "account-default",
    label: "Account default",
    slug: null,
    provider: null,
    notes: "Uses the account thinker default / settings when Ask runs.",
  },
  {
    id: "groq-gpt-oss-120b",
    label: "Groq gpt-oss-120b",
    slug: "groq/openai/gpt-oss-120b",
    provider: "groq",
    notes: "Requires a groq Engines key.",
  },
  {
    id: "openai-gpt-4o-mini",
    label: "OpenAI gpt-4o-mini",
    slug: "openai/gpt-4o-mini",
    provider: "openai",
    notes: "Requires an openai Engines key.",
  },
  {
    id: "openrouter-gpt-4o-mini",
    label: "OpenRouter → gpt-4o-mini",
    slug: "openrouter/openai/gpt-4o-mini",
    provider: "openrouter",
    notes: "Requires an openrouter Engines key.",
  },
];

const CUSTOM_GENERATION = "__custom__";

/** Select value for the generation preset picker (null slug → empty string). */
export function generationPresetSelectValue(model: string | null): string {
  if (model == null || model === "") return "";
  if (GENERATION_PRESETS.some((p) => p.slug === model)) return model;
  return CUSTOM_GENERATION;
}

export function isCustomGenerationSelect(value: string): boolean {
  return value === CUSTOM_GENERATION;
}

/**
 * True when saving the new embed slug would clear ready embeddings / force re-ingest
 * (provider or dim differs from the currently saved model).
 */
export function embeddingSwitchNeedsReingest(fromModel: string, toModel: string): boolean {
  return (
    dimOfEmbedding(fromModel) !== dimOfEmbedding(toModel) ||
    providerOfEmbedding(fromModel) !== providerOfEmbedding(toModel)
  );
}
