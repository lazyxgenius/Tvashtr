/** Removable chips with "type and press Enter": The choices, and Words it must contain. */
import { type ReactNode, useState } from "react";
import { X } from "lucide-react";

import { Input } from "../../design-system/components";

export function ChipsField({
  label,
  values,
  onChange,
  placeholder,
  inputLabel,
  hint,
  duplicate,
  error,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  inputLabel: string;
  hint?: ReactNode;
  /** The words when the typed one is already there. */
  duplicate?: string;
  error?: string | null;
}) {
  const [draft, setDraft] = useState("");
  const [dupe, setDupe] = useState(false);
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setDupe(true);
      return;
    }
    onChange([...values, value]);
    setDraft("");
    setDupe(false);
  };
  const problem = dupe ? duplicate : error;
  return (
    <div className="md-chips">
      <span className="md-lbl">{label}</span>
      {values.length > 0 && (
        <div className="md-chips__row">
          {values.map((v) => (
            <span key={v} className="md-choice">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X size={12} strokeWidth={1.7} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        size="sm"
        aria-label={inputLabel}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setDupe(false);
        }}
        onBlur={() => !dupe && add()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      {hint && <span className="md-hint">{hint}</span>}
      {problem && (
        <span className="md-error" role="alert">
          {problem}
        </span>
      )}
    </div>
  );
}
