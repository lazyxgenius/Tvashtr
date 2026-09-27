/** The default reading (embedding) model — mirrors backend `domain_embedding`. */
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/** Normalize bare model names to openai/… LiteLLM slugs (FE mirror of backend). */
export function normalizeEmbeddingModel(model: string): string {
  const m = (model || "").trim() || DEFAULT_EMBEDDING_MODEL;
  if (!m.includes("/")) return `openai/${m}`;
  return m;
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

/** Account Tools shelf one-liner — Domains MCP is on node Tools, not the library. */
export function domainsMcpAccountToolsHint(): string {
  return (
    "Domains MCP is enabled on each team node's Tools panel (not here). " +
    "This shelf holds reusable MCP servers you reference from those panels."
  );
}
