/** Small formatters Home's sections share (copy rules from home-run.md §2). */

/** "$6.19" — money is dollars with two decimals. */
export function money(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}

/** "a", "a and b", "a, b and c". */
export function listNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Elapsed time since `iso`, short: "just now", "26m", "11h", "3d". */
export function elapsedShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** "Good morning" before noon, "Good afternoon" until 6pm, else "Good evening" (local clock). */
export function greetingFor(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Subscription ids → display names ("claude" → "Claude"). */
export function subscriptionName(id: string): string {
  if (id === "claude") return "Claude";
  if (id === "grok") return "Grok";
  if (id === "codex") return "Codex";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** The status word / Badge variant the redesign uses for a run status. */
export function runStatusLook(status: string): {
  label: string;
  variant: "warning" | "info" | "danger" | "success" | "outline" | "neutral";
  dot: string;
} {
  switch (status) {
    case "awaiting_human":
      return { label: "Awaiting you", variant: "warning", dot: "#c8923a" };
    case "pending":
    case "running":
      return { label: "Running", variant: "info", dot: "#5b7fa6" };
    case "failed":
      return { label: "Failed", variant: "danger", dot: "#c0513f" };
    case "completed":
      return { label: "Completed", variant: "success", dot: "var(--sage-500)" };
    case "over_budget":
      return { label: "Over budget", variant: "warning", dot: "#c8923a" };
    case "cancelled":
    case "rejected":
      return { label: "Stopped", variant: "outline", dot: "var(--ink-400)" };
    default:
      return { label: status, variant: "neutral", dot: "var(--ink-400)" };
  }
}

/** Scroll a Home section into view and move focus to it (the greeting's links). */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView?.({ behavior: "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

export const SECTION_IDS = {
  needsYou: "home-needs-you",
  runningNow: "home-running-now",
  spend: "home-spend",
  composer: "home-composer",
} as const;

/** The Needs-you / sheet title for a gate, by task kind (HOME-41/45). */
const TITLES: Record<string, string> = {
  prd_approval: "Approve the spec",
  ship_approval: "Approve the ship",
  budget_approval: "Approve going over budget",
  review_escalation: "Decide on the escalation",
};

export function approvalTitle(kind: string): string {
  return TITLES[kind] ?? "Approve to continue";
}
