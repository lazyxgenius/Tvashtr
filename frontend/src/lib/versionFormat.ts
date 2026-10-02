/** M5's small words (the Ver-* boards): a version's age, the runs pill, the diff pill, a run's look. */
import { elapsedShort, money } from "../pages/home/homeFormat";
import type { TeamRunRow } from "./api";

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
