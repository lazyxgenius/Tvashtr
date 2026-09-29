import { type RefObject, useEffect, useId, useRef } from "react";

import { Button } from "../../design-system/components";
import { useRowPopover } from "./rowPopover";
import { ACCESS_CONFIRM_BODY } from "./setupCopy";

/**
 * Flow-Access-1: switching an agent that routes on a verdict to "Can edit files" asks first (Q6;
 * other agents switch directly). The popover opens above the File access row; "Keep read-only",
 * Escape or a click elsewhere leaves it read-only.
 */
export function AccessConfirm({
  agentName,
  onAllow,
  onKeep,
  anchorRef,
  triggerRef,
}: {
  agentName: string;
  onAllow: () => void;
  onKeep: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();
  const title = `Let ${agentName} change files?`;
  useRowPopover({ onClose: onKeep, anchorRef, popoverRef: ref, triggerRef });
  // The safe choice has focus, so Enter keeps it read-only.
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-label={title}
      aria-describedby={bodyId}
      className="nd-pop nd-pop--access"
    >
      <div className="nd-pop__heading">{title}</div>
      <div className="nd-pop__body" id={bodyId}>
        {ACCESS_CONFIRM_BODY}
      </div>
      <div className="nd-pop__actions">
        <Button ref={keepRef} variant="ghost" size="sm" onClick={onKeep}>
          Keep read-only
        </Button>
        <Button variant="primary" size="sm" onClick={onAllow}>
          Allow edits
        </Button>
      </div>
    </div>
  );
}
