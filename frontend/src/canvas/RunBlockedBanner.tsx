import { AlertTriangle } from "lucide-react";

import { Button } from "../design-system/components";
import type { RunBlock } from "./runBlocked";

/** The warn callout over the canvas when the team can't run (Eng-Flow-Blocked-1). */
export function RunBlockedBanner({
  block,
  onOpenEngines,
  onMakeThinker,
}: {
  block: RunBlock;
  onOpenEngines?: () => void;
  /** An Agent is the first node: the palette has no Thinker, so the callout offers the fix. */
  onMakeThinker?: () => void;
}) {
  return (
    <div className="cv-blocked" role="status" data-testid="run-blocked">
      <span className="cv-blocked__icon" aria-hidden>
        <AlertTriangle size={16} strokeWidth={1.8} />
      </span>
      <span className="cv-blocked__text">
        <b>{block.title}</b> {block.detail}
      </span>
      {onMakeThinker && (
        <Button variant="primary" size="sm" onClick={onMakeThinker}>
          Make it the starting thinker
        </Button>
      )}
      {block.openEngines && onOpenEngines && (
        <Button variant="primary" size="sm" onClick={onOpenEngines}>
          Open Engines
        </Button>
      )}
    </div>
  );
}
