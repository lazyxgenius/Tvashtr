import { type ReactNode, useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";

import { IconButton } from "../design-system/components";

/**
 * An in-drawer sheet with a Back header (the Output format editor; the add-skill and add-tool forms
 * reuse it). It takes the place of the drawer's body AND its Save footer: its own body scrolls, and
 * its `actions` (Cancel / Done …) sit in a footer pinned under it. In the focus view it fills the
 * settings column the same way.
 */
export function SubView({
  title,
  titleId,
  onBack,
  children,
  actions,
}: {
  title: string;
  /** The title's id, for a field inside to be labelled by it. */
  titleId?: string;
  /** Back (the same as the sheet's own Cancel). */
  onBack: () => void;
  children: ReactNode;
  /** The footer's buttons, right-aligned. */
  actions: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  // Opening a sheet moves the keyboard into it (unless something inside has already taken focus).
  useEffect(() => {
    const sheet = backRef.current?.closest(".nd-sub");
    if (sheet && !sheet.contains(document.activeElement)) backRef.current?.focus();
  }, []);
  return (
    <div className="nd-sub" role="region" aria-label={title}>
      <div className="nd-sub__body">
        <div className="nd-sub__stack">
          <div className="nd-sub__head">
            <IconButton ref={backRef} size="sm" aria-label="Back" title="Back" onClick={onBack}>
              <ChevronLeft size={16} strokeWidth={1.6} />
            </IconButton>
            <span id={titleId} className="nd-sub__title">
              {title}
            </span>
          </div>
          {children}
        </div>
      </div>
      <footer className="nd-sub__foot">{actions}</footer>
    </div>
  );
}
