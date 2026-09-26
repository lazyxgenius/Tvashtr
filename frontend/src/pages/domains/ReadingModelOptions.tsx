/**
 * The reading models as listbox options (DM-82, drawn open in DmF-Embed-1): the label, "<dim> ·
 * <tagline>" and the key tag — ✓ "key saved" or amber "No <p> key" / "No huggingface token". The
 * New domain dialog shows it in place of its key line after **Change** (DM-23); Settings' Reading
 * model select reuses it.
 */
import { type KeyboardEvent, useRef } from "react";
import { Check, CircleCheck } from "lucide-react";

import { READING_MODELS, keySavedText, missingKeyText } from "./readingModels";
import "./newDomain.css";

export function KeySavedTag({ provider }: { provider: string }) {
  return (
    <span className="dm-keytag">
      <CircleCheck size={14} strokeWidth={1.6} aria-hidden />
      {keySavedText(provider)}
    </span>
  );
}

export function ReadingModelOptions({
  value,
  held,
  onPick,
  onCancel,
}: {
  value: string;
  /** The providers the account holds keys for; `null` while loading (no tags yet). */
  held: string[] | null;
  onPick: (slug: string) => void;
  /** Escape: leave the list without picking. */
  onCancel?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    );
    const at = opts.findIndex((o) => o === document.activeElement);
    const next = e.key === "ArrowDown" ? Math.min(opts.length - 1, at + 1) : Math.max(0, at - 1);
    opts[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Reading model"
      className="dm-rmlist"
      onKeyDown={onKeyDown}
    >
      {READING_MODELS.map((m) => {
        const selected = m.slug === value;
        return (
          <button
            key={m.slug}
            type="button"
            role="option"
            aria-selected={selected}
            className="dm-rmopt"
            onClick={() => onPick(m.slug)}
          >
            {selected ? (
              <Check className="dm-rmopt__check" size={15} strokeWidth={2} aria-hidden />
            ) : (
              <span className="dm-rmopt__pad" />
            )}
            <span className="dm-rmopt__text">
              <span className="dm-rmopt__label">{m.label}</span>
              <span className="dm-rmopt__sub">{`${m.dim} · ${m.tagline}`}</span>
            </span>
            <span className="dm-rmopt__tag">
              {held === null ? null : held.includes(m.provider) ? (
                <KeySavedTag provider={m.provider} />
              ) : (
                <span className="dm-keytag dm-keytag--missing">{missingKeyText(m.provider)}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
