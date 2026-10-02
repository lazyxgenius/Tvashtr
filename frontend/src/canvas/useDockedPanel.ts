import { useEffect, useRef } from "react";

import { isTopOverlay, pushOverlay, removeOverlay } from "../lib/overlayStack";

/**
 * A docked canvas panel (Team file, History): opening it takes focus (on the returned Close ref),
 * closing gives it back; Escape closes it unless something on top of it owns the keyboard.
 */
export function useDockedPanel(onClose: () => void) {
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const token = pushOverlay();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopOverlay(token)) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      removeOverlay(token);
      if (before?.isConnected) before.focus();
    };
  }, []);
  return close;
}
