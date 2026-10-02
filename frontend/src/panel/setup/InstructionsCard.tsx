import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { History, Layers, Lock, Maximize2 } from "lucide-react";

import { Button, IconButton } from "../../design-system/components";
import { ChangedDot } from "../ChangedDot";
import { InfoTip } from "../InfoTip";
import { changedLines } from "./lineDiff";
import { TIPS } from "./setupCopy";

/** The editor is collapsed to this height, with a fade and "Show all N lines" (PANEL-29) — or
 *  just "Show all" when a few long lines only overflow by wrapping (no "Show all 1 lines"). */
const COLLAPSED_PX = 196;

/**
 * The Instructions card (PANEL-27/28/29): the label and ⓘ, Templates and "Open full editor", the
 * run-time banner, the monospace editor collapsed to 196px, and the routing line attached below.
 * Lines that differ from `saved` get the coral "changed" band behind them. A new agent's empty
 * instructions show `chooser` (the template chooser) in the editor's place.
 */
export function InstructionsCard({
  prompt,
  saved,
  onChange,
  banner,
  routing,
  onOpenFullEditor,
  templates,
  chooser,
  history,
  focusEditor = false,
  readOnly = false,
}: {
  prompt: string;
  /** The saved instructions (omitted: no line marks). */
  saved?: string;
  onChange: (next: string) => void;
  banner: string;
  routing: ReactNode;
  onOpenFullEditor?: () => void;
  /** The Templates button and its menu (`TemplatesMenu`); a disabled button when omitted. */
  templates?: ReactNode;
  /** Shown instead of the editor (the new agent's template chooser). */
  chooser?: ReactNode;
  /** M5: the History toggle (Ver-AgentHistory), tinted while the instruction history shows. */
  history?: { open: boolean; onToggle: () => void };
  /** Put the caret in the editor when it takes the chooser's place ("Start from scratch"). */
  focusEditor?: boolean;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();
  const lines = prompt.split("\n").length;
  const showEditor = !chooser;
  const marks = useMemo(
    () => (saved === undefined ? new Set<number>() : changedLines(saved, prompt)),
    [saved, prompt],
  );
  // A change that only removed lines leaves nothing to tint: mark the title instead.
  const unmarkedChange = saved !== undefined && saved !== prompt && marks.size === 0;

  // The editor grows with its text (no inner scrollbar); the wrapper clips it while collapsed.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight;
    if (h > 0) el.style.height = `${h}px`;
    setHeight(h);
  }, [prompt, expanded, showEditor]);

  useEffect(() => {
    if (showEditor && focusEditor) textRef.current?.focus();
  }, [showEditor, focusEditor]);

  // jsdom measures 0: fall back to the line count so tests see the expander too.
  const overflowing = height > 0 ? height > COLLAPSED_PX : lines > 9;
  const collapsed = overflowing && !expanded;

  return (
    <section className="nd-card" aria-label="Instructions">
      <div className="nd-card__head">
        <h3 className="nd-card__title">
          <span id={labelId}>Instructions</span>
          <InfoTip text={TIPS.instructions} />
          {unmarkedChange && <ChangedDot inline />}
        </h3>
        <div className="nd-card__tools">
          {templates ?? (
            // The icon sits inside the label, flush with the text, as the design draws it.
            <Button variant="ghost" size="sm" className="nd-btn-flush" disabled>
              <Layers size={14} strokeWidth={1.7} aria-hidden />
              <span>Templates</span>
            </Button>
          )}
          {history && (
            <Button
              variant={history.open ? "tint" : "ghost"}
              size="sm"
              className="nd-btn-flush"
              aria-pressed={history.open}
              onClick={history.onToggle}
            >
              <History size={14} strokeWidth={1.6} aria-hidden />
              <span>History</span>
            </Button>
          )}
          {onOpenFullEditor && (
            <IconButton
              size="sm"
              aria-label="Open full editor"
              title="Open full editor"
              onClick={onOpenFullEditor}
            >
              <Maximize2 size={14} strokeWidth={1.7} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="nd-runtime">
        <Lock size={12} strokeWidth={1.8} aria-hidden />
        {banner}
      </div>
      {!showEditor ? (
        <>
          {chooser}
          <div className="nd-chooser__gap" />
        </>
      ) : (
        <div
          className={`nd-editor${collapsed ? " nd-editor--collapsed" : ""}${
            overflowing && expanded ? " nd-editor--expanded" : ""
          }`}
        >
          {marks.size > 0 && (
            // A mirror of the text (hidden glyphs, same wrapping) whose changed lines are tinted.
            <div className="nd-editor__marks" aria-hidden>
              {prompt.split("\n").map((line, i) => (
                <div key={i} className={`nd-mark${marks.has(i) ? " nd-mark--on" : ""}`}>
                  <span>{line || " "}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textRef}
            className="nd-editor__text"
            aria-labelledby={labelId}
            value={prompt}
            spellCheck={false}
            readOnly={readOnly}
            onChange={(e) => onChange(e.target.value)}
          />
          {collapsed && <div className="nd-editor__fade" aria-hidden />}
          {overflowing && (
            <button
              type="button"
              className="nd-editor__more"
              aria-expanded={expanded}
              onClick={() => setExpanded((x) => !x)}
            >
              {expanded ? "Show less" : lines > 9 ? `Show all ${lines} lines` : "Show all"}
            </button>
          )}
        </div>
      )}
      {routing}
    </section>
  );
}
