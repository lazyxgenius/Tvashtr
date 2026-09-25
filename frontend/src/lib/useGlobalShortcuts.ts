/**
 * Dashboard-wide keyboard shortcuts (TEAMS-59): ⌘K / Ctrl+K opens search, N starts a run, T opens
 * New team, ? shows the shortcuts. Single keys are ignored while typing, while a dialog is open,
 * and whenever Meta, Ctrl or Alt is held — so ⌘N / ⌘T stay with the browser or the OS.
 */
import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  onSearch: () => void;
  onNewRun: () => void;
  onNewTeam: () => void;
  onShowShortcuts: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"], [role="alertdialog"]') !== null;
}

export function useGlobalShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current.onSearch();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || modalOpen()) return;
      const key = e.key;
      if (key === "?") ref.current.onShowShortcuts();
      else if (key === "n" || key === "N") ref.current.onNewRun();
      else if (key === "t" || key === "T") ref.current.onNewTeam();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
