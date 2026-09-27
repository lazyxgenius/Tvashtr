import { type ReactNode, useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "../../design-system/components";

/**
 * A view that takes the whole Setup body in focus mode (Focus-AgentSees, Focus-ReviewChanges): a
 * title, a one-line lede and "Back to editing" that stay put, then a scrolling column of cards.
 * Opening it moves the keyboard to "Back to editing"; Escape (the focus view's) also goes back.
 */
export function FocusSubView({
  variant,
  title,
  lede,
  onBack,
  children,
}: {
  variant: "preview" | "review";
  title: string;
  lede: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className={`fx-sub fx-sub--${variant}`} role="region" aria-label={title}>
      <div className="fx-sub__head">
        <div>
          <h3 className="fx-sub__title">{title}</h3>
          <p className="fx-sub__lede">{lede}</p>
        </div>
        <Button ref={backRef} variant="ghost" size="sm" className="nd-btn-flush" onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.6} aria-hidden />
          <span>Back to editing</span>
        </Button>
      </div>
      <div className="fx-sub__list">{children}</div>
    </div>
  );
}
