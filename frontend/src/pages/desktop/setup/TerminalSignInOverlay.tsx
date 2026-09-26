import { useEffect, useId, useRef } from "react";

import { Button } from "../../../design-system/components";
import { SpinnerIcon } from "../icons";
import "../desktop.css";

/**
 * DT-23 / OQ-33 (DtF-Run-4): while the vendor's own login runs in Terminal, the app dims its
 * content and shows one strip — "We opened Terminal for you. Finish signing in to <plan> there;
 * this updates on its own." — with Cancel. The Terminal window is the OS's, so the app draws only
 * the scrim and the strip, keeping the Terminal's place above the strip empty.
 *
 * Cancel (and Escape) only stops Tvashtr waiting: it can't close Terminal and doesn't say it does.
 * A modal dialog "Signing in to <plan>" (DT-53): focus starts, and stays, on Cancel.
 */
export function TerminalSignInOverlay({
  plan,
  onCancel,
}: {
  plan: "Claude" | "Grok";
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const stripId = useId();
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  const text = `We opened Terminal for you. Finish signing in to ${plan} there; this updates on its own.`;
  return (
    <div
      className="st-scrim"
      role="dialog"
      aria-modal="true"
      aria-label={`Signing in to ${plan}`}
      aria-describedby={stripId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        } else if (e.key === "Tab") {
          // Cancel is the dialog's only control: keep focus on it (DT-53).
          e.preventDefault();
          cancelRef.current?.focus();
        }
      }}
    >
      <div className="st-scrim__stack">
        <div className="st-scrim__terminal-slot" aria-hidden="true" />
        <div className="st-strip" id={stripId}>
          <SpinnerIcon size={15} />
          {text}
          <Button ref={cancelRef} variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
