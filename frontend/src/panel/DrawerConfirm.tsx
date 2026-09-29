import { type ReactNode, useId } from "react";

import { useModalDialog } from "../lib/useModalDialog";

/**
 * A confirm that belongs to the drawer, not the page (the design's in-drawer alertdialog): it
 * covers only the aside, traps focus, and joins the shared overlay stack so Escape (= `onCancel`)
 * closes it and nothing under it.
 * - `center` (Flow-More-2 "Delete Reviewer?"): a 0.28 scrim over the aside, the card 250px down,
 *   16px from each side.
 * - `footer` (Panel-CloseUnsaved "Save your changes to Reviewer?"): the card just above the save
 *   footer, 12px from each side; the drawer stays visible (a clear scrim still catches clicks, which
 *   mean "keep editing").
 */
export function DrawerConfirm({
  title,
  children,
  actions,
  onCancel,
  placement = "center",
  label,
}: {
  title: string;
  children: ReactNode;
  /** The buttons, right-aligned (cancel first, the action last). */
  actions: ReactNode;
  onCancel: () => void;
  placement?: "center" | "footer";
  /** The dialog's accessible name (default: the title). */
  label?: string;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onCancel);
  const bodyId = useId();
  return (
    <>
      <div
        className={`nd-scrim${placement === "footer" ? " nd-scrim--clear" : ""}`}
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault();
          onCancel();
        }}
      />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={label ?? title}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`nd-confirm nd-confirm--${placement}`}
      >
        <div className="nd-confirm__title">{title}</div>
        <div className="nd-confirm__body" id={bodyId}>
          {children}
        </div>
        <div className="nd-confirm__actions">{actions}</div>
      </div>
    </>
  );
}
