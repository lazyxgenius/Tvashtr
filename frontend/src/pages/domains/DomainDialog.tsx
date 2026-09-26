/**
 * The Domains dialogs' shared frame (Rename 460, Delete domain 500, Delete file 500, Add step and
 * Give access 560): scrim, serif title (+ an optional subtitle) with Close, a body and a footer with
 * a hairline above it — border-box, pinned `top` px from the window's top where the frames draw it
 * (DmF-Menu-2/3, DmF-DelFile-2, DmF-Step-2/3, DmF-Agent-2). Escape and the scrim
 * close it unless `locked`; focus is trapped inside.
 */
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { IconButton } from "../../design-system/components";
import { useModalDialog } from "../../lib/useModalDialog";
import "./menus.css";

export function DomainDialog({
  title,
  subtitle,
  width,
  top,
  locked = false,
  onClose,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  /** A line under the title (the 560 dialogs, DmF-Step-2, DmF-Agent-2). */
  subtitle?: string;
  width: number;
  top: number;
  /** While saving: Escape, the scrim and Close do nothing. */
  locked?: boolean;
  onClose: () => void;
  /** Makes the frame a form, so Enter in a field submits it. */
  onSubmit?: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, () => {
    if (!locked) onClose();
  });
  const style = { "--dm-dlg-w": `${width}px`, "--dm-dlg-top": `${top}px` } as CSSProperties;
  const body = (
    <>
      <header className="dm-dlg__head">
        {subtitle ? (
          <div className="dm-dlg__titles">
            <h2 className="dm-dlg__title">{title}</h2>
            <p className="dm-dlg__sub">{subtitle}</p>
          </div>
        ) : (
          <h2 className="dm-dlg__title">{title}</h2>
        )}
        <IconButton size="sm" aria-label="Close" onClick={onClose} disabled={locked}>
          <X size={16} strokeWidth={1.6} aria-hidden />
        </IconButton>
      </header>
      <div className="dm-dlg__body">{children}</div>
      <footer className="dm-dlg__foot">{footer}</footer>
    </>
  );
  return createPortal(
    <>
      <div className="ds-scrim" onClick={() => !locked && onClose()} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="ds-dialog dm-dlg"
        style={style}
        tabIndex={-1}
      >
        {onSubmit ? (
          <form
            className="dm-dlg__form"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </>,
    document.body,
  );
}
