import { ChevronRight } from "lucide-react";
import { Fragment } from "react";

import type { ProgressState } from "../../lib/api/runs";
import { ChipIcon } from "./homeIcons";

export interface PipelineChip {
  id: string;
  label: string;
  role: string;
  kind: string;
  state: ProgressState;
}

/**
 * The pipeline strip (Running now cards, and the team cards' shape): one 22px chip per node in walk
 * order with › between them, "⇄" between a loop's two nodes (HOME-72). `loopBefore` holds the
 * indices whose separator is ⇄. The chip's tooltip is the node's name.
 */
export function RunProgressStrip({
  chips,
  loopBefore,
  label,
}: {
  chips: PipelineChip[];
  loopBefore: Set<number>;
  label?: string;
}) {
  return (
    <div className="hm-chips" role="list" aria-label={label}>
      {chips.map((c, i) => (
        <Fragment key={c.id}>
          {i > 0 &&
            (loopBefore.has(i) ? (
              <span className="hm-chips__loop" aria-hidden="true">
                ⇄
              </span>
            ) : (
              <span className="hm-chips__sep" aria-hidden="true">
                <ChevronRight size={11} strokeWidth={2} />
              </span>
            ))}
          <span
            role="listitem"
            title={c.label}
            aria-label={`${c.label}: ${c.state}`}
            className={`hm-chip hm-chip--${c.state}`}
          >
            <ChipIcon role={c.role} kind={c.kind} />
          </span>
        </Fragment>
      ))}
    </div>
  );
}
