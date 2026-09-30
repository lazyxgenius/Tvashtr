/**
 * Words and addresses for connectors in the agent drawer: the checklist's access line, a round's
 * chips and calls, and where Toolkit › Connectors lives.
 */
import type { Connection } from "../../lib/api/connectors";
import type { ConnectorCall, RoundConnectors } from "../../lib/api/roundConnectors";

/** One connection's page, or the Connectors list when there is no id (`lib/nav.ts`, F1.1). */
export const connectorsHref = (id?: string | null): string =>
  id ? `#/toolkit/connectors/${encodeURIComponent(id)}` : "#/toolkit/connectors";

/** "Read only · project trade-mcp-prod", "Read & write allowed", or that it needs attention. */
export function accessLine(c: Connection): string {
  if (c.status === "needs_signin") return "Needs attention · runs go on without it";
  const access = c.access === "write" ? "Read & write allowed" : "Read only";
  if (!c.scope) return access;
  return `${access} · ${(c.scope_picker?.label ?? "Project").toLowerCase()} ${c.scope.label}`;
}

// ---- What a round called (the Runs tab) ----

/** The two letters on a connector's tile: "Supabase" → "Su". */
export function tileLetters(name: string): string {
  const letters = name.replace(/[^\p{L}\p{N}]/gu, "");
  return letters ? letters[0].toUpperCase() + letters.slice(1, 2).toLowerCase() : "?";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A chip's words: "Supabase · 6 reads", "Linear · 1 write", writes first when it did both. */
export function usedLabel(u: RoundConnectors["used"][number]): string {
  const counts = [
    ...(u.writes > 0 ? [plural(u.writes, "write")] : []),
    ...(u.reads > 0 || u.writes === 0 ? [plural(u.reads, "read")] : []),
  ];
  return `${u.name} · ${counts.join(" · ")}`;
}

/** Under a call: when, how long, and what became of it when it didn't go through ("10:04 · 0.3 s"). */
export function callMeta(call: ConnectorCall): string {
  const at = call.at ? new Date(call.at) : null;
  return [
    at && !Number.isNaN(at.getTime())
      ? at.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      : null,
    call.duration_ms !== null ? `${(call.duration_ms / 1000).toFixed(1)} s` : null,
    call.blocked ? "Not run: read only for this agent" : call.ok ? null : "Failed",
  ]
    .filter(Boolean)
    .join(" · ");
}
