/** Pure helpers for the Models pages: money, times, labels, the Run dialog's rows and lines. */
import type { ProviderCatalogueEntry } from "../../lib/api";
import type {
  ModelCard,
  ModelEstimate,
  ModelRun,
  Scoring,
  ScoringSummary,
} from "../../lib/api/models";

/** Two decimals; below a cent, `<$0.01`. */
export function money(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function aboutMoney(usd: number): string {
  return `about ${money(usd)}`;
}

/** "just now", "5 min ago", "2 h ago", "3 d ago". */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export const SCORING_LABEL: Record<Scoring, string> = {
  exact: "Exact match",
  contains: "Must contain",
  judge: "AI judge",
};

/** The hint under How to score. */
export function scoringHint(scoring: Scoring, choiceModel: boolean): string {
  if (choiceModel) return "Pick-from-a-list tests are scored by exact match.";
  if (scoring === "exact") {
    return "The answer must match the expected answer. Case, spaces and a final full stop don't matter.";
  }
  if (scoring === "contains") {
    return "The answer passes if it contains every word or phrase below.";
  }
  return "An AI judge reads the answer against your rubric and says pass or fail, with a reason.";
}

export function kindChip(m: Pick<ModelCard, "answer_kind" | "choices">): string {
  return m.answer_kind === "choice"
    ? `Pick from a list · ${m.choices.length} choices`
    : "Write text";
}

/** The model's name in a slug: its last segment. */
export function modelName(slug: string): string {
  return slug.split("/").pop() ?? slug;
}

/** A short name for the Last run header: `claude-sonnet-5-5` reads `sonnet-5-5`. */
export function shortModel(slug: string): string {
  return modelName(slug).replace(/^claude-/, "");
}

/** The cost a card shows for a run. */
export function runCost(run: ModelRun): string {
  if (!run.price_known) return "cost not listed";
  return run.status === "completed"
    ? `${money(run.total_usd)} for all ${run.cases_total}`
    : `${money(run.total_usd)} so far`;
}

export function runSpeed(run: ModelRun): string | null {
  if (run.avg_latency_ms === null) return null;
  return `${(run.avg_latency_ms / 1000).toFixed(1)} s per answer`;
}

export function percent(passed: number, total: number): number {
  return total > 0 ? Math.round((100 * passed) / total) : 0;
}

// ---- The Run tests dialog ----

export interface ModelRow {
  slug: string;
  provider: string;
  providerLabel: string;
  name: string;
  held: boolean;
}

function providerOf(slug: string): string {
  return slug.split("/")[0].trim().toLowerCase();
}

export function labelOf(provider: string, catalogue: ProviderCatalogueEntry[]): string {
  const found = catalogue.find((p) => p.provider === provider)?.label;
  return found ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

export function rowFor(
  slug: string,
  catalogue: ProviderCatalogueEntry[],
  held: readonly string[],
): ModelRow {
  const provider = providerOf(slug);
  return {
    slug,
    provider,
    providerLabel: labelOf(provider, catalogue),
    name: modelName(slug),
    held: held.includes(provider),
  };
}

/** Every catalogued provider's thinker presets: the held providers' first; for each provider with
 *  no key, its default alone (disabled, with Add a key). Never NVIDIA NIM, whose catalogued slugs
 *  are retired. `extra` slugs (custom models, the last run's) come after the held ones. */
export function modelRows(
  catalogue: ProviderCatalogueEntry[],
  held: readonly string[],
  extra: readonly string[] = [],
): ModelRow[] {
  const providers = catalogue.filter((p) => p.provider !== "nvidia_nim");
  const heldSlugs = providers
    .filter((p) => held.includes(p.provider))
    .flatMap((p) => p.thinker_presets);
  const missing = providers
    .filter((p) => !held.includes(p.provider) && p.thinker_default)
    .map((p) => p.thinker_default as string);
  const extras = extra.filter((s) => !heldSlugs.includes(s) && !missing.includes(s));
  const heldExtras = extras.filter((s) => held.includes(providerOf(s)));
  const otherExtras = extras.filter((s) => !held.includes(providerOf(s)));
  return [...heldSlugs, ...heldExtras, ...otherExtras, ...missing].map((s) =>
    rowFor(s, catalogue, held),
  );
}

export function estimateTotal(rows: ModelEstimate[], checked: readonly string[]): number {
  return rows
    .filter((r) => checked.includes(r.model) && r.estimate_usd !== null)
    .reduce((sum, r) => sum + (r.estimate_usd ?? 0), 0);
}

/** "2 models × 50 tests, paid on your own keys. These tests use exact match, so no judge…" */
export function estimateLine(models: number, tests: number, summary: ScoringSummary): string {
  const head = `${plural(models, "model")} × ${plural(tests, "test")}, paid on your own keys.`;
  return `${head} ${judgeLine(summary)}`;
}

export function judgeLine(s: ScoringSummary): string {
  if (s.judge_tests > 0) {
    const judges = s.judges.map(modelName).join(", ");
    return `These tests include ${plural(s.judge_tests, "AI-judge test")}, judged by ${judges} on your key. The judge's cost is included.`;
  }
  const how =
    s.uses_exact && s.uses_contains
      ? "exact match and key words"
      : s.uses_contains
        ? "key words"
        : "exact match";
  return `These tests use ${how}, so no judge model is needed.`;
}

export function unlistedLine(model: string): string {
  return `No listed price for ${modelName(model)}: its cost shows after the run if the provider reports it.`;
}

export function runButtonLabel(tests: number, models: number): string {
  return `Run ${plural(tests, "test")} on ${plural(models, "model")}`;
}

/** The default pair to compare: the best run against the lowest-cost one, else the next finished. */
export function defaultPair(
  finished: ModelRun[],
  best: string | null,
  lowest: string | null,
): [string, string] | null {
  if (finished.length < 2) return null;
  const a = best ?? finished[0].run_id;
  const b = lowest && lowest !== a ? lowest : (finished.find((r) => r.run_id !== a)?.run_id ?? a);
  return [a, b];
}

/** A run's option in Compare: `model-name · 46 / 50`. */
export function compareOption(run: ModelRun): string {
  return `${run.model_name} · ${run.passed} / ${run.cases_total}`;
}
