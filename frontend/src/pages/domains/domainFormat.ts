/**
 * Pure helpers for the Domains screens: the words on a domain card (DM-9…DM-12), the list's
 * search and sort (DM-7, DM-8), numbers and dates. Tested in domainFormat.test.ts.
 */
import type { BadgeVariant } from "../../design-system/components/primitives";
import type {
  DomainDetailView,
  DomainFile,
  DomainFileCounts,
  DomainFileFilter,
  DomainFileKind,
  DomainFiles,
  DomainFilesList,
  DomainListItem,
  DomainState,
} from "../../lib/api/domains";

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

// ---- The detail page (DM-31…DM-37) ----

function filesCount(n: number): string {
  return plural(n, "file", "files");
}

/** Files being read or queued to be (the header's "Reading 3 files"). */
function inFlight(d: DomainListItem): number {
  return d.files.reading + d.files.waiting;
}

/** The detail header's status badge (DM-32). */
export function detailBadge(d: DomainDetailView): {
  variant: BadgeVariant;
  dot: boolean;
  label: string;
} {
  const { files } = d;
  switch (d.state) {
    case "ready":
      return { variant: "success", dot: true, label: "Ready" };
    case "reading":
      // The first read counts every file in it ("Reading 3 files" while one is already read).
      return {
        variant: "info",
        dot: true,
        label: `Reading ${filesCount(d.setup.files_read ? inFlight(d) : files.total)}`,
      };
    case "rereading":
      if (d.pieces === 0 && inFlight(d) === files.total) {
        return { variant: "warning", dot: true, label: "Ask paused while re-reading" };
      }
      return { variant: "info", dot: true, label: `Re-reading ${filesCount(inFlight(d))}` };
    case "needs_attention":
      return {
        variant: "warning",
        dot: true,
        label: `${filesCount(files.needs_attention)} ${
          files.needs_attention === 1 ? "needs" : "need"
        } attention`,
      };
    case "waiting_for_key":
      return {
        variant: "warning",
        dot: true,
        label: `Waiting for ${withArticle(d.reading_model.provider || "API")} key`,
      };
    default:
      return { variant: "neutral", dot: false, label: "Empty" };
  }
}

/** The header's meta line (DM-33). */
export function metaLine(d: DomainDetailView, now: Date = new Date()): string {
  const parts = [filesCount(d.files.total)];
  if (d.setup.files_read && d.pieces > 0) parts.push(plural(d.pieces, "piece", "pieces"));
  const model = d.reading_model.label || d.reading_model.slug;
  if (model) {
    const fullReread = d.state === "rereading" && inFlight(d) === d.files.total;
    parts.push(`${fullReread ? "reading" : "read"} with ${model}`);
  }
  const created = new Date(d.created_at).getTime();
  if (!Number.isNaN(created) && now.getTime() - created < 60_000) parts.push("created just now");
  else {
    const updated = formatUpdated(d.last_activity_at, now);
    if (updated) parts.push(`updated ${updated}`);
  }
  return parts.join(" · ");
}

export type StripTone = "done" | "warn" | "todo";

/** The one-line summary strip on the Sources tab (DM-34). */
export function summaryItems(d: DomainDetailView): { tone: StripTone; text: string }[] {
  const provider = d.reading_model.provider || "API";
  const q = d.quality;
  const quality =
    q.cases === 0
      ? { tone: "todo" as const, text: "No test questions yet" }
      : {
          tone: "done" as const,
          text:
            q.hit_at_k !== null
              ? `${plural(q.cases, "test question", "test questions")} · ${Math.round(
                  q.hit_at_k * 100,
                )}% found the right file`
              : plural(q.cases, "test question", "test questions"),
        };
  return [
    d.reading_model.key_saved
      ? { tone: "done", text: `Reading key saved (${provider})` }
      : { tone: "warn", text: `No ${provider} key` },
    {
      tone: d.files.ready === d.files.total ? "done" : "todo",
      text: `${formatNumber(d.files.ready)} of ${filesCount(d.files.total)} read`,
    },
    quality,
    { tone: d.usage.uses > 0 ? "done" : "todo", text: usageLine(d) },
  ];
}

