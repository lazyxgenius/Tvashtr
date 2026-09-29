/**
 * The Access & documents popovers (the File access confirm, the Reads and Writes pickers) open
 * upward from their Setup row, inside the drawer body, and are mounted only while open. This hook
 * closes one on an outside mousedown or Escape (through the shared overlay stack, so Escape closes
 * only the top overlay), brings it into view when the body is scrolled past it, and hands focus
 * back to its trigger when it closes with focus inside it.
 */
import { type RefObject, useEffect } from "react";

import { useDismiss } from "../../design-system/components";

export function useRowPopover({
  onClose,
  anchorRef,
  popoverRef,
  triggerRef,
}: {
  onClose: () => void;
  /** The row the popover belongs to: clicks inside it (the trigger too) don't dismiss it. */
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  /** Focus goes back here when the popover closes (if it's still on the page). */
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  useDismiss(true, onClose, anchorRef);
  useEffect(() => {
    popoverRef.current?.scrollIntoView?.({ block: "nearest" });
    const trigger = triggerRef?.current;
    return () => {
      // The popover is gone: if it held focus, focus fell to the page — put it back on the trigger.
      // (A click elsewhere keeps its own focus.)
      const active = document.activeElement;
      if (trigger?.isConnected && (active === null || active === document.body)) trigger.focus();
    };
  }, [popoverRef, triggerRef]);
}
