import { Check, ChevronDown } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Popover } from "../../design-system/components";
import type { FilterOption } from "./memoryModel";

/** The open list's options (the Popover renders them next to the trigger). */
const optionsNear = (trigger: HTMLElement | null): HTMLButtonElement[] =>
  Array.from(trigger?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);

/**
 * One of the Active tab's filters (TkF-Filters-1…3): a select-looking trigger (the DS Select's
 * size, 44px / 16px) that opens a listbox of options with a check on the current one. Built on the
 * DS Popover rather than a native <select> so the open list is part of the page (the design draws
 * it; a native popup can't be styled or screenshotted). The trigger is a select-only combobox: its
 * name is `label`, its value the option shown.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
  listWidth,
}: {
  label: string;
  value: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  className?: string;
  /** The open list's outer width (the design's content width + 5px padding + 1px border). */
  listWidth: number;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  // Opening puts focus on the chosen option, like a native select.
  useEffect(() => {
    if (!open) return;
    const els = optionsNear(trigger.current);
    (els.find((el) => el.getAttribute("aria-selected") === "true") ?? els[0])?.focus();
  }, [open]);

  const close = () => {
    const inside = trigger.current?.parentElement?.contains(document.activeElement);
    setOpen(false);
    if (inside) trigger.current?.focus();
  };

  const pick = (v: string) => {
    setOpen(false);
    trigger.current?.focus();
    if (v !== value) onChange(v);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const els = optionsNear(trigger.current);
    const at = els.indexOf(document.activeElement as HTMLButtonElement);
    const to =
      e.key === "ArrowDown"
        ? Math.min(at + 1, els.length - 1)
        : e.key === "ArrowUp"
          ? Math.max(at - 1, 0)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? els.length - 1
              : null;
    if (to === null) {
      if (e.key === "Tab") setOpen(false);
      return;
    }
    e.preventDefault();
    els[to]?.focus();
  };

  return (
    <span className={className}>
      <Popover
        open={open}
        onClose={close}
        width={listWidth}
        role="listbox"
        label={label}
        className="mem-filter__list"
        trigger={
          <button
            ref={trigger}
            type="button"
            role="combobox"
            aria-label={label}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="mem-filter"
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span className="mem-filter__value">{current?.label}</span>
            <ChevronDown className="mem-filter__chev" size={16} strokeWidth={1.6} aria-hidden />
          </button>
        }
      >
        <div className="mem-filter__opts" onKeyDown={onListKey}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === current?.value}
              className="mem-filter__opt"
              onClick={() => pick(o.value)}
            >
              <span className="mem-filter__check">
                {o.value === current?.value && <Check size={13} strokeWidth={2} aria-hidden />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      </Popover>
    </span>
  );
}
