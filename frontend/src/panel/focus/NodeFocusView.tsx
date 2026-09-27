import type { ReactNode } from "react";

import { useModalDialog } from "../../lib/useModalDialog";
import "./focus.css";

/**
 * Focus mode (Desktop-Focus, PANEL-100): the agent's settings as a 1240px dialog over the dimmed
 * canvas — the same header badges, tabs and Save footer as the drawer, editing the same draft (the
 * controller owns it, so docking back keeps every change). Focus is trapped inside; Escape docks it
 * back to the side.
 */
export function NodeFocusView({
  name,
  header,
  tabs,
  footer,
  children,
  scroll = false,
  toast,
  overlay,
  onDock,
}: {
  name: string;
  header: ReactNode;
  tabs: ReactNode;
  footer: ReactNode;
  children: ReactNode;
  /** The body scrolls as one column (a Skills sheet); the tabs lay out their own scrolling panes. */
  scroll?: boolean;
  toast?: ReactNode;
  overlay?: ReactNode;
  /** Escape. */
  onDock: () => void;
}) {
  const dialogRef = useModalDialog<HTMLElement>(true, onDock);
  return (
    <div className="fx-layer">
      <div className="fx-scrim" aria-hidden />
      <section
        ref={dialogRef}
        className="fx-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} in focus view`}
      >
        {header}
        <div className="fx-tabs">{tabs}</div>
        <div className={`fx-body${scroll ? " fx-body--scroll" : ""}`} role="tabpanel">
          {children}
        </div>
        {footer}
        {toast}
        {overlay}
      </section>
    </div>
  );
}
