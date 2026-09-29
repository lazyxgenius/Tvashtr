import { type RefObject, useId, useRef, useState } from "react";

import { Button, Input } from "../../design-system/components";
import { DOC_NAME_MAX, type KnownDocument, writerLine } from "./documents";
import { useRowPopover } from "./rowPopover";

/**
 * Flow-Writes-1 (PANEL-55): "The one document it writes". Nothing (the default), a document the
 * team already knows, or a new name ("Use <name>"). Picking closes the popover (the row says when
 * a name is new to the team, PANEL-56).
 */
export function WritesPicker({
  value,
  documents,
  onPick,
  onClose,
  anchorRef,
  triggerRef,
}: {
  /** The current Writes name ("" = nothing). */
  value: string;
  /** The documents it could write (not the shared spec). */
  documents: readonly KnownDocument[];
  onPick: (name: string) => void;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const group = useId();
  const [name, setName] = useState("");
  useRowPopover({ onClose, anchorRef, popoverRef: ref, triggerRef });
  const typed = name.trim();
  const use = () => {
    if (typed) onPick(typed);
  };
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="The one document it writes"
      className="nd-pop nd-pop--writes"
    >
      <div className="nd-pop__title">The one document it writes</div>
      <div role="radiogroup" aria-label="The one document it writes" className="nd-pop__group">
        <label className="nd-pop__opt">
          <input
            type="radio"
            name={group}
            className="nd-pop__radio"
            checked={value === ""}
            onChange={() => onPick("")}
          />
          <span className="nd-pop__name">Nothing</span>
          <span className="nd-pop__note">default</span>
        </label>
        {documents.map((doc) => (
          <label key={doc.name} className="nd-pop__opt">
            <input
              type="radio"
              name={group}
              className="nd-pop__radio"
              checked={value === doc.name}
              onChange={() => onPick(doc.name)}
            />
            <span className="nd-pop__name">{doc.name}</span>
            <span className="nd-pop__note">{writerLine(doc)}</span>
          </label>
        ))}
      </div>
      <Input
        size="sm"
        placeholder="New document name"
        aria-label="New document name"
        maxLength={DOC_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            use();
          }
        }}
      />
      {typed && (
        <div className="nd-pop__actions">
          <Button variant="primary" size="sm" onClick={use}>
            Use {typed}
          </Button>
        </div>
      )}
    </div>
  );
}
