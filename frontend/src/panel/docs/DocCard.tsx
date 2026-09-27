import { FileText, Pin } from "lucide-react";

import { Button } from "../../design-system/components";
import "./docs.css";

/**
 * One document as a card (the Docs tab and the Documents drawer): title, who writes or reads it,
 * Open, and the version line. The shared spec's card is coral with "Shared · everyone reads this".
 */
export function DocCard({
  title,
  sub,
  meta,
  shared = false,
  onOpen,
}: {
  title: string;
  sub: string;
  meta?: string;
  shared?: boolean;
  onOpen?: () => void;
}) {
  return (
    <li className={`nd-doc${shared ? " nd-doc--shared" : ""}`}>
      {shared && (
        <span className="nd-doc__eyebrow">
          <Pin size={11} strokeWidth={1.6} aria-hidden />
          Shared · everyone reads this
        </span>
      )}
      <div className="nd-doc__row">
        <span className="nd-doc__icon">
          <FileText size={15} strokeWidth={1.6} aria-hidden />
        </span>
        <div className="nd-doc__id">
          <div className="nd-doc__title">{title}</div>
          <div className="nd-doc__sub">{sub}</div>
        </div>
        {onOpen && (
          <Button variant="secondary" size="sm" onClick={onOpen}>
            Open
          </Button>
        )}
      </div>
      {meta && <div className="nd-doc__meta">{meta}</div>}
    </li>
  );
}
