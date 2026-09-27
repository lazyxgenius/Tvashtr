/**
 * The drawer's toast state (PANEL-102): one toast at a time, a new one replaces the last. The toast
 * itself (`DrawerToast`) hides after about 6s and pauses while hovered.
 */
import { useCallback, useRef, useState } from "react";

/** How long a toast stays up (without hover). */
export const TOAST_MS = 6000;

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastSpec {
  /** Changes with every toast, so a repeat of the same words restarts the timer. */
  id: number;
  message: string;
  action?: ToastAction;
}

export interface DrawerToastApi {
  toast: ToastSpec | null;
  show: (message: string, action?: ToastAction) => void;
  dismiss: () => void;
}

export function useDrawerToast(): DrawerToastApi {
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const next = useRef(0);
  const show = useCallback((message: string, action?: ToastAction) => {
    next.current += 1;
    setToast({ id: next.current, message, action });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}
