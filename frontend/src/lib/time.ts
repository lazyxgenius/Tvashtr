/**
 * A dependency-free relative-time formatter for a PAST ISO timestamp (a run's `started_at`):
 *
 *   <60s → "just now"   ·   <60m → "{n}m ago"   ·   <24h → "{n}h ago"   ·   <7d → "{n}d ago"
 *   ≥7d → a short absolute date (e.g. "Jun 26")
 *
 * A future timestamp (clock skew) reads "just now"; an unparseable input reads "" (the caller then
 * renders no tag). No date library — the M2 brief forbids a new runtime dependency.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The same, spelled out ("2 minutes ago", "1 hour ago") — for sentences like the offline banner's
 *  "Last updated 2 minutes ago." */
export function formatRelativeTimeWords(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return unit(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return unit(days, "day");
  return `on ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}
