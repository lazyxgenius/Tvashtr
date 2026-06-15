import { Check } from "lucide-react";

import type { NodeStatus } from "../lib/status";

const LABELS: Record<NodeStatus, string> = {
  idle: "Waiting",
  running: "Working…",
  paused: "Awaiting approval",
  done: "Done",
  stopped: "Stopped",
  failed: "Failed",
};

/** Dot + sentence-case label, in the DS Badge vocabulary. */
export function StatusPill({ status }: { status: NodeStatus }) {
  return (
    <span className={`tv-pill tv-pill--${status}`}>
      {status === "done" ? (
        <Check size={12} strokeWidth={2.25} />
      ) : (
        <span className="tv-pill__dot" />
      )}
      {LABELS[status]}
    </span>
  );
}
