/**
 * Settings' Reading model picker (DM-82). At rest it draws as the design system's Select, 340px
 * (Dm-Settings, DmF-Embed-2); open, it is DmF-Embed-1's 40px trigger with the 460px listbox under
 * it — each model with "<dim> · <tagline>" and its key tag (`ReadingModelOptions`, shared with the
 * New domain dialog). Arrow keys move, Enter / Space / a click pick, Escape and an outside click
 * close.
 */
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cx, useDismiss } from "../../design-system/components/utils";
import { ReadingModelOptions } from "./ReadingModelOptions";
import { readingModel } from "./readingModels";

export function ReadingModelSelect({
  value,
  held,
  labelId,
  onChange,
}: {
  value: string;
  /** The providers the account holds keys for; `null` while loading. */
  held: string[] | null;
  /** The visible "Reading model" label, which names the open trigger with its value. */
  labelId: string;
  onChange: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const valueId = useId();

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  useDismiss(open, close, wrapRef);

  useEffect(() => {
    if (!open) return;
    wrapRef.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.focus();
  }, [open]);

  return (
    <div className="dm-rmselect" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx("dm-sort__btn", open ? "dm-sort__btn--open" : "ds-select")}
        aria-label={open ? undefined : "Reading model"}
        aria-labelledby={open ? `${labelId} ${valueId}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span id={valueId} className="dm-sort__value">
          {readingModel(value).label}
        </span>
        <ChevronDown
          className="dm-sort__chevron"
          size={open ? 15 : 16}
          strokeWidth={1.6}
          aria-hidden
        />
      </button>
      {open && (
        <div className="dm-rmselect__pop">
          <ReadingModelOptions
            value={value}
            held={held}
            onPick={(slug) => {
              if (slug !== value) onChange(slug);
              close();
            }}
          />
        </div>
      )}
    </div>
  );
}
