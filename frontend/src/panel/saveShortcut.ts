import { useEffect, useRef } from "react";

/** "⌘S" on macOS, "Ctrl S" elsewhere (Desktop reports its platform; the web reads the browser's). */
export function saveShortcutLabel(): string {
  const platform =
    window.tvashtrDesktopInfo?.platform ??
    (typeof navigator !== "undefined" ? navigator.platform : "");
  return /mac|darwin/i.test(platform) ? "⌘S" : "Ctrl S";
}

/** ⌘S / Ctrl+S (either modifier works on every platform). */
export function isSaveShortcut(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s";
}

/**
 * While the drawer is open, ⌘S / Ctrl+S calls `onSave` instead of the browser's "Save page"
 * (PANEL-19). `onSave` decides whether there is anything to save.
 */
export function useSaveShortcut(onSave: () => void): void {
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSaveShortcut(e)) return;
      e.preventDefault();
      saveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
