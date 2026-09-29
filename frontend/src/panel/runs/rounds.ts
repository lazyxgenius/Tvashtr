/**
 * Pure copy for the Runs and Docs tabs (PANEL-72..75): a round's detail with its `code` runs and
 * the "Show all" cut, compact token counts, and a run's line in the run switcher.
 */
import type { NodeRunSummary } from "../../lib/api/nodes";
import { formatRelativeTime } from "../../lib/time";
import { statusBadge } from "../nodeBadges";

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
