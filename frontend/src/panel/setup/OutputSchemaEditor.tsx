import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";

import { Button } from "../../design-system/components";
import { SubView } from "../SubView";
import { checkSchema, exampleSchema, uncheckedNote } from "./schemaCheck";
import { OUTPUT_FORMAT_HINT } from "./setupCopy";

/**
 * The Output format sub-view (Flow-Schema-2/3, PANEL-60): a JSON editor checked as you type — a
 * line-numbered hint while it's broken ("Line 3: add a comma after the list.", Done disabled) or
 * "Valid JSON Schema". Insert example / Clear change the text; Done writes it into the draft (empty =
 * no output format); Cancel and Back leave the draft as it was.
 */
export function OutputSchemaEditor({
  value,
  onChange,
  onDone,
  onCancel,
  verdictLabels,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Only called while the text is empty or a valid schema. */
  onDone: () => void;
  onCancel: () => void;
  /** The verdicts this agent's arrows route on (null: it doesn't route on a verdict). */
  verdictLabels: readonly string[] | null;
}) {
  const titleId = useId();
  const messageId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const check = checkSchema(value);
  const note = check.state === "valid" ? uncheckedNote(check.unchecked) : null;

  // The editor grows with its text; the sheet's body scrolls.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // Opening the editor puts the caret in it.
  useEffect(() => {
    textRef.current?.focus({ preventScroll: true });
  }, []);

  const replace = (next: string) => {
    onChange(next);
    textRef.current?.focus();
  };

  return (
    <SubView
      title="Output format"
      titleId={titleId}
      onBack={onCancel}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={check.state === "error"} onClick={onDone}>
            Done
          </Button>
        </>
      }
    >
      <div className="nd-sub__hint">{OUTPUT_FORMAT_HINT}</div>
      <textarea
        ref={textRef}
        className={`nd-schema${check.state === "error" ? " nd-schema--error" : ""}`}
        aria-labelledby={titleId}
        aria-describedby={check.state === "empty" ? undefined : messageId}
        aria-invalid={check.state === "error" || undefined}
        value={value}
        spellCheck={false}
        placeholder={value ? undefined : "Paste a JSON Schema, or insert the example."}
        onChange={(e) => onChange(e.target.value)}
      />
      <div id={messageId} aria-live="polite" className="nd-schema__messages">
        {check.state === "error" && (
          <span className="nd-schema__msg nd-schema__msg--error">
            <AlertTriangle size={13} strokeWidth={1.6} aria-hidden />
            {check.message}
          </span>
        )}
        {check.state === "valid" && (
          <span className="nd-schema__msg nd-schema__msg--ok">
            <CircleCheck size={13} strokeWidth={1.6} aria-hidden />
            Valid JSON Schema
          </span>
        )}
        {note && <span className="nd-schema__note">{note}</span>}
      </div>
      <div className="nd-sub__tools">
        <Button variant="ghost" size="sm" onClick={() => replace(exampleSchema(verdictLabels))}>
          Insert example
        </Button>
        <Button variant="ghost" size="sm" disabled={value === ""} onClick={() => replace("")}>
          Clear
        </Button>
      </div>
    </SubView>
  );
}