export type SetupIcon = "done" | "spin" | "warn" | "step";

/** The setup strip's four steps until the first read finishes (DM-37). */
export function setupSteps(
  d: DomainDetailView,
): { icon: SetupIcon; number: number; title: string; body: string; addKey?: boolean }[] {
  const provider = d.reading_model.provider || "API";
  const key = d.reading_model.key_saved
    ? { icon: "done" as const, body: `${provider} key saved` }
    : { icon: "warn" as const, body: `No ${provider} key`, addKey: true };
  const { files } = d;
  let add: { icon: SetupIcon; body: string };
  if (files.total === 0) add = { icon: "step", body: "No files yet" };
  else if (inFlight(d) > 0) add = { icon: "spin", body: `Reading ${filesCount(files.total)}…` };
  else if (files.waiting_for_key > 0)
    add = { icon: "step", body: `${filesCount(files.waiting_for_key)} waiting for the key` };
  else add = { icon: "done", body: `${filesCount(files.ready)} read` };
  return [
    { number: 1, title: "Reading key", ...key },
    { number: 2, title: "Add files", ...add },
    {
      number: 3,
      icon: d.setup.tested ? "done" : "step",
      title: "Test it",
      body: "Ask a question when reading finishes",
    },
    {
      number: 4,
      icon: d.setup.used ? "done" : "step",
      title: "Use it in a team",
      body: "As a fixed step, or give an agent access",
    },
  ];
}

// ---- The Sources tab (DM-41…DM-47) ----

/** 18 KB, 880 KB, 1.2 MB (one decimal from 1 MB). */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The Added column: "Just now" under a minute, else "Sep 12". */
export function formatAdded(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  if (now.getTime() - then < 60_000) return "Just now";
  return formatShortDate(iso, now);
}

const KIND_NAMES: Record<DomainFileKind, string> = {
  PDF: "PDF",
  MD: "Markdown",
  HTML: "HTML",
  TXT: "Text",
};

export function kindName(kind: DomainFileKind): string {
  return KIND_NAMES[kind];
}

/** A file being read, re-read or queued keeps the table polling (DM-4). */
export function fileBusy(f: Pick<DomainFile, "phase">): boolean {
  return f.phase === "reading" || f.phase === "rereading" || f.phase === "waiting";
}

/** The Show filter's options with their counts (DM-47). */
export function showOptions(
  counts: DomainFileCounts,
): { value: DomainFileFilter; label: string; count: number }[] {
  return [
    { value: "all", label: "All files", count: counts.all },
    { value: "ready", label: "Ready", count: counts.ready },
    { value: "reading", label: "Reading", count: counts.reading },
    { value: "needs_attention", label: "Needs attention", count: counts.needs_attention },
  ];
}

/**
 * The table footer (DM-45, OQ-7). `showAll` is true when the footer ends with the "Show all files"
 * link (the Needs attention filter).
 */
export function filesFooter({
  files,
  list,
  shown,
  query,
  filter,
  firstRead,
}: {
  files: DomainFiles;
  list: DomainFilesList;
  shown: number;
  query: string;
  filter: DomainFileFilter;
  firstRead: boolean;
}): { text: string; showAll: boolean } {
  const n = list.counts.all;
  const q = query.trim();
  if (q) return { text: `${formatNumber(shown)} of ${filesCount(n)} match “${q}”`, showAll: false };
  if (filter === "needs_attention") {
    return {
      text: `${filesCount(shown)} ${shown === 1 ? "needs" : "need"} attention · `,
      showAll: true,
    };
  }
  if (filter !== "all") {
    return {
      text: `Showing ${formatNumber(shown)} of ${filesCount(n)} · ${plural(
        list.total_pieces,
        "piece",
        "pieces",
      )}`,
      showAll: false,
    };
  }
  const total = filesCount(n);
  const busy = files.reading + files.waiting;
  if (busy > 0 && firstRead) {
    return {
      text: `${total} · reading ${formatNumber(files.reading)} of ${formatNumber(n)}`,
      showAll: false,
    };
  }
  if (busy > 0) {
    const parts = [];
    if (files.reading) parts.push(`reading ${formatNumber(files.reading)}`);
    if (files.waiting) parts.push(`waiting ${formatNumber(files.waiting)}`);
    return { text: `${total} · ${parts.join(", ")}`, showAll: false };
  }
  if (files.needs_attention > 0) {
    return {
      text: `${total} · ${formatNumber(files.needs_attention)} needs attention`,
      showAll: false,
    };
  }
  return { text: `${total} · ${plural(list.total_pieces, "piece", "pieces")}`, showAll: false };
}

