import "./live.css";

import type { GraphData, GraphNode } from "../../../lib/api";
import type { ActivityAgent } from "../../../lib/api/activity";
import { agoLong, duration, stateTone, stateWord } from "./liveFormat";
import { StateGlyph } from "./StateGlyph";

/** Hidden from the Now bar: the Stop ending, and an escalation gate the run never reached. */
function hidden(node: GraphNode | undefined, a: ActivityAgent): boolean {
  const cfg = (node?.config ?? {}) as Record<string, unknown>;
  if (a.kind === "stop" || (a.kind === "terminal" && cfg.terminal_kind !== "ship")) return true;
  return a.kind === "gate" && cfg.gate_kind === "review_escalation" && a.live_state === "waiting";
}

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function silentSeconds(a: ActivityAgent, now: number): number {
  return a.last_event_at ? Math.max(0, (now - Date.parse(a.last_event_at)) / 1000) : 0;
}

/** The second line of a chip: what the agent is doing, or waits for. */
function chipLine(
  a: ActivityAgent,
  graph: GraphData | null,
  agents: Map<string, ActivityAgent>,
  now: number,
): string {
  if (a.live_state === "quiet" || a.live_state === "stalled") {
    const last = a.activity ? ` · last: ${lowerFirst(a.activity)}` : "";
    return `No update for ${duration(silentSeconds(a, now))}${last}`;
  }
  if (a.live_state === "waiting") {
    const from = graph?.edges.find(
      (e) => e.target_node_id === a.node_id && e.edge_type !== "escalation",
    )?.source_node_id;
    const before = from ? agents.get(from) : undefined;
    if (!before) return "";
    return before.kind === "gate"
      ? "Starts after your approval"
      : `Starts after the ${before.label}`;
  }
  return a.activity ?? "";
}

function ago(a: ActivityAgent, now: number): string {
  if (!a.last_event_at || a.live_state === "waiting") return "";
  return a.live_state === "quiet" || a.live_state === "stalled"
    ? `${duration(silentSeconds(a, now))} ago`
    : agoLong(a.last_event_at, now);
}

const BUSY = new Set(["working", "running_command", "needs_you", "retrying", "quiet", "stalled"]);

/**
 * M2 — the Now bar under the run bar (Runs › Live-*): one chip per agent with its state word, its
 * current activity and how long ago it last moved, then Ship. A chip selects its agent.
 */
export function NowBar({
  agents,
  graph,
  now = Date.now(),
  onSelect,
}: {
  agents: ActivityAgent[];
  graph: GraphData | null;
  now?: number;
  onSelect: (nodeId: string) => void;
}) {
  const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
  const agentsById = new Map(agents.map((a) => [a.node_id, a]));
  const shown = agents.filter((a) => !hidden(byId.get(a.node_id), a));
  return (
    <section className="lv-now" aria-label="Now">
      <span className="lv-now__label">Now</span>
      {shown.map((a) => {
        // The server names an ending by its kind ("ship"); an older one says "terminal".
        const ship = a.kind === "ship" || a.kind === "terminal";
        if (ship) {
          return (
            <button
              key={a.node_id}
              type="button"
              className="lv-chip lv-chip--ship"
              onClick={() => onSelect(a.node_id)}
            >
              <StateGlyph state={a.live_state} ship />
              <span className="lv-chip__text">
                <span className="lv-chip__name">{a.label}</span>
                <span className="lv-chip__ship">
                  {a.live_state === "done" ? (a.activity ?? "Shipped") : "Not yet"}
                </span>
              </span>
            </button>
          );
        }
        return (
          <button
            key={a.node_id}
            type="button"
            className={`lv-chip lv-chip--${stateTone(a.live_state)}${BUSY.has(a.live_state) ? " lv-chip--busy" : ""}`}
            onClick={() => onSelect(a.node_id)}
          >
            <span className={`lv-sq lv-sq--${stateTone(a.live_state)}`}>
              <StateGlyph state={a.live_state} />
            </span>
            <span className="lv-chip__text">
              <span className="lv-chip__top">
                <span className="lv-chip__name">{a.label}</span>
                <span className={`lv-chip__state lv-tone--${stateTone(a.live_state)}`}>
                  {stateWord(a.live_state)}
                </span>
              </span>
              <span className="lv-chip__line">{chipLine(a, graph, agentsById, now)}</span>
            </span>
            <span className="lv-chip__ago">{ago(a, now)}</span>
          </button>
        );
      })}
    </section>
  );
}
