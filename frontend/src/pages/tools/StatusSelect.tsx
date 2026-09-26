/**
 * The Tools list's Status filter (TkF-ToolSearch-2): looks like the design system's Select and
 * opens a small listbox — All statuses / Ready / Needs attention — with a check on the current one.
 * Arrow keys move between options, Escape or an outside click closes it and focus returns to the
 * trigger.
 */
import { Check } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Popover } from "../../design-system/components";
import type { StatusFilter } from "./toolsState";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "ready", label: "Ready" },
  { value: "needs_attention", label: "Needs attention" },
];

export function StatusSelect({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (value: StatusFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);
  const label = STATUS_OPTIONS.find((o) => o.value === value)?.label ?? "All statuses";

  // Focus goes back to the trigger when it was inside the list (Escape, picking an option); an
  // outside click leaves it where the user clicked.
  const close = () => {
    setOpen(false);
    const active = document.activeElement;
    if (active && active !== triggerRef.current && listRef.current?.contains(active)) {
      triggerRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const els = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const next = (i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length;
    els[next]?.focus();
    e.preventDefault();
  };

  return (
    <span
      className="tk-status"
      style={{ width: value === "needs_attention" ? 190 : 150 }}
      ref={listRef}
      onKeyDown={onKeyDown}
    >
      <Popover
        open={open}
        onClose={() => close()}
        role="listbox"
        label="Status"
        width={182}
        align="end"
        className="tk-status__list"
        trigger={
          <span className="ds-select-wrap tk-status__wrap">
            <button
              ref={triggerRef}
              type="button"
              role="combobox"
              aria-label="Status"
              aria-haspopup="listbox"
              aria-expanded={open}
              className="ds-select tk-status__btn"
              onClick={() => setOpen((o) => !o)}
            >
              {label}
            </button>
            <svg
              className="ds-select-wrap__chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </span>
        }
      >
        {STATUS_OPTIONS.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              className="tk-status__opt"
              onClick={() => {
                onChange(o.value);
                close();
              }}
            >
              <span className="tk-status__check">
                {selected && <Check size={13} strokeWidth={2} aria-hidden />}
              </span>
              {o.label}
            </button>
          );
        })}
      </Popover>
    </span>
  );
}
