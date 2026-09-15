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

/** Phase 1 v1 config shape (matches backend defaults). */
export interface DomainConfig {
  chunking: { strategy: string; size: number; overlap: number };
  embedding: { model: string };
  retrieval: { top_k: number; mode: string };
  generation: { model: string | null };
}

export function parseDomainConfig(raw: unknown): DomainConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as DomainConfig;
  if (!c.chunking || !c.embedding || !c.retrieval || !c.generation) return null;
  return c;
}
