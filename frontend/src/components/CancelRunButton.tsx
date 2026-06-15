import { useEffect, useState } from "react";

/**
 * The kill switch as a two-step affordance (no jarring `window.confirm`):
 * "Cancel run" arms a "Confirm cancel" button that auto-disarms after a few
 * seconds, so an accidental click can't stop a run.
 */
export function CancelRunButton({
  onCancel,
  disabled = false,
}: {
  onCancel: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  // Auto-disarm so a stray "armed" state doesn't linger as a hair-trigger.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button className="tv-btn tv-btn--ghost" onClick={() => setArmed(true)} disabled={disabled}>
        Cancel run
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-3">
      <button
        className="tv-btn tv-btn--danger"
        onClick={() => {
          setArmed(false);
          onCancel();
        }}
        disabled={disabled}
      >
        Confirm cancel
      </button>
      <button className="tv-btn--link" onClick={() => setArmed(false)}>
        Keep running
      </button>
    </span>
  );
}