/** A piece card's excerpt: the start of the piece (or the words around a find), "…" where cut. */
export function pieceExcerpt(text: string, number: number, query = "", max = 160): string {
  const body = text.trim().replace(/\s+/g, " ");
  let start = 0;
  const q = query.trim().toLowerCase();
  if (q) {
    const at = body.toLowerCase().indexOf(q);
    if (at > 40) start = body.lastIndexOf(" ", at - 30) + 1;
  }
  let piece = body.slice(start);
  let cut = false;
  if (piece.length > max) {
    const space = piece.lastIndexOf(" ", max);
    piece = piece.slice(0, space > 0 ? space : max);
    cut = true;
  }
  const lead = start > 0 || number > 1 ? "…" : "";
  return `${lead}${piece.replace(/[\s,;:]+$/, "")}${cut ? "…" : ""}`;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_KINDS = ["pdf", "md", "txt", "html"];
/** The Add files picker's types. */
export const UPLOAD_ACCEPT = ".pdf,.md,.txt,.html";

/** Why a picked or dropped file can't be added (DM-48), or null. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : "";
  if (!UPLOAD_KINDS.includes(ext)) {
    return `${file.name} wasn’t added. Only PDF, Markdown, text or HTML files can be read.`;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatSize(file.size)}. The limit is 10 MB.`;
  }
  return null;
}

// ---- The New domain dialog (DM-22…DM-29) ----

export const MAX_DOMAIN_NAME = 120;

/** The name rule (DM-14, DM-27): trimmed, 1–120 characters, unique ignoring case. */
export function domainNameProblem(name: string, existing: string[]): string | null {
  const clean = name.trim();
  if (!clean) return "Give this domain a name.";
  if (clean.length > MAX_DOMAIN_NAME) return "Use 120 characters or fewer.";
  const lower = clean.toLowerCase();
  if (existing.some((n) => n.trim().toLowerCase() === lower)) {
    return `You already have a domain named “${clean}”.`;
  }
  return null;
}

/** A picked file's kind tile (MD, PDF, HTML, TXT — like the backend's `file_kind`). */
export function kindOfName(name: string): DomainFileKind {
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  if (ext === "pdf") return "PDF";
  if (ext === "md") return "MD";
  if (ext === "html") return "HTML";
  return "TXT";
}

/** Why a file picked in the dialog won't be added (DM-28): listed with this note, not uploaded. */
export function pickProblem(file: { name: string; size: number }): string | null {
  const ext = file.name.includes(".") ? (file.name.split(".").pop() ?? "").toLowerCase() : "";
  if (!UPLOAD_KINDS.includes(ext)) return "Only PDF, Markdown, text or HTML.";
  if (file.size > MAX_UPLOAD_BYTES) return "Over 10 MB.";
  return null;
}

/**
 * Step 2's primary action (DM-28): "Create and read 3 files" ("1 file"). With no key for the
 * reading model the files wait, so it says "add" instead of "read".
 */
export function createLabel(n: number, keySaved: boolean): string {
  return `Create and ${keySaved ? "read" : "add"} ${plural(n, "file", "files")}`;
}
