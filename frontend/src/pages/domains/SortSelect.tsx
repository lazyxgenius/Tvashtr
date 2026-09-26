/**
 * The Domains list's "Sort" picker (DM-8). At rest it draws as the design system's Select, as
 * Dm-List, DmF-Find-1 and DmF-Find-2 show it; open, it is DmF-Find-3's listbox (220px, the
 * current choice ticked). Arrow keys move, Enter / Space pick, Escape and an outside click close.
 */
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cx, useDismiss } from "../../design-system/components/utils";

export interface SortOption<V extends string> {
  value: V;
  label: string;
}

export function SortSelect<V extends string>({
  value,
  options,
  onChange,
  labelId,
}: {
  value: V;
  options: SortOption<V>[];
  onChange: (value: V) => void;
  /** The id of the visible "Sort" label beside the picker. */
  labelId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const [active, setActive] = useState(selected);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const valueId = useId();
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  useDismiss(open, () => close(true), wrapRef);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  const openList = () => {
    setActive(selected);
    setOpen(true);
  };

  const pick = (i: number) => {
    const opt = options[i];
    if (opt && opt.value !== value) onChange(opt.value);
    close(true);
  };

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") pick(active);
    else if (e.key === "Tab") {
      close(false);
      return;
    } else return;
    e.preventDefault();
  };

  const label = options[selected]?.label ?? "";
  return (
    <div className="dm-sort" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx("dm-sort__btn", open ? "dm-sort__btn--open" : "ds-select")}
        // At rest the control is named "Sort" (the design system's Select); open, it reads
        // "Sort <choice>" from the visible label and value, as DmF-Find-3 draws it.
        aria-label={open ? undefined : "Sort"}
        aria-labelledby={open ? `${labelId} ${valueId}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={onButtonKey}
      >
        <span id={valueId} className="dm-sort__value">
          {label}
        </span>
        <ChevronDown
          className="dm-sort__chevron"
          size={open ? 15 : 16}
          strokeWidth={1.6}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Sort"
          tabIndex={-1}
          aria-activedescendant={optionId(active)}
          className="dm-listbox"
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              className={cx("dm-option", i === active && "dm-option--active")}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
            >
              {i === selected ? (
                <Check className="dm-option__check" size={15} strokeWidth={2} aria-hidden />
              ) : (
                <span className="dm-option__spacer" />
              )}
              <span className="dm-option__label">{o.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
