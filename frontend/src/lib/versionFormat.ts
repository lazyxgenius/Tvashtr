/** M5's small words (the Ver-* boards): a version's age, the runs pill, the diff pill, a run's look. */
import { elapsedShort, money } from "../pages/home/homeFormat";
import type { TeamRunRow } from "./api";
import type { VersionChange } from "./api/versions";

/** "changed" fields that are one thing ("Type goes back"); the others are many ("Skills go back"). */
const SINGULAR = new Set(["Type", "Gate"]);

/**
 * Restore's WHAT CHANGES (Ver-Restore / Ver-RestoreDraft): one line per change row (the working
 * copy → vN), every route row in one "Routes go back to how they were in vN".
 */
export function restoreTitles(changes: VersionChange[], n: number): string[] {
  const out: string[] = [];
  let routes = false;
  for (const c of changes) {
    if (c.key.startsWith("route:")) {
      if (!routes) out.push(`Routes go back to how they were in v${n}`);
      routes = true;
      continue;
    }
    const who = c.agent ? `${c.agent} › ${c.field}` : (c.field ?? "");
    // " gate" unless the name says it already (the server's _phrase).
    const node = `The ${c.agent}${c.gate && !/gate/i.test(c.agent ?? "") ? " gate" : ""}`;
    if (c.kind === "text") out.push(`${who} go back to the v${n} text`);
    else if (c.kind === "value")
      out.push(c.after != null ? `${who} goes back to ${c.after}` : `${who} is cleared`);
    else if (c.kind === "changed")
      out.push(`${who} ${SINGULAR.has(c.field ?? "") ? "goes" : "go"} back to v${n}’s`);
    else out.push(`${node} ${c.kind === "added" ? "comes back" : "is removed"}`);
  }
  return out;
}

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;

/** "just now", "2m ago", "5h ago", "yesterday", "3 days ago", "1 week ago", then a date. `long`
 *  spells the minutes and hours out for a sentence ("saved 2 minutes ago by you"). */
export function versionAge(iso: string, now = Date.now(), long = false): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const m = Math.floor((now - t) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return long ? unit(m, "minute") : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (m < 1440) return long ? unit(h, "hour") : `${h}h ago`;
  const d = Math.floor(m / 1440);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return w === 1 ? "1 week ago" : `${w} weeks ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "no runs", "1 run", "3 runs". */
export const runsPill = (n: number) => (n === 0 ? "no runs" : n === 1 ? "1 run" : `${n} runs`);

/** "1 removed, 2 added" (a zero side is left out). */
export const diffPill = (removed: number, added: number) =>
  [removed && `${removed} removed`, added && `${added} added`].filter(Boolean).join(", ");

/** A run's status in the plain state words (brief §2.5) and its Badge. */
export function runLook(status: string): {
  label: string;
  variant: "success" | "danger" | "neutral" | "info" | "warning";
} {
  switch (status) {
    case "completed":
      return { label: "Done", variant: "success" };
    case "failed":
      return { label: "Failed", variant: "danger" };
    case "awaiting_human":
      return { label: "Needs you", variant: "warning" };
    case "pending":
    case "running":
      return { label: "Working", variant: "info" };
    default:
      return { label: "Stopped", variant: "neutral" };
  }
}

/** "22m · $1.12 · pull request #42" / "… · resumed as #13" / "… · stopped by you". */
export function runMeta(run: TeamRunRow): string {
  const parts = [
    run.updated_at ? elapsedShort(run.created_at, Date.parse(run.updated_at)) : "",
    money(run.spent_usd ?? run.cost_total_usd),
    run.pr_number != null ? `pull request #${run.pr_number}` : "",
    run.resumed_as != null ? `resumed as #${run.resumed_as}` : "",
    run.status === "cancelled" ? "stopped by you" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
