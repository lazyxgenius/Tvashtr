import { useRef, useState } from "react";
import { ArrowRight, Check, Clock, Tag, Trash, TriangleAlert } from "lucide-react";

import { useDismiss } from "../design-system/components";
import type { EdgeUse } from "../lib/api/canvas";

const icon = { size: 15, strokeWidth: 1.6, "aria-hidden": true } as const;

/** R13: an agent's time limit — 5 / 10 / 20 (R1's ceiling, the default) / 30 minutes / 1 hour. */
const TIME_LIMITS = [300, 600, 1200, 1800, 3600];
const DEFAULT_TIME_LIMIT_S = 1200;
const timeLabel = (s: number) => (s === 3600 ? "1 hour" : `${Math.round(s / 60)} min`);

/**
 * M11 (Cnv-FailPath / Cnv-FailPathOne / Cnv-TimeLimit): clicking an agent's path opens "Use this
 * path…" — Always / When the agent says… / If it fails or times out (disabled, "it has one", when the
 * agent already has another failure path), then, on the failure path, its agent's Time limit (the
 * choices open beside the menu), and Delete this path.
 */
export function EdgeMenu({
  x,
  y,
  use,
  agentName,
  hasOtherFailure,
  timeLimitS: limit,
  onUse,
  onTimeLimit,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  use: EdgeUse;
  agentName: string;
  hasOtherFailure: boolean;
  /** The agent's `config.time_limit_s` (unset: the default). */
  timeLimitS?: number | null;
  onUse: (use: EdgeUse) => void;
  onTimeLimit: (seconds: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const timeLimitS = limit ?? DEFAULT_TIME_LIMIT_S;
  const ref = useRef<HTMLDivElement>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  useDismiss(true, onClose, ref);
  const pick = (next: EdgeUse) => {
    onClose();
    if (next !== use) onUse(next);
  };
  const item = (key: EdgeUse, label: string, Icon: typeof Tag, end?: string, disabled = false) => (
    <button
      type="button"
      role="menuitem"
      className={`cv-pmenu__item${use === key ? " cv-pmenu__item--on" : ""}`}
      disabled={disabled}
      onClick={() => pick(key)}
    >
      <span className="cv-pmenu__icon">
        <Icon {...icon} />
      </span>
      {label}
      {end && <span className="cv-pmenu__end">{end}</span>}
    </button>
  );
  const failureTaken = hasOtherFailure && use !== "failure";

  return (
    <div ref={ref} className="cv-pmenu-anchor nodrag nopan" style={{ left: x, top: y }}>
      <div role="menu" aria-label="Use this path" className="cv-pmenu">
        <div className="cv-pmenu__head">Use this path…</div>
        {item("forward", "Always", ArrowRight)}
        {item("branch", "When the agent says…", Tag, "an outcome")}
        {item(
          "failure",
          "If it fails or times out",
          TriangleAlert,
          failureTaken ? "it has one" : undefined,
          failureTaken,
        )}
        <div className="cv-pmenu__sep" role="separator" />
        {use === "failure" && (
          <div className="cv-pmenu__sub">
            <button
              type="button"
              role="menuitem"
              className="cv-pmenu__item"
              aria-haspopup="menu"
              aria-expanded={limitsOpen}
              onClick={() => setLimitsOpen((o) => !o)}
            >
              <span className="cv-pmenu__icon">
                <Clock {...icon} />
              </span>
              Time limit
              <span className="cv-pmenu__end">{timeLabel(timeLimitS)}</span>
            </button>
            {limitsOpen && (
              <div role="menu" aria-label="Time limit" className="cv-pmenu cv-pmenu--limits">
                <div className="cv-pmenu__note">
                  If the {agentName} works longer, it stops and this path is taken.
                </div>
                {TIME_LIMITS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="menuitemradio"
                    aria-checked={s === timeLimitS}
                    className={`cv-pmenu__item${s === timeLimitS ? " cv-pmenu__item--on" : ""}`}
                    onClick={() => {
                      onClose();
                      if (s !== timeLimitS) onTimeLimit(s);
                    }}
                  >
                    <span className="cv-pmenu__check">
                      {s === timeLimitS && <Check size={14} strokeWidth={1.6} aria-hidden />}
                    </span>
                    {timeLabel(s)}
                    {s === DEFAULT_TIME_LIMIT_S && (
                      <span className="cv-pmenu__end">the default</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          role="menuitem"
          className="cv-pmenu__item cv-pmenu__item--danger"
          onClick={() => {
            onClose();
            onDelete();
          }}
        >
          <span className="cv-pmenu__icon">
            <Trash {...icon} />
          </span>
          Delete this path
        </button>
      </div>
    </div>
  );
}
