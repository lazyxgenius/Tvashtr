/** The Models dialogs' frame, from the design: 560 wide, a serif title with a line under it, a
 *  bordered ✕, the body, and the actions under a line. */
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { useModalDialog } from "../../lib/useModalDialog";

export function ModelDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  top = 84,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  top?: number;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  return createPortal(
    <>
      <div className="ds-scrim" onClick={onClose} aria-hidden />
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="md-dialog"
        style={{ top, maxHeight: `calc(100vh - ${top + 16}px)` }}
        tabIndex={-1}
      >
        <div className="md-dialog__head">
          <div className="md-dialog__titles">
            <h2 className="md-dialog__title">{title}</h2>
            {subtitle && <p className="md-dialog__sub">{subtitle}</p>}
          </div>
          <button type="button" className="md-ctl" aria-label="Close" onClick={onClose}>
            <X size={15} strokeWidth={1.7} aria-hidden />
          </button>
        </div>
        <div className="md-dialog__body">{children}</div>
        {footer && <div className="md-dialog__foot">{footer}</div>}
      </section>
    </>,
    document.body,
  );
}
