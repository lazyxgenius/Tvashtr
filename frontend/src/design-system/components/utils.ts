import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";

import { isTopOverlay, pushOverlay, removeOverlay } from "../../lib/overlayStack";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function initials(name = ""): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

/** Close an anchored overlay on an outside mousedown or Escape. */
export function useDismiss(
  open: boolean,
  onClose: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Joins the shared overlay stack so Escape closes only this menu, not a dialog underneath.
    const token = pushOverlay();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(token)) {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      removeOverlay(token);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

export interface ToastOptions {
  message: ReactNode;
  tone?: "success" | "error";
  /** Shows an "Undo" (or custom) action; the toast closes when it is clicked. */
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss; default 5000 (8000 when there's an action). */
  duration?: number;
}

export const ToastContext = createContext<((t: ToastOptions) => void) | null>(null);

function noopToast() {}

/** Show a toast. Outside a ToastProvider (isolated component tests) it is a harmless no-op. */
export function useToast(): (t: ToastOptions) => void {
  return useContext(ToastContext) ?? noopToast;
}
