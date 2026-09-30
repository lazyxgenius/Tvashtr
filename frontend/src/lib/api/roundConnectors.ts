/**
 * The `connectors` block a run's round carries (contract:
 * `docs/superpowers/plans/api/connectors.md`, What a run shows), and the small validators the
 * connectors client shares with it.
 *
 * This module imports NOTHING, on purpose. `lib/api.ts` reads this block, and `connectors.ts`
 * imports `./runs`, whose `ApiDetailError` extends `ApiError` from `lib/api.ts` when it loads. A
 * value import of `connectors.ts` from `lib/api.ts` is therefore a cycle that throws "Class
 * extends value undefined" for any entry that loads `lib/api.ts` first (tsc and `vite build`
 * don't catch it). `lib/api.ts` and `lib/api/nodes.ts` import the parser from here;
 * `connectors.ts` re-exports it.
 */

// ---- Small validators ----

export type Json = Record<string, unknown>;

export function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
export function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
export function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}
export function list<T>(v: unknown, parse: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const raw of v) {
    const item = parse(raw);
    if (item !== null) out.push(item);
  }
  return out;
}
/** An address only when it is `https://` (it becomes a link). */
export function httpsOrNull(v: unknown): string | null {
  return typeof v === "string" && v.startsWith("https://") ? v : null;
}

// ---- Shapes ----

export interface ConnectorCall {
  connection_id: string;
  name: string;
  tool: string;
  write: boolean;
  ok: boolean;
  /** Refused by the read-only rule. */
  blocked: boolean;
  /** The provider took the call. A write that is `forwarded` and not `ok` (its answer was lost,
   *  or was an error) may still have changed data. */
  forwarded: boolean;
  arg: string | null;
  at: string | null;
  duration_ms: number | null;
  /** For a write, the first `https://` address in its result. */
  result_url: string | null;
}

/** The `connectors` block of one round (the agent drawer's Runs tab and the run drawer). */
export interface RoundConnectors {
  used: { connection_id: string; name: string; slug: string; reads: number; writes: number }[];
  /** Writes first, then by time; capped at 50 (`total_calls` is the real number). */
  calls: ConnectorCall[];
  total_calls: number;
  /** Connectors the round ran without. `connection_id` is null when the row is gone. */
  skipped: { connection_id: string | null; name: string; reason: string }[];
}

// ---- Parsers ----

function parseCall(raw: unknown): ConnectorCall | null {
  if (!isRecord(raw) || typeof raw.tool !== "string") return null;
  return {
    connection_id: str(raw.connection_id),
    name: str(raw.name, "Connector"),
    tool: raw.tool,
    write: raw.write !== false, // unreadable = a write, as for tools
    ok: raw.ok === true,
    blocked: raw.blocked === true,
    // A round from before the field existed: the provider took a call that worked.
    forwarded: raw.forwarded === undefined ? raw.ok === true : raw.forwarded === true,
    arg: strOrNull(raw.arg),
    at: strOrNull(raw.at),
    duration_ms: typeof raw.duration_ms === "number" ? raw.duration_ms : null,
    result_url: httpsOrNull(raw.result_url),
  };
}

/** The `connectors` block of a round, or null for a round with no calls and nothing skipped. */
export function parseRoundConnectors(raw: unknown): RoundConnectors | null {
  if (!isRecord(raw)) return null;
  const calls = list(raw.calls, parseCall);
  return {
    used: list(raw.used, (u) =>
      isRecord(u) && typeof u.connection_id === "string"
        ? {
            connection_id: u.connection_id,
            name: str(u.name, "Connector"),
            slug: str(u.slug),
            reads: count(u.reads),
            writes: count(u.writes),
          }
        : null,
    ),
    calls,
    total_calls: Math.max(count(raw.total_calls), calls.length),
    skipped: list(raw.skipped, (s) =>
      isRecord(s) && typeof s.reason === "string"
        ? {
            connection_id: strOrNull(s.connection_id),
            name: str(s.name, "a connector"),
            reason: s.reason,
          }
        : null,
    ),
  };
}
