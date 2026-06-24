// Turn a persisted run event into a concise, readable feed row.
// Pure + defensive against missing keys — never throws. Drives the Engineer panel.

export type EventTone = "neutral" | "danger";

export interface EventSummary {
  tone: EventTone;
  label: string; // the event kind — drives the row badge
  lead: string; // tool name / source — the actor, may be empty
  detail: string; // a single-line, capped one-liner
  full: string; // the fuller text, for a tooltip / expand
}

const DETAIL_CAP = 140;

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  // Only stringify primitives — an object has no useful default stringification
  // ("[object Object]"), and the persisted payload values are always scalars anyway. This
  // keeps `asString` total + never-throwing without leaning on Object's base toString.
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

/** First non-empty, trimmed line of a (possibly multi-line) value. */
function firstLine(value: unknown): string {
  const s = asString(value);
  for (const line of s.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function cap(s: string, n: number = DETAIL_CAP): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1).trimEnd()}…`;
}

/**
 * Summarize one engine event. The payload shapes are exactly those persisted by
 * `engines/openhands_adapter.py::_payload_of`:
 *   action       -> { tool_name, thought, action }
 *   observation  -> { tool_name, observation }
 *   message      -> { source, text }
 *   error        -> { error }
 * (plus a defensive { unparsed: true, error } fallback the adapter may emit.)
 */
export function summarizeEvent(kind: string, payload: Record<string, unknown>): EventSummary {
  const p = payload ?? {};
  switch (kind) {
    case "action": {
      const thought = asString(p.thought);
      const action = asString(p.action);
      return {
        tone: "neutral",
        label: "action",
        lead: asString(p.tool_name),
        detail: cap(firstLine(thought) || firstLine(action)),
        full: thought || action,
      };
    }
    case "observation": {
      const observation = asString(p.observation);
      return {
        tone: "neutral",
        label: "observation",
        lead: asString(p.tool_name),
        detail: cap(firstLine(observation)),
        full: observation,
      };
    }
    case "message": {
      const text = asString(p.text);
      return {
        tone: "neutral",
        label: "message",
        lead: asString(p.source),
        detail: cap(firstLine(text)),
        full: text,
      };
    }
    case "error": {
      const err = asString(p.error);
      return { tone: "danger", label: "error", lead: "", detail: cap(firstLine(err) || err), full: err };
    }
    default: {
      // Unknown kind, or the defensive { unparsed, error } shape.
      const fallback = asString(p.error) || asString(p.text) || asString(p.observation);
      return { tone: "neutral", label: kind || "event", lead: "", detail: cap(firstLine(fallback)), full: fallback };
    }
  }
}
