import { type ReactNode, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

import { getRunEvents, type GraphNode, type RunEvent, type RunRow } from "../lib/api";
import { summarizeEvent } from "../lib/events";
import { isRunTerminal } from "../lib/status";

type LoadState = "idle" | "loading" | "ready" | "error";

// Map the event kind to a DS Badge variant (error -> danger tint).
const BADGE_VARIANT: Record<string, string> = {
  action: "neutral",
  observation: "outline",
  message: "accent",
  error: "danger",
};

function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// M-ledger C6: one round's worth of a node's feed events — the invocation id, the round number
// (`iteration`) shown in the header, and the events in arrival (seq) order.
interface EventRound {
  invocationId: number | null;
  iteration: number | null;
  events: RunEvent[];
}

// Group a node's (already node-scoped) events by invocation, ascending — the round order. Every
// event in one invocation shares its (invocation_id, iteration), so the first event's `iteration`
// names the round. A single-round node yields one group; a stray null-invocation group sorts last.
function groupByInvocation(events: RunEvent[]): EventRound[] {
  const byInv = new Map<number | null, EventRound>();
  for (const e of events) {
    const group = byInv.get(e.invocation_id);
    if (group) group.events.push(e);
    else
      byInv.set(e.invocation_id, {
        invocationId: e.invocation_id,
        iteration: e.iteration,
        events: [e],
      });
  }
  return [...byInv.values()].sort((a, b) => {
    if (a.invocationId === b.invocationId) return 0;
    if (a.invocationId === null) return 1;
    if (b.invocationId === null) return -1;
    return a.invocationId - b.invocationId;
  });
}

/**
 * The Engineer panel: the agent's action/observation stream as a concise log.
 * Polls ~2s only while the panel is open AND the run is non-terminal; one fetch
 * on open, one final fetch when the run turns terminal (the effect re-runs as
 * `terminal` flips), then it stops. Closing the panel unmounts this component,
 * which clears the interval — so there is no polling when closed.
 */
export function EventFeed({
  node,
  runId,
  run,
  workflowStatus,
}: {
  node: GraphNode;
  runId: string | null;
  run: RunRow | null;
  workflowStatus: string | null;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const terminal = isRunTerminal(run, workflowStatus);

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      setState("idle");
      return;
    }
    let cancelled = false;
    let handle: ReturnType<typeof setInterval> | undefined;

    const fetchOnce = async () => {
      try {
        const res = await getRunEvents(runId);
        if (cancelled) return;
        setEvents(res.events);
        setState("ready");
      } catch {
        if (!cancelled) setState((s) => (s === "ready" ? s : "error"));
      }
    };

    setState((s) => (s === "ready" ? s : "loading"));
    void fetchOnce();
    if (!terminal) {
      handle = setInterval(() => void fetchOnce(), 2000);
    }
    return () => {
      cancelled = true;
      if (handle) clearInterval(handle);
    };
  }, [runId, terminal]);

  // Auto-scroll to newest — but only when the user is already near the bottom,
  // so we never yank a reader who has scrolled up to inspect an earlier step.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
  };

  // M-ledger C6: scope to THIS node's events (the backend tags each event with its node_id; legacy
  // rows carry null and aren't attributable to a node, so they drop out), then group by round.
  const nodeEvents = events.filter((e) => e.node_id === node.id);
  const rounds = groupByInvocation(nodeEvents);

  let body: ReactNode;
  if (state === "error" && nodeEvents.length === 0) {
    body = <p className="tv-panel-note">Couldn't load the engineer's activity.</p>;
  } else if (nodeEvents.length === 0) {
    body =
      state === "idle" || state === "loading" ? (
        <p className="tv-panel-note">Loading activity…</p>
      ) : (
        <p className="tv-panel-note">No activity yet — the engineer hasn't started.</p>
      );
  } else {
    body = (
      <div className="tv-feed">
        {rounds.map((round) => (
          <div className="tv-feed__round" key={round.invocationId ?? "legacy"}>
            <div className="tv-feed__round-head">Round {round.iteration ?? "—"}</div>
            {round.events.map((e) => {
              const s = summarizeEvent(e.kind, e.payload);
              const variant = BADGE_VARIANT[s.label] ?? "neutral";
              return (
                <div className="tv-feed__row" key={`${e.invocation_id}:${e.seq}`}>
                  <span className={`tv-badge tv-badge--${variant}`}>{s.label}</span>
                  <span className="tv-feed__main">
                    {s.lead && <span className="tv-feed__lead">{s.lead}</span>}
                    <span className="tv-feed__detail" title={s.full || s.detail}>
                      {s.detail || "—"}
                    </span>
                  </span>
                  <span className="tv-feed__time">{clockTime(e.created_at)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="tv-scroll" ref={scrollRef} onScroll={onScroll}>
      <p className="tv-feed__note">
        <Info size={13} strokeWidth={1.7} />
        <span>
          After a crash and recovery, repeated steps show the first attempt's events — this is a
          feed, not a winning-attempt-only log.
        </span>
      </p>
      {body}
    </div>
  );
}
