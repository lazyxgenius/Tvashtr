/**
 * A header or environment value that shows `${NAME}` references as chips marked "· set" or
 * "· not set" (TOOL-35, TOOL-38). It is a real text input: while you type you edit the plain text;
 * when you leave it (or pick a secret) the references show as chips again. Typing `${` opens the
 * secret picker; arrows move, Enter picks, Escape closes. While the picker is open the chip previews
 * the highlighted secret. A value with no reference looks like a plain small input.
 */
import { KeyRound } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { cx, useDismiss } from "../../design-system/components";
import { SecretAutocomplete } from "./SecretAutocomplete";
import {
  type PickerOption,
  type SecretOption,
  defaultPick,
  hasSecretRef,
  openRefAt,
  pickerOptions,
  valueSegments,
} from "./connectionForm";

/** The `${partial` being typed: where it starts and ends in the value, and the partial. */
interface OpenRef {
  start: number;
  end: number;
  typed: string;
}

const refText = (name: string) => "${" + name + "}";

export function SecretRefInput({
  value,
  onChange,
  labelledBy,
  options,
  stored,
  suggestion,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Id(s) of the text that names this field (`aria-labelledby`). */
  labelledBy: string;
  /** Your stored secrets for the picker ([] while they load or when they can't). */
  options: SecretOption[];
  /** Names that have a value — null when unknown (the chips then show no state). */
  stored: Set<string> | null;
  /** "Create <NAME>" for this tool, e.g. LINEAR_TOKEN. */
  suggestion: string;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState<OpenRef | null>(null);
  // The highlighted option by name (null = the default pick), so it survives the list loading.
  const [activeName, setActiveName] = useState<string | null>(null);
  // Just picked a secret: show the chips until you type again.
  const [settled, setSettled] = useState(false);
  const caretAfter = useRef<number | null>(null);

  const choices: PickerOption[] = picking ? pickerOptions(options, picking.typed, suggestion) : [];
  const open = picking !== null && choices.length > 0;
  const named = choices.findIndex((o) => o.name === activeName);
  const current = !open ? -1 : named !== -1 ? named : defaultPick(choices, suggestion);
  const close = () => setPicking(null);
  useDismiss(open, close, wrapRef);

  useLayoutEffect(() => {
    if (caretAfter.current === null) return;
    inputRef.current?.setSelectionRange(caretAfter.current, caretAfter.current);
    caretAfter.current = null;
  });

  const showChips = !focused || open || settled;
  const shown =
    open && picking
      ? value.slice(0, picking.start) + refText(choices[current].name) + value.slice(picking.end)
      : value;
  const chips = showChips && hasSecretRef(shown);
  const refLook = hasSecretRef(shown);

  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    onChange(next);
    setSettled(false);
    const at = openRefAt(next, caret);
    if (!at) {
      close();
      return;
    }
    setPicking({ start: at.start, end: caret, typed: at.typed });
    setActiveName(null);
  };

  const pick = (option: PickerOption) => {
    if (!picking) return;
    const ref = refText(option.name);
    onChange(value.slice(0, picking.start) + ref + value.slice(picking.end));
    caretAfter.current = picking.start + ref.length;
    close();
    setSettled(true);
  };

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActiveName(choices[(current + step + choices.length) % choices.length].name);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        pick(choices[current]);
        return;
      }
      if (e.key === "Tab") close();
      return;
    }
    if (!["Tab", "Shift", "Escape", "Enter"].includes(e.key)) setSettled(false);
  };

  return (
    <div
      ref={wrapRef}
      className={cx("tk-ref", refLook ? "tk-ref--chips" : "tk-ref--plain", chips && "tk-ref--show")}
    >
      <input
        ref={inputRef}
        className={refLook ? "tk-ref__raw" : "ds-input ds-input--sm"}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        aria-labelledby={labelledBy}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={change}
        onKeyDown={keyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setSettled(false);
          close();
        }}
      />
      {chips && (
        <div className="tk-ref__display" aria-hidden="true">
          {valueSegments(shown).map((s, i) =>
            s.kind === "text" ? (
              s.text
            ) : (
              <span key={i} className={cx("tk-chip", stored?.has(s.name) && "tk-chip--set")}>
                <KeyRound size={12} strokeWidth={1.6} aria-hidden />
                {refText(s.name)}{" "}
                {stored && (
                  <span className="tk-chip__state">
                    {stored.has(s.name) ? "· set" : "· not set"}
                  </span>
                )}
              </span>
            ),
          )}
        </div>
      )}
      {open && (
        <SecretAutocomplete
          id={listId}
          options={choices}
          active={current}
          onPick={pick}
          onHover={(i) => setActiveName(choices[i].name)}
        />
      )}
    </div>
  );
}
