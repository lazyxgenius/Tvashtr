/**
 * The composer's "Answer model: <label>" chip and its listbox (DM-63, DmF-Model-1…3): w380, opening
 * upward over the chip, each model with its key tag. The account default's tag is the key of the
 * model it resolves to now, which its tooltip names (OQ-11). **Custom…** swaps in a "provider/model"
 * field; Enter saves it.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { Input } from "../../design-system/components";
import type { DomainAnswerModel } from "../../lib/api/domains";
import { ANSWER_MODELS, answerModelLabel } from "./answerModels";
import { KeySavedTag } from "./ReadingModelOptions";
import { missingKeyText } from "./readingModels";
import "./newDomain.css";

export function AnswerModelPicker({
  model,
  held,
  onPick,
}: {
  model: DomainAnswerModel;
  /** The providers the account holds keys for; `null` while loading (no tags yet). */
  held: string[] | null;
  onPick: (slug: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const listed = ANSWER_MODELS.some((m) => m.slug === model.configured);

  const close = (refocus: boolean) => {
    setOpen(false);
    setCustom(null);
    if (refocus) chip.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (slug: string | null) => {
    close(true);
    if (slug !== model.configured) onPick(slug);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
    const at = opts.findIndex((o) => o === document.activeElement);
    const next = e.key === "ArrowDown" ? Math.min(opts.length - 1, at + 1) : Math.max(0, at - 1);
    opts[next]?.focus();
  };

  const tag = (provider: string | null) =>
    held === null || provider === null ? null : held.includes(provider) ? (
      <KeySavedTag provider={provider} />
    ) : (
      <span className="dm-keytag dm-keytag--missing">{missingKeyText(provider)}</span>
    );

  return (
    <span className="dm-ampick" ref={wrap}>
      <button
        ref={chip}
        type="button"
        className="dm-ampick__chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        Answer model: <b>{answerModelLabel(model.configured)}</b>
        <ChevronDown size={13} strokeWidth={1.6} aria-hidden />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Answer model"
          className="dm-rmlist dm-ampick__list"
          onKeyDown={onKeyDown}
        >
          {ANSWER_MODELS.map((m) => {
            const selected = m.slug === model.configured;
            const isDefault = m.slug === null;
            return (
              <li key={m.label} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="dm-rmopt"
                  title={isDefault && model.label ? `Now ${model.label}` : undefined}
                  onClick={() => pick(m.slug)}
                >
                  {selected ? (
                    <Check size={15} strokeWidth={2} className="dm-ampick__check" aria-hidden />
                  ) : (
                    <span className="dm-rmopt__pad" />
                  )}
                  <span className="dm-rmopt__text">
                    <span className="dm-rmopt__label">{m.label}</span>
                    <span className="dm-rmopt__sub">{m.tagline}</span>
                  </span>
                  <span className="dm-rmopt__tag">
                    {tag(isDefault ? model.provider : m.provider)}
                  </span>
                </button>
              </li>
            );
          })}
          <li role="separator" className="dm-ampick__sep" />
          <li role="presentation">
            {custom === null ? (
              <button
                type="button"
                role="option"
                aria-selected={!listed}
                className="dm-rmopt"
                onClick={() => setCustom(listed ? "" : (model.configured ?? ""))}
              >
                {listed ? (
                  <span className="dm-rmopt__pad" />
                ) : (
                  <Check size={15} strokeWidth={2} className="dm-ampick__check" aria-hidden />
                )}
                <span className="dm-rmopt__text">
                  <span className="dm-rmopt__label">Custom…</span>
                  <span className="dm-rmopt__sub">Type any provider/model name</span>
                </span>
              </button>
            ) : (
              <div className="dm-ampick__custom">
                <Input
                  autoFocus
                  aria-label="Custom answer model"
                  placeholder="provider/model"
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && custom.trim()) {
                      e.preventDefault();
                      pick(custom.trim());
                    }
                  }}
                />
              </div>
            )}
          </li>
        </ul>
      )}
    </span>
  );
}
