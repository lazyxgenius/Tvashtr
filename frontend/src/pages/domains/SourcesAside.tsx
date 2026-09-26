/**
 * The Ask tab's right column (DM-56/60/61, w340): "Sources for this answer" — one card per cited
 * passage with its chip, file, "piece 3 of 42" / "page 4 · piece 17 of 86" and the excerpt, the part
 * nearest the answer highlighted (OQ-10). The active card is coral with **Open file** and **Copy
 * passage**. **Show what search found** switches it to every passage found, in rank order.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft, Copy, ExternalLink, FileText } from "lucide-react";

import { Button } from "../../design-system/components";
import type { DomainAnswer, DomainPassage } from "../../lib/api/domains";
import { SourceChip } from "./AnswerCard";
import { highlightRange, passageMeta, passageText, sentenceCiting } from "./answerMarkers";

export type AsideMode = "sources" | "found";

function Excerpt({ passage, cited }: { passage: DomainPassage; cited: string | null }) {
  const text = passageText(passage);
  const range = cited && highlightRange(text, cited);
  if (!range) return <div className="dm-passage__text">{text}</div>;
  return (
    <div className="dm-passage__text">
      {text.slice(0, range[0])}
      <mark>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </div>
  );
}

export function SourcesAside({
  answer,
  mode,
  active,
  onActivate,
  onBack,
  onOpen,
  onCopy,
}: {
  /** The answer whose sources show (`null`: nothing asked yet). */
  answer: DomainAnswer | null;
  mode: AsideMode;
  active: number | null;
  onActivate: (n: number) => void;
  onBack: () => void;
  onOpen: (p: DomainPassage) => void;
  onCopy: (p: DomainPassage) => void;
}) {
  const activeCard = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeCard.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, answer]);

  const found = mode === "found";
  const list = answer ? (found ? answer.searched : answer.sources) : [];

  return (
    <aside className="dm-aside" aria-label="Sources">
      <div className="dm-aside__head">
        <span className="dm-aside__title">
          {found ? "What search found" : "Sources for this answer"}
        </span>
        {found && (
          <Button
            variant="ghost"
            size="sm"
            className="dm-btn-inline dm-aside__back"
            onClick={onBack}
          >
            <ArrowLeft size={15} strokeWidth={1.6} aria-hidden />
            <span>Back to sources</span>
          </Button>
        )}
      </div>
      {list.length === 0 ? (
        <div className="dm-aside__empty">
          <span className="dm-aside__tile">
            <FileText size={18} strokeWidth={1.6} aria-hidden />
          </span>
          <div className="dm-aside__empty-title">Sources show up here</div>
          <p className="dm-aside__empty-text">
            Click a number in an answer to read the exact passage it came from.
          </p>
        </div>
      ) : (
        <div className="dm-aside__list">
          {list.map((p) => {
            const on = !found && p.number === active;
            return (
              <div
                key={`${mode}-${p.number}`}
                ref={on ? activeCard : undefined}
                className={`dm-passage${on ? " dm-passage--active" : ""}`}
                onClick={() => !found && onActivate(p.number)}
              >
                <div className="dm-passage__head">
                  <SourceChip n={p.number} active={on} />
                  <span className="dm-passage__file">{p.filename}</span>
                  <span className="dm-passage__meta">
                    {passageMeta(p, !found && answer?.covered === false)}
                  </span>
                </div>
                <Excerpt
                  passage={p}
                  cited={found || !answer ? null : sentenceCiting(answer.answer_text, p.number)}
                />
                {on && (
                  <div className="dm-passage__actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="dm-btn-inline"
                      onClick={() => onOpen(p)}
                    >
                      <ExternalLink size={15} strokeWidth={1.6} aria-hidden />
                      <span>Open file</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="dm-btn-inline"
                      onClick={() => onCopy(p)}
                    >
                      <Copy size={15} strokeWidth={1.6} aria-hidden />
                      <span>Copy passage</span>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
