/**
 * The reading models (embedding models) a domain can use, with the design's labels and taglines
 * (DM-82, the Reading model listbox in DmF-Embed-1) and the key-state words every picker and
 * callout shares. Mirrors backend `domain_views.READING_MODEL_LABELS` and `EMBEDDING_PRESETS`.
 * NVIDIA NIM is never a reading model.
 */
import { normalizeEmbeddingModel } from "../../lib/domains";

export interface ReadingModel {
  slug: string;
  label: string;
  provider: string;
  dim: number;
  /** The listbox's second line after the dimension ("1536 · default"). */
  tagline: string;
}

export const READING_MODELS: ReadingModel[] = [
  {
    slug: "openai/text-embedding-3-small",
    label: "OpenAI text-embedding-3-small",
    provider: "openai",
    dim: 1536,
    tagline: "default",
  },
  {
    slug: "openai/text-embedding-ada-002",
    label: "OpenAI text-embedding-ada-002",
    provider: "openai",
    dim: 1536,
    tagline: "older",
  },
  {
    slug: "openrouter/openai/text-embedding-3-small",
    label: "OpenRouter text-embedding-3-small",
    provider: "openrouter",
    dim: 1536,
    tagline: "billed via OpenRouter",
  },
  {
    slug: "gemini/gemini-embedding-001",
    label: "Gemini embedding-001",
    provider: "gemini",
    dim: 768,
    tagline: "Google AI Studio",
  },
  {
    slug: "huggingface/BAAI/bge-small-en-v1.5",
    label: "Hugging Face BGE-small (free)",
    provider: "huggingface",
    dim: 384,
    tagline: "rate-limited, for testing",
  },
];

export const DEFAULT_READING_MODEL = "openai/text-embedding-3-small";
/** "Use the free Hugging Face model" (DM-26). It still needs a free token (OQ-9). */
export const FREE_READING_MODEL = "huggingface/BAAI/bge-small-en-v1.5";

/** The model for a stored slug (bare OpenAI names gain `openai/`); unknown slugs keep their name. */
export function readingModel(slug: string): ReadingModel {
  const norm = normalizeEmbeddingModel(slug);
  const hit = READING_MODELS.find((m) => m.slug === norm);
  if (hit) return hit;
  const provider = norm.split("/")[0]?.toLowerCase() || "openai";
  return { slug: norm, label: norm, provider, dim: 0, tagline: "" };
}

/**
 * Two slugs name the same weights when they differ only by the OpenRouter route (OQ-17): switching
 * between them needs no re-read. "text-embedding-3-small" ≡ "openrouter/openai/text-embedding-3-small".
 */
export function sameReadingWeights(a: string, b: string): boolean {
  const weights = (s: string) =>
    normalizeEmbeddingModel(normalizeEmbeddingModel(s).replace(/^openrouter\//i, "")).toLowerCase();
  return weights(a) === weights(b);
}

/** Hugging Face calls its key a token. */
export function keyWord(provider: string): "key" | "token" {
  return provider === "huggingface" ? "token" : "key";
}

/** The ✓ tag when the account holds the provider's key: "key saved" / "token saved". */
export function keySavedText(provider: string): string {
  return `${keyWord(provider)} saved`;
}

/** The amber tag when it doesn't: "No openai key" / "No huggingface token". */
export function missingKeyText(provider: string): string {
  return `No ${provider} ${keyWord(provider)}`;
}

/** "Add openai key" / "Add huggingface token". */
export function addKeyLabel(provider: string): string {
  return `Add ${provider} ${keyWord(provider)}`;
}

/** The toast after the key sheet saves (DmF-NoKey-3: "openai key saved"). */
export function keySavedToast(provider: string): string {
  return `${provider} ${keyWord(provider)} saved`;
}

/** The example model per provider for the key sheet's hint ("like openai/text-embedding-3-small"). */
export function readingExamples(current: ReadingModel): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of READING_MODELS) if (!out[m.provider]) out[m.provider] = m.slug;
  out[current.provider] = current.slug;
  return out;
}
