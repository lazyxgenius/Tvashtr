/**
 * One answer in the Ask thread (DM-58/59): light Markdown with number chips at its citations, the
 * "Sources" line, **Copy**, **Save as test question**, **Show what search found** and the meta
 * "1.8 s · OpenAI gpt-4o-mini". A chip is a button ("Source 2: billing-faq.pdf") that shows its
 * passage in the aside.
 */
import { Fragment } from "react";
import { BookmarkPlus, Copy, Search } from "lucide-react";

import { Button } from "../../design-system/components";
import type { DomainAnswer } from "../../lib/api/domains";
import { type Inline, answerMeta, parseAnswer } from "./answerMarkers";

export function SourceChip({
  n,
  filename,
  active = false,
  onClick,
}: {
  n: number;
  filename?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const cls = `dm-chip${active ? " dm-chip--active" : ""}`;
  if (!onClick) return <span className={cls}>{n}</span>;
  return (
    <button
      type="button"
      className={cls}
      aria-label={filename ? `Source ${n}: ${filename}` : `Source ${n}`}
      onClick={onClick}
    >
      {n}
    </button>
  );
}

export function AnswerCard({
  answer,
  onChip,
  onShowFound,
  onCopy,
  onSaveTest,
}: {
  answer: DomainAnswer;
  onChip: (n: number) => void;
  onShowFound: () => void;
  onCopy: () => void;
  onSaveTest: () => void;
}) {
  const fileOf = (n: number) => answer.sources.find((s) => s.number === n)?.filename;
  const inline = (parts: Inline[]) =>
    parts.map((p, i) =>
      p.kind === "chip" ? (
        <SourceChip key={i} n={p.n} filename={fileOf(p.n)} onClick={() => onChip(p.n)} />
      ) : p.kind === "bold" ? (
        <b key={i}>{p.text}</b>
      ) : p.kind === "code" ? (
        <code key={i}>{p.text}</code>
      ) : (
        p.text
      ),
    );
  const meta = answerMeta(answer.latency_ms, answer.model_label);

  return (
    <article className="dm-answer" aria-label="Answer">
      {answer.used_history && (
        <span className="dm-answer__context">Used your earlier question for context</span>
      )}
      <div className="dm-answer__text">
        {parseAnswer(answer.answer_text).map((b, i) =>
          b.kind === "p" ? (
            <p key={i}>{inline(b.parts)}</p>
          ) : b.kind === "ul" ? (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ul>
          ) : (
            <ol key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </ol>
          ),
        )}
      </div>
      {answer.sources.length > 0 && (
        <div className="dm-answer__sources">
          <span>Sources</span>
          {answer.sources.map((s, i) => (
            <Fragment key={s.number}>
              {i > 0 && " · "}
              <span className="dm-answer__source">
                <SourceChip n={s.number} filename={s.filename} onClick={() => onChip(s.number)} />
                <span className="dm-mono">{s.filename}</span>
              </span>
            </Fragment>
          ))}
        </div>
      )}
      <div className="dm-answer__actions">
        <Button variant="ghost" size="sm" className="dm-btn-inline" onClick={onCopy}>
          <Copy size={15} strokeWidth={1.6} aria-hidden />
          <span>Copy</span>
        </Button>
        <Button variant="ghost" size="sm" className="dm-btn-inline" onClick={onSaveTest}>
          <BookmarkPlus size={15} strokeWidth={1.6} aria-hidden />
          <span>Save as test question</span>
        </Button>
        <Button variant="ghost" size="sm" className="dm-btn-inline" onClick={onShowFound}>
          <Search size={15} strokeWidth={1.6} aria-hidden />
          <span>Show what search found</span>
        </Button>
        {meta && <span className="dm-answer__meta">{meta}</span>}
      </div>
    </article>
  );
}
