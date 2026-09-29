/**
 * Pure copy for the Runs and Docs tabs (PANEL-72..75): a round's detail with its `code` runs and
 * the "Show all" cut, compact token counts, and a run's line in the run switcher.
 */
import type { MemoryPolarity } from "../../lib/api";
import type { NodeRound, NodeRunSummary } from "../../lib/api/nodes";
import { displayNameForSubscription, type SubscriptionProviderId } from "../../lib/engines";
import { POLARITY_META, POLARITY_ORDER } from "../../lib/memory";
import { formatRelativeTime } from "../../lib/time";
import { providerLabel, statusBadge } from "../nodeBadges";

/** A detail longer than this many characters is cut at a word and gets "Show all". */
export const DETAIL_LIMIT = 360;

/** The detail cut at a word boundary (never inside a `code` span), or null when it fits. */
export function clipDetail(text: string, limit = DETAIL_LIMIT): string | null {
  if (text.length <= limit) return null;
  const space = text.lastIndexOf(" ", limit);
  let head = text.slice(0, space > 0 ? space : limit);
  if ((head.split("`").length - 1) % 2 === 1) head = head.slice(0, head.lastIndexOf("`"));
  return head.trimEnd();
}

export interface DetailPart {
  code: boolean;
  text: string;
}

// A path-like token: "core/indicators.py", "web/lib/engine-facts.ts".
const PATH = /(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]\w*/g;

/** Plain and code runs: `backticked` spans and path-like tokens read as code. */
export function detailParts(text: string): DetailPart[] {
  const out: DetailPart[] = [];
  text.split("`").forEach((seg, i) => {
    if (!seg) return;
    if (i % 2 === 1) {
      out.push({ code: true, text: seg });
      return;
    }
    let last = 0;
    for (const m of seg.matchAll(PATH)) {
      if (m.index > last) out.push({ code: false, text: seg.slice(last, m.index) });
      out.push({ code: true, text: m[0] });
      last = m.index + m[0].length;
    }
    if (last < seg.length) out.push({ code: false, text: seg.slice(last) });
  });
  return out;
}

/** 16900 → "16.9k", 1000 → "1k", 2400000 → "2.4M". */
export function compactTokens(n: number): string {
  const short = (v: number, unit: string) => `${v.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return short(n / 1000, "k");
  return short(n / 1_000_000, "M");
}

/** "31m ago" today, else the day ("Sep 22"). */
export function whenShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  if (Date.now() - then < 24 * 3600_000) return formatRelativeTime(iso);
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The run switcher's second line: "31m ago · 3 rounds", "Sep 22 · approved". */
export function runLine(run: NodeRunSummary): string {
  const when = whenShort(run.last_round_at ?? run.created_at);
  const what =
    run.rounds_count > 1
      ? `${run.rounds_count} rounds`
      : statusBadge(
          { outcome: run.last_outcome, status: run.last_status },
          false,
        ).label.toLowerCase();
  return when ? `${when} · ${what}` : what;
}

/** How long a round took: "2m 14s", "45s", "1h 5m"; "" while it runs or when unknown. */
export function roundDuration(round: Pick<NodeRound, "started_at" | "ended_at">): string {
  const ms = new Date(round.ended_at ?? "").getTime() - new Date(round.started_at ?? "").getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/**
 * What a round cost and who paid (FOCUS-68): "$0.00 · Grok subscription", "$0.01 · xAI API key".
 * A round with no cost row names only the route (a subscription still costs nothing).
 */
export function billingLine(round: Pick<NodeRound, "cost" | "runs_on">): string {
  const via = round.runs_on;
  const sub = via?.via === "subscription";
  const route = !via
    ? ""
    : sub
      ? `${displayNameForSubscription(via.provider as SubscriptionProviderId) ?? via.provider} subscription`
      : `${providerLabel(via.provider)} API key`;
  const money = round.cost ? `$${round.cost.cost_usd.toFixed(2)}` : sub ? "$0.00" : "";
  return [money, route].filter(Boolean).join(" · ");
}

/** The lessons a round was given, by force: "MUST · SHOULD" (strongest first, once each). */
export function forcesLine(memory: readonly { polarity: string }[]): string {
  const got = new Set(memory.map((m) => m.polarity));
  return POLARITY_ORDER.filter((p: MemoryPolarity) => got.has(p))
    .map((p) => POLARITY_META[p].label)
    .join(" · ");
}

/** A verdict's reasons cut to their first clause: "No new indicator was added…". */
export function firstClause(text: string, limit = 60): string {
  const t = text.trim();
  const stop = t.search(/[:.;](\s|$)/);
  if (stop >= 0 && stop <= limit) return stop === t.length - 1 ? t : `${t.slice(0, stop)}…`;
  if (t.length <= limit) return t;
  const space = t.lastIndexOf(" ", limit);
  return `${t.slice(0, space > 0 ? space : limit)}…`;
}

/** The verdict file as the round wrote it (FOCUS-67), its reasons cut to a clause. */
export function verdictFileText(verdict: {
  file: string;
  verdict: string;
  reasons: string;
}): string {
  return [
    verdict.file,
    "{",
    `  "verdict": ${JSON.stringify(verdict.verdict)},`,
    `  "reasons": ${JSON.stringify(firstClause(verdict.reasons))}`,
    "}",
  ].join("\n");
}
