/**
 * Pure helpers for the Domains screens: the words on a domain card (DM-9…DM-12), the list's
 * search and sort (DM-7, DM-8), numbers and dates. Tested in domainFormat.test.ts.
 */
import type { BadgeVariant } from "../../design-system/components/primitives";
import type { DomainListItem, DomainState } from "../../lib/api/domains";

export type DomainSort = "recent" | "name" | "used" | "attention";

/** The Sort listbox, in the design's order (DmF-Find-3). */
export const SORT_OPTIONS: { value: DomainSort; label: string }[] = [
  { value: "recent", label: "Recently updated" },
  { value: "name", label: "Name" },
  { value: "used", label: "Most used" },
  { value: "attention", label: "Needs attention first" },
];

const TEMPLATE_LABELS: Record<string, string> = {
  support: "Support",
  legal: "Legal",
  financial: "Financial",
  scientific: "Scientific",
  blank: "Blank",
};

export function templateLabel(template: string): string {
  return TEMPLATE_LABELS[template] ?? template;
}

/** 1212 → "1,212". */
export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "1,000-character pieces" (template cards). */
export function pieceSizeLabel(size: number): string {
  return `${formatNumber(size)}-character pieces`;
}

/** The card's status badge (DM-9). */
export function stateBadge(state: DomainState): {
  variant: BadgeVariant;
  dot: boolean;
  label: string;
} {
  switch (state) {
    case "ready":
      return { variant: "success", dot: true, label: "Ready" };
    case "reading":
      return { variant: "info", dot: true, label: "Reading" };
    case "rereading":
      return { variant: "info", dot: true, label: "Re-reading" };
    case "needs_attention":
      return { variant: "warning", dot: true, label: "Needs attention" };
    case "waiting_for_key":
      return { variant: "warning", dot: true, label: "Waiting for a key" };
    default:
      return { variant: "neutral", dot: false, label: "Empty" };
  }
}

function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;
}

/** The files line (DM-10). */
export function filesLine(d: DomainListItem): string {
  const { files } = d;
  if (files.total === 0) return "No files yet";
  const total = plural(files.total, "file", "files");
  switch (d.state) {
    case "reading":
      return `${total} · reading ${formatNumber(files.ready)} of ${formatNumber(files.total)}`;
    case "rereading":
      return `${total} · re-reading ${formatNumber(files.ready)} of ${formatNumber(files.total)}`;
    case "waiting_for_key":
      return `${total} · waiting for ${withArticle(d.reading_model.provider || "API")} key`;
    case "needs_attention":
      return `${total} · ${formatNumber(files.needs_attention)} ${
        files.needs_attention === 1 ? "needs" : "need"
      } attention`;
    default:
      return `${total} · ${plural(d.pieces, "piece", "pieces")}`;
  }
}

/** The quality line (DM-11): the latest finished test run's hit rate. */
export function qualityLine(d: DomainListItem): string {
  const q = d.quality;
  if (d.files.total === 0) return "—";
  if (q.cases === 0) return "No test questions yet";
  if (q.hit_at_k !== null) return `${Math.round(q.hit_at_k * 100)}% found the right file`;
  if (q.keyword_hit !== null) return `${Math.round(q.keyword_hit * 100)}% had the key words`;
  const cases = plural(q.cases, "test question", "test questions");
  return q.last_run_at ? cases : `${cases} · not run yet`;
}

/** The usage line (DM-12): N = steps + agents with access, M = distinct teams. */
export function usageLine(d: DomainListItem): string {
  const { uses, teams } = d.usage;
  if (uses === 0) return "Not used yet";
  if (uses === 1) return "Used in 1 team";
  return `Used ${formatNumber(uses)} times in ${plural(teams, "team", "teams")}`;
}

const MONTH_DAY: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };

/** "Sep 23" this year, "Sep 23, 2025" another year. */
export function formatShortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() === now.getFullYear()
    ? d.toLocaleDateString("en-US", MONTH_DAY)
    : d.toLocaleDateString("en-US", { ...MONTH_DAY, year: "numeric" });
}

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", then "Sep 20". */
export function formatUpdated(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.floor(Math.max(0, now.getTime() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return formatShortDate(iso, now);
}

/** The card footer (DM-9): last activity, or the creation date while it has no files. */
export function footerLine(d: DomainListItem, now: Date = new Date()): string {
  if (d.files.total === 0) return `Created ${formatShortDate(d.created_at, now)}`;
  return `Updated ${formatUpdated(d.last_activity_at, now)}`;
}

/** DM-7: case-insensitive substring of the name. */
export function filterDomains(items: DomainListItem[], query: string): DomainListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((d) => d.name.toLowerCase().includes(q));
}

const ATTENTION_RANK: Record<DomainState, number> = {
  needs_attention: 0,
  waiting_for_key: 1,
  reading: 2,
  rereading: 2,
  ready: 3,
  empty: 4,
};

function byRecent(a: DomainListItem, b: DomainListItem): number {
  return (
    new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime() || byName(a, b)
  );
}

function byName(a: DomainListItem, b: DomainListItem): number {
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/** DM-8: Recently updated (default) · Name · Most used · Needs attention first. */
export function sortDomains(items: DomainListItem[], sort: DomainSort): DomainListItem[] {
  const out = [...items];
  switch (sort) {
    case "name":
      return out.sort(byName);
    case "used":
      return out.sort((a, b) => b.usage.uses - a.usage.uses || byName(a, b));
    case "attention":
      return out.sort(
        (a, b) => ATTENTION_RANK[a.state] - ATTENTION_RANK[b.state] || byRecent(a, b),
      );
    default:
      return out.sort(byRecent);
  }
}

/** A domain being read (or queued to be) keeps the list and nav polling (DM-4). */
export function isReading(d: Pick<DomainListItem, "state">): boolean {
  return d.state === "reading" || d.state === "rereading";
}

/** The reading-model providers; holding any of their keys hides the empty page's key hint. */
export const READING_PROVIDERS = ["openai", "openrouter", "gemini", "huggingface"];
