import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Layers, Lock, Maximize2 } from "lucide-react";

import { Button, IconButton } from "../../design-system/components";
import { InfoTip } from "../InfoTip";
import { TIPS } from "./setupCopy";

/** The editor is collapsed to this height, with a fade and "Show all N lines" (PANEL-29). */
const COLLAPSED_PX = 196;

/**
 * The Instructions card (PANEL-27/28/29): the label and ⓘ, Templates and "Open full editor", the
 * run-time banner, the monospace editor collapsed to 196px, and the routing line attached below.
 */
export function InstructionsCard({
  prompt,
  onChange,
  banner,
  routing,
  onOpenFullEditor,
  onTemplates,
  templatesExpanded,
  readOnly = false,
}: {
  prompt: string;
  onChange: (next: string) => void;
  banner: string;
  routing: ReactNode;
  onOpenFullEditor?: () => void;
  onTemplates?: () => void;
  templatesExpanded?: boolean;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [height, setHeight] = useState(0);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();
  const lines = prompt.split("\n").length;

  // The editor grows with its text (no inner scrollbar); the wrapper clips it while collapsed.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight;
    if (h > 0) el.style.height = `${h}px`;
    setHeight(h);
  }, [prompt, expanded]);

  // jsdom measures 0: fall back to the line count so tests see the expander too.
  const overflowing = height > 0 ? height > COLLAPSED_PX : lines > 9;
  const collapsed = overflowing && !expanded;

  return (
    <section className="nd-card" aria-label="Instructions">
      <div className="nd-card__head">
        <h3 className="nd-card__title">
          <span id={labelId}>Instructions</span>
          <InfoTip text={TIPS.instructions} />
        </h3>
        <div className="nd-card__tools">
          {/* The icon sits inside the label, flush with the text, as the design draws it. */}
          <Button
            variant="ghost"
            size="sm"
            className="nd-btn-flush"
            onClick={onTemplates}
            aria-haspopup="menu"
            aria-expanded={templatesExpanded ?? false}
            disabled={readOnly}
          >
            <Layers size={14} strokeWidth={1.7} aria-hidden />
            <span>Templates</span>
          </Button>
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
      <div
        className={`nd-editor${collapsed ? " nd-editor--collapsed" : ""}${
          overflowing && expanded ? " nd-editor--expanded" : ""
        }`}
      >
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
            {expanded ? "Show less" : `Show all ${lines} lines`}
          </button>
        )}
      </div>
      {routing}
    </section>
  );
}
