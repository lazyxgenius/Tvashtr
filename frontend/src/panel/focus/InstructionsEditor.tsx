import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, Lock } from "lucide-react";

import { Button } from "../../design-system/components";
import { InfoTip } from "../InfoTip";
import { changedLines } from "../setup/lineDiff";
import { TIPS } from "../setup/setupCopy";
import { caretPosition, sizeLine } from "./editorStats";

/**
 * The focus view's instructions (Desktop-Focus, PANEL-100): the full editor with a line-number
 * gutter (one number per line of text, however it wraps), the run-time banner, and a status line
 * under it — where the caret is ("Line 12, column 38") and how long it is ("1,284 characters ·
 * about 320 tokens"). "Preview as the agent sees it" opens the preview in the Setup body.
 */
export function InstructionsEditor({
  prompt,
  saved,
  onChange,
  banner,
  templates,
  onPreview,
  autoFocus = false,
  readOnly = false,
}: {
  prompt: string;
  /** The saved instructions (changed lines get the coral band); omitted while saving. */
  saved?: string;
  onChange: (next: string) => void;
  banner: string;
  /** The Templates button. */
  templates: ReactNode;
  onPreview?: () => void;
  /** Put the caret in the editor when the view opens. */
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const labelId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const lines = prompt.split("\n");
  const marks = useMemo(
    () => (saved === undefined ? new Set<number>() : changedLines(saved, prompt)),
    [saved, prompt],
  );
  const { line, column } = caretPosition(prompt, caret);

  // The dialog's focus trap lands on its first button; the full editor starts in the text instead,
  // unless a dialog opened on top of it (the Templates dialog) has the keyboard by then.
  useEffect(() => {
    if (!autoFocus) return;
    const id = window.setTimeout(() => {
      const on = document.activeElement?.closest('[aria-modal="true"]');
      if (on && !on.contains(textRef.current)) return;
      textRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(id);
  }, [autoFocus]);

  const track = () => {
    const el = textRef.current;
    if (el) setCaret(el.selectionStart);
  };
  // The caret also moves without a key or a click (a template applied, the selection set in code).
  useEffect(() => {
    const onSelectionChange = () => {
      const el = textRef.current;
      if (el && document.activeElement === el) setCaret(el.selectionStart);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  return (
    <div className="fx-main">
      <div className="fx-main__head">
        <h3 className="fx-main__title">
          <span id={labelId}>Instructions</span>
          <InfoTip text={TIPS.instructions} />
        </h3>
        <div className="fx-main__tools">
          <Button variant="ghost" size="sm" className="nd-btn-flush" onClick={onPreview}>
            <Eye size={14} strokeWidth={1.6} aria-hidden />
            <span>Preview as the agent sees it</span>
          </Button>
          {templates}
        </div>
      </div>
      <div className="fx-banner">
        <Lock size={12} strokeWidth={1.6} aria-hidden />
        {banner}
      </div>
      <div className="fx-editor">
        <div className="fx-editor__inner">
          {/* One row per line of text: its number, and the line itself in hidden glyphs that
                  wrap exactly like the text above them, so each number sits on its line's first
                  row and changed lines get their band. */}
          <div className="fx-editor__rows" aria-hidden>
            {lines.map((text, i) => (
              <div key={i} className="fx-row">
                <div className="fx-row__n">{i + 1}</div>
                <div className={`fx-row__text${marks.has(i) ? " fx-row__text--changed" : ""}`}>
                  {text || " "}
                </div>
              </div>
            ))}
          </div>
          <textarea
            ref={textRef}
            className="fx-editor__text"
            aria-labelledby={labelId}
            value={prompt}
            spellCheck={false}
            readOnly={readOnly}
            onChange={(e) => {
              setCaret(e.target.selectionStart);
              onChange(e.target.value);
            }}
            onSelect={track}
            onKeyUp={track}
            onClick={track}
          />
        </div>
      </div>
      <div className="fx-status">
        <span>
          Line {line}, column {column}
        </span>
        <span>{sizeLine(prompt.length)}</span>
      </div>
    </div>
  );
}
