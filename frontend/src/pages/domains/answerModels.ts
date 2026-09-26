/**
 * The answer models (DM-63, drawn in DmF-Model-2): what the Ask tab's picker and Settings › Answer
 * model offer. NVIDIA NIM is never offered (it serves no seat); any other model is "Custom…".
 */
export interface AnswerModel {
  /** `null` = the account default. */
  slug: string | null;
  label: string;
  tagline: string;
  /** The provider whose key it needs; `null` for the account default (its resolved model's). */
  provider: string | null;
}

export const ANSWER_MODELS: AnswerModel[] = [
  {
    slug: null,
    label: "Account default",
    tagline: "Your default thinking model",
    provider: null,
  },
  {
    slug: "groq/openai/gpt-oss-120b",
    label: "Groq gpt-oss-120b",
    tagline: "Fast, low cost",
    provider: "groq",
  },
  {
    slug: "openai/gpt-4o-mini",
    label: "OpenAI gpt-4o-mini",
    tagline: "Good default for cited answers",
    provider: "openai",
  },
  {
    slug: "openrouter/openai/gpt-4o-mini",
    label: "OpenRouter gpt-4o-mini",
    tagline: "Billed through OpenRouter",
    provider: "openrouter",
  },
];

/** The label for a stored answer model: a listed model's label, else the typed name itself. */
export function answerModelLabel(slug: string | null): string {
  return ANSWER_MODELS.find((m) => m.slug === (slug || null))?.label ?? String(slug);
}
