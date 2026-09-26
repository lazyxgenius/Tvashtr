import type { ReactNode } from "react";

import { useModalDialog } from "../lib/useModalDialog";

/**
 * The agent drawer shell (PANEL-10): a 384px `aside "<Name> settings"` — header, tabs, a body that
 * scrolls on its own, and a pinned footer. Above 1280px it docks and pushes the canvas; at 1280px
 * or less it floats over the canvas with a left shadow (CSS). `variant="focus"` shows the same
 * content as a centred dialog ("<Name> in focus view") with a focus trap; Esc docks it back.
 */
export function NodeDrawer({
  name,
  variant = "dock",
  header,
  tabs,
  footer,
  children,
  bare = false,
  overlay,
  toast,
  onDismissFocus,
}: {
  name: string;
  variant?: "dock" | "focus";
  header: ReactNode;
  tabs?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** The children own their padding and scroll (the older gate / endpoint bodies). */
  bare?: boolean;
  /** A drawer-scoped confirm (`DrawerConfirm`), drawn over the drawer only. */
  overlay?: ReactNode;
  /** The drawer's toast host (`DrawerToast`), just above the footer. */
  toast?: ReactNode;
  /** Esc in the focus view (dock back). */
  onDismissFocus?: () => void;
}) {
  const focus = variant === "focus";
  const dialogRef = useModalDialog<HTMLElement>(focus, () => onDismissFocus?.());
  const body = (
    <>
      {header}
      {tabs}
      <div
        className={`nd-body${bare ? " nd-body--bare" : ""}`}
        role={tabs ? "tabpanel" : undefined}
      >
        {bare ? children : <div className="nd-body__inner">{children}</div>}
      </div>
      {footer}
      {toast}
      {overlay}
    </>
  );
  if (focus) {
    return (
      <div className="nd-focus-scrim">
        <section
          ref={dialogRef}
          className="nd-drawer nd-drawer--focus"
          role="dialog"
          aria-modal="true"
          aria-label={`${name} in focus view`}
        >
          {body}
        </section>
      </div>
    );
  }
  return (
    <aside className="nd-drawer nd-drawer--dock" aria-label={`${name} settings`}>
      {body}
    </aside>
  );
}
