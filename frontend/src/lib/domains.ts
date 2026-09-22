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

/**
 * E2E gap #5 — Chat/Ask vs Query domain vs Domains MCP discoverability.
 * Short copy for Guided path / Overview / Domains Chat / ToolsSection / Query node drawer / Tools shelf.
 */

/** Guided path “When to use what” blurb — three access paths, one sentence each. */
export function domainsAskWhenToUseWhat(): string {
  return (
    "When to use what: Chat/Ask on this domain for interactive cited Q&A while you explore. " +
    "Canvas Query domain for a fixed ask step inside a team run. " +
    "Domains MCP on a thinker/worker Tools panel so the agent can ask/retrieve on demand during a run."
  );
}

/** Domains detail → Chat empty / lede hint. */
export function domainsChatAskHint(): string {
  return (
    "Chat/Ask is for you — interactive questions with citations while curating this domain. " +
    "For a fixed step in a team run use Canvas Query domain; for agent-driven tools enable Domains MCP."
  );
}

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

/**
 * E2E gap #7 — Eval golden sets + graph-lite operator path polish.
 * Short copy for Guided path / Eval tab / Config graph toggle — no new architecture.
 */

/** Eval tab lede — golden sets scoring + where graph-lite lives. */
export function domainsEvalGoldenSetsHint(): string {
  return (
    "Eval holds golden Q&A cases scored with deterministic hit@k and keyword_hit via retrieve " +
    "(no LLM judge; cap 50). Optional graph-lite mention expansion is on the Config tab — " +
    "toggle it, then re-run Eval to compare scores."
  );
}

/** Guided path step hint — Eval tab + Config graph-lite location. */
export function domainsEvalGraphGuidedHint(): string {
  return (
    "After ingest: Eval tab — add golden questions and Run eval. " +
    "Optional Graph-lite mention expansion is on Config (checkbox under retrieval) — " +
    "same retrieve path Chat / Query domain / Domains MCP use."
  );
}

/** Config tab graph-lite field hint — expansion behavior + Eval to measure. */
export function domainsGraphLiteConfigHint(): string {
  return (
    "When enabled, retrieve may append up to 4 neighbor chunks that share capitalized " +
    "mentions with the top hits. No Neo4j / no entity ingest. Default off. " +
    "Use the Eval tab golden sets to measure whether expansion helps."
  );
}
