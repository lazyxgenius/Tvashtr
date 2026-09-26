/**
 * The Add key sheet's Provider field (ENG-62..64, Eng-AddKeyPick, EnF-PickProvider-1..3,
 * EnF-OtherProvider-1): a button that shows the pick ("Choose a provider", the provider's tile and
 * slug, or "Other provider") and opens a list with a search box (focused on open), one option per
 * provider with its description line, and the always-visible "Other: type the model prefix".
 *
 * Keys: ↑/↓ move, Enter picks, Escape closes the list only (the sheet stays), Tab leaves it.
 */
import { ChevronDown, Plus } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Input } from "../../design-system/components";
import { cx, useDismiss } from "../../design-system/components/utils";
import { MonogramTile } from "./enginesUi";
import type { PickerOption, ProviderPick } from "./sheetModel";

export interface ProviderComboboxProps {
  options: readonly PickerOption[];
  /** The options a search leaves (ENG-64). */
  filter: (query: string) => PickerOption[];
  pick: ProviderPick;
  /** The picked provider's tile letter. */
  pickedMonogram: string;
  onPick: (pick: ProviderPick) => void;
  /** Saving with nothing picked marks the field (EnF-SaveErrors-1). */
  invalid?: boolean;
  /** The hint lines under the field. */
  children?: ReactNode;
}

export function ProviderCombobox({
  options,
  filter,
  pick,
  pickedMonogram,
  onPick,
  invalid = false,
  children,
}: ProviderComboboxProps) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const buttonId = `${ids}-button`;
  const listId = `${ids}-list`;
  const otherId = `${ids}-other`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);

  const shown = query ? filter(query) : [...options];
  // The rows the keyboard walks: every shown provider, then "Other".
  const total = shown.length + 1;
  const optionId = (idx: number) =>
    idx === shown.length ? otherId : `${listId}-${shown[idx]?.provider ?? idx}`;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (refocus) buttonRef.current?.focus();
  };
  useDismiss(open, () => close(true), wrapRef);

  const openList = () => {
    const at =
      pick.kind === "provider"
        ? options.findIndex((o) => o.provider === pick.provider)
        : pick.kind === "other"
          ? options.length
          : -1;
    setActive(at);
    setOpen(true);
  };

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const choose = (next: ProviderPick) => {
    onPick(next);
    close(true);
  };

  const chooseAt = (idx: number) => {
    if (idx === shown.length) choose({ kind: "other" });
    else if (shown[idx]) choose({ kind: "provider", provider: shown[idx].provider });
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : total - 1) : (a + step + total) % total));
    } else if (e.key === "Enter") {
      // Never submits the sheet's form from here.
      e.preventDefault();
      if (active >= 0) chooseAt(active);
    }
  };

  return (
    <div
      className="eng-picker"
      ref={wrapRef}
      onBlur={(e) => {
        // Tab out of the list closes it (focus is already where the user sent it).
        if (open && !wrapRef.current?.contains(e.relatedTarget)) close(false);
      }}
    >
      <span className="eng-picker__label" id={labelId}>
        Provider
      </span>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={cx("eng-picker__btn", open && "is-open", invalid && "is-invalid")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${buttonId}`}
        onClick={() => (open ? close(true) : openList())}
      >
        {pick.kind === "provider" ? (
          <>
            <MonogramTile letter={pickedMonogram} />
            <span className="eng-picker__slug">{pick.provider}</span>
          </>
        ) : pick.kind === "other" ? (
          <>
            <span className="eng-picker__plus">
              <Plus size={15} strokeWidth={1.6} aria-hidden />
            </span>
            <span className="eng-picker__value">Other provider</span>
          </>
        ) : (
          <span className="eng-picker__placeholder">Choose a provider</span>
        )}
        <span className="eng-picker__chev">
          <ChevronDown size={15} strokeWidth={1.6} aria-hidden />
        </span>
      </button>
      {open && (
        <div
          className="eng-picker__pop"
          // Clicks inside the list keep focus in the search box (Safari never focuses a clicked
          // button, so a blur would otherwise close the list before the click lands).
          onMouseDown={(e) => {
            if (e.target !== searchRef.current) e.preventDefault();
          }}
        >
          <Input
            ref={searchRef}
            size="sm"
            className="eng-picker__search"
            placeholder="Search providers"
            aria-label="Search providers"
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => {
              const q = e.target.value;
              setQuery(q);
              // A search puts the first match (else "Other") under Enter.
              setActive(q.trim() ? 0 : -1);
            }}
            onKeyDown={onSearchKey}
          />
          {/* One listbox holds every option, "Other" included, so the search box's active option
              is always one of its own; only the providers scroll, "Other" stays in view. */}
          <div role="listbox" id={listId} aria-label="Providers">
            <div role="presentation" className="eng-picker__list">
              {shown.map((o, idx) => (
                <button
                  key={o.provider}
                  id={optionId(idx)}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={pick.kind === "provider" && pick.provider === o.provider}
                  className={cx(
                    "eng-picker__opt",
                    idx === active && "is-active",
                    o.saved && "is-saved",
                  )}
                  onClick={() => chooseAt(idx)}
                >
                  <MonogramTile letter={o.monogram} />
                  <span className="eng-picker__opt-slug">{o.provider}</span>
                  <span className="eng-picker__opt-desc">{o.description}</span>
                </button>
              ))}
            </div>
            <div className="eng-picker__sep" aria-hidden />
            <button
              id={otherId}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={pick.kind === "other"}
              className={cx("eng-picker__other", active === shown.length && "is-active")}
              onClick={() => chooseAt(shown.length)}
            >
              <Plus size={14} strokeWidth={1.6} aria-hidden />
              Other: type the model prefix
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
