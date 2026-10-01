/**
 * M2 run view — the plain state words (brief §2.5), the "ago" stamps the boards print, and the
 * merge of each 2-second Activity poll into what the view already shows.
 */
import type { ActivityLine, LiveState, RunActivity } from "../../../lib/api/activity";

const WORDS: Record<LiveState, string> = {
  waiting: "Waiting",
  working: "Working",
  running_command: "Running a command",
  needs_you: "Needs you",
  retrying: "Retrying",
  quiet: "Quiet",
  stalled: "Stalled",
  failed: "Failed",
  done: "Done",
  stopped: "Stopped",
  carried_over: "Carried over",
};

export function stateWord(state: LiveState): string {
  return WORDS[state] ?? state;
}

/** The palette family a state is drawn in (chip, icon square, ring). */
export function stateTone(state: LiveState): "ok" | "live" | "warn" | "danger" | "idle" {
  switch (state) {
    case "done":
      return "ok";
    case "working":
    case "running_command":
    case "needs_you":
      return "live";
    case "retrying":
    case "quiet":
      return "warn";
    case "stalled":
    case "failed":
      return "danger";
    default:
      return "idle";
  }
}

function seconds(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000));
}

function span(s: number, sep: string): string {
  if (s < 60) return `${s}${sep}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

/** "4 s ago" / "3m ago" (the Now bar). */
export function agoLong(iso: string | null, now = Date.now()): string {
  const s = seconds(iso, now);
  return s === null ? "" : `${span(s, " ")} ago`;
}

/** "4s" / "16m" (a node card). */
export function agoShort(iso: string | null, now = Date.now()): string {
  const s = seconds(iso, now);
  return s === null ? "" : span(s, "");
}

/** "1m 32s" / "5m 10s" / "22m 38s" — a running time. */
export function duration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** "10:43:10" — a line's local clock time. */
export function clock(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Fold a poll into the view: every field from the newest reply; lines merged by id (a line that
 *  changed — a command that finished — replaces its earlier self), in time order. */
export function mergeActivity(prev: RunActivity | null, next: RunActivity): RunActivity {
  if (!prev) return next;
  const byId = new Map<string, ActivityLine>(prev.lines.map((l) => [l.id, l]));
  for (const l of next.lines) byId.set(l.id, l);
  const lines = [...byId.values()].sort((a, b) =>
    a.at === b.at ? 0 : Date.parse(a.at) - Date.parse(b.at),
  );
  return { ...next, lines };
}
