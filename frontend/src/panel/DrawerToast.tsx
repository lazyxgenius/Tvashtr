import { useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";

import { TOAST_MS, type ToastSpec } from "./useDrawerToast";

/**
 * The drawer's dark toast (Flow-Templates-3, Flow-Routing-3): 16px from each side of the aside, 70px
 * up (just above the save footer). The live region is always there, so screen readers hear each
 * message; the toast hides after about 6s, holds while the pointer or focus is on it, and its action
 * (Undo, Open Engines…) closes it.
 */
export function DrawerToast({
  toast,
  onDismiss,
  duration = TOAST_MS,
}: {
  toast: ToastSpec | null;
  onDismiss: () => void;
  duration?: number;
}) {
  return (
    <div className="nd-toast-host" role="status" aria-live="polite">
      {toast && (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
      )}
    </div>
  );
}

function ToastCard({
  toast,
  onDismiss,
  duration,
}: {
  toast: ToastSpec;
  onDismiss: () => void;
  duration: number;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const stop = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    remaining.current -= Date.now() - startedAt.current;
  };
  const start = () => {
    if (timer.current !== null) return;
    startedAt.current = Date.now();
    timer.current = setTimeout(() => dismissRef.current(), Math.max(0, remaining.current));
  };

  useEffect(() => {
    start();
    return stop;
    // One timer per toast (the card remounts for each).
  }, []);

  return (
    <div
      className="nd-toast"
      onMouseEnter={stop}
      onMouseLeave={start}
      onFocus={stop}
      onBlur={start}
    >
      <span className="nd-toast__icon" aria-hidden>
        <CircleCheck size={14} strokeWidth={1.6} />
      </span>
      <span className="nd-toast__text">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="nd-toast__action"
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
