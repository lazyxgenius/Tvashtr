/**
 * The drawer header's three badges (PANEL-13/14/15): how the last run went, whether the agent can
 * edit files, and which model it runs. Pure, so the drawer, the focus view and the run view agree.
 */
import type { BadgeVariant } from "../design-system/components";
import { getProviderCatalogue, type TeamGraphNode } from "../lib/api";
import { titleCase } from "../lib/text";
import { formatRelativeTime } from "../lib/time";

export interface StatusBadge {
  label: string;
  variant: BadgeVariant;
  dot: boolean;
  /** False when there is no run to jump to. */
  hasRun: boolean;
}

// Outcomes that mean "this agent did its job" (spec, build, report) read "Done".
const DONE_OUTCOMES = new Set(["prd_written", "built", "reported", "answered"]);

/** What a badge needs from a run or a round (`last_run`, a history round, a run invocation). */
export interface RunLike {
  outcome: string | null;
  status?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
}

/**
 * "Changes requested · 31m ago", "Done · 31m ago", "Failed", "Not run yet". `withTime: false`
 * drops the time (a Runs-tab round shows its time on its own).
 */
export function statusBadge(
  lastRun: TeamGraphNode["last_run"] | RunLike | null | undefined,
  withTime = true,
): StatusBadge {
  if (!lastRun) return { label: "Not run yet", variant: "neutral", dot: true, hasRun: false };
  const run: RunLike = lastRun;
  const when = withTime ? formatRelativeTime(run.ended_at ?? run.started_at ?? "") : "";
  const labelled = (label: string) => (when ? `${label} · ${when}` : label);
  if (run.status === "running")
    return { label: "Running", variant: "info", dot: true, hasRun: true };
  if (run.status === "failed" || (run.status !== "stopped" && run.outcome === "failed")) {
    return { label: labelled("Failed"), variant: "danger", dot: true, hasRun: true };
  }
  if (run.status === "stopped") {
    return { label: labelled("Stopped"), variant: "neutral", dot: true, hasRun: true };
  }
  const outcome = run.outcome ?? "";
  if (outcome === "changes_requested") {
    return { label: labelled("Changes requested"), variant: "accent", dot: true, hasRun: true };
  }
  if (outcome === "approved") {
    return { label: labelled("Approved"), variant: "success", dot: true, hasRun: true };
  }
  if (DONE_OUTCOMES.has(outcome) || !outcome) {
    return { label: labelled("Done"), variant: "success", dot: true, hasRun: true };
  }
  return {
    label: labelled(titleCase(outcome.replace(/_/g, " "))),
    variant: "neutral",
    dot: true,
    hasRun: true,
  };
}

/** A friendly model name: the catalogue's label ("Grok 4.7"), else the slug without its provider. */
export function modelLabel(model: string): string {
  const slug = model.trim();
  if (!slug) return "";
  for (const entry of getProviderCatalogue()) {
    const label = entry.model_labels?.[slug];
    if (label) return label;
  }
  const i = slug.indexOf("/");
  return i >= 0 ? slug.slice(i + 1) : slug;
}

/** The slug's model id without its provider ("xai/grok-4.7" → "grok-4.7"). */
export function modelId(model: string): string {
  const slug = model.trim();
  const i = slug.indexOf("/");
  return i >= 0 ? slug.slice(i + 1) : slug;
}

/** The provider's display name from the catalogue ("xAI"), else the slug's provider segment. */
export function providerLabel(provider: string): string {
  const entry = getProviderCatalogue().find((e) => e.provider === provider);
  return entry?.label || provider;
}
