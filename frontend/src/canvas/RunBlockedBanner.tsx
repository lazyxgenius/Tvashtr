import { AlertTriangle } from "lucide-react";

import { Button } from "../design-system/components";
import type { RunBlock } from "./runBlocked";

/** The warn callout over the canvas when the team can't run (Eng-Flow-Blocked-1). */
export function RunBlockedBanner({
  block,
  onOpenEngines,
}: {
  block: RunBlock;
  onOpenEngines?: () => void;
}) {
  return (
    <div className="cv-blocked" role="status" data-testid="run-blocked">
      <span className="cv-blocked__icon" aria-hidden>
        <AlertTriangle size={16} strokeWidth={1.8} />
      </span>
      <span className="cv-blocked__text">
        <b>{block.title}</b> {block.detail}
      </span>
      {block.openEngines && onOpenEngines && (
        <Button variant="primary" size="sm" onClick={onOpenEngines}>
          Open Engines
        </Button>
      )}
    </div>
  );
}
