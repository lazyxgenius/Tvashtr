import { useEffect, useRef } from "react";

// The elements a keyboard user can Tab through — the standard focus-trap set. `:not([disabled])`
// prunes disabled controls; the `[tabindex="-1"]` exclusion + the `tabIndex` filter drop nodes that
// are programmatically focusable but not tabbable.
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

/**
 * A shared modal focus-trap for scrim dialogs. When `active` it:
 *   - moves focus into the returned container ref (its first focusable, else the container),
 *   - traps Tab / Shift+Tab within that container with an EXPLICIT wrap at the ends — so the trap is
 *     observable under jsdom, which does not move focus on Tab natively,
 *   - closes on Escape via `onClose`,
 *   - restores focus to the previously-focused element when it deactivates or unmounts.
 * When inactive it is completely inert: no listener, no focus change (a docked panel stays untouched).
 *
 * Returns the ref to attach to the dialog container element — `<div ref={ref}>` / `<aside ref={ref}>`.
 */
export function useModalDialog<T extends HTMLElement = HTMLElement>(
  active: boolean,
  onClose: () => void,
) {
  const containerRef = useRef<T>(null);
  // Track the latest `onClose` without re-arming the trap: the effect keys only on `active`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus into the dialog.
    const initial = focusableWithin(container);
    if (initial.length > 0) initial[0].focus();
    else container.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusableWithin(container);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      // Explicit wrap at the boundaries (and reclaim focus if it has escaped the container);
      // interior Tab moves fall through to the browser's native tab order.
      if (e.shiftKey) {
        if (activeEl === first || !container.contains(activeEl)) {
          e.preventDefault();
          last.focus();
        }
      } else if (activeEl === last || !container.contains(activeEl)) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever was focused before the dialog opened.
      if (previouslyFocused && previouslyFocused.isConnected) previouslyFocused.focus();
    };
  }, [active]);

  return containerRef;
}
