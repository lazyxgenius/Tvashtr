import { useId } from "react";
import { ArrowRight } from "lucide-react";

import { providerOf } from "../../lib/api";
import type { ChangeGroup } from "../agentDraft";
import type { DiffRow } from "../setup/lineDiff";
import { lineStats, type ReviewSection, type ReviewValue } from "./reviewSections";
import { FocusSubView } from "./FocusSubView";

const SIGN: Record<DiffRow["op"] | "change", string> = {
  same: " ",
  gap: "⋯",
  del: "−",
  add: "+",
  change: " ",
};

/**
 * Review changes (Focus-ReviewChanges, spec OQ-4): opened from the focus footer's "N unsaved
 * changes", it shows every unsaved part of the draft with "Undo this change" for that part alone.
 * Nothing is saved here; the footer's Save still saves everything.
 */
export function ReviewChanges({
  sections,
  onUndo,
  onBack,
}: {
  sections: ReviewSection[];
  onUndo: (group: ChangeGroup) => void;
  onBack: () => void;
}) {
  const n = sections.length;
  return (
    <FocusSubView
      variant="review"
      title={`Review ${n} ${n === 1 ? "change" : "changes"}`}
      lede="Nothing is saved yet. Saving changes the next run you launch."
      onBack={onBack}
    >
      {sections.map((s) => (
        <ChangeSection key={s.group} section={s} onUndo={() => onUndo(s.group)} />
      ))}
    </FocusSubView>
  );
}

function ChangeSection({ section: s, onUndo }: { section: ReviewSection; onUndo: () => void }) {
  const titleId = useId();
  let body;
  if (s.kind === "text") {
    body = s.rows.map((row, i) => <Row key={i} op={row.op} text={row.text} />);
  } else if (s.kind === "lines") {
    body = s.lines.map((line, i) => <Row key={i} op={line.op} text={line.text} />);
  } else {
    body = (
      <div className="fx-change__value">
        <Value value={s.before} tone="old" />
        <ArrowRight size={14} strokeWidth={1.6} aria-label="to" />
        <Value value={s.after} tone="new" />
      </div>
    );
  }
  return (
    <section className="fx-change" aria-labelledby={titleId}>
      <div className="fx-change__head">
        <span className="fx-change__title" id={titleId}>
          {s.title}
        </span>
        <span className="fx-change__meta">
          {s.kind === "text" ? lineStats(s.added, s.removed) : s.location}
        </span>
        <button
          type="button"
          className="fx-change__undo"
          aria-describedby={titleId}
          onClick={onUndo}
        >
          Undo this change
        </button>
      </div>
      <div className="fx-change__body">{body}</div>
    </section>
  );
}

function Row({ op, text }: { op: DiffRow["op"] | "change"; text: string }) {
  // <ins>/<del> carry "added" / "removed" to assistive tech; the sign column is for the eye.
  const Text = op === "add" ? "ins" : op === "del" ? "del" : "span";
  return (
    <div className={`fx-diff fx-diff--${op}`}>
      <span className="fx-diff__sign" aria-hidden>
        {SIGN[op]}
      </span>
      <Text className="fx-diff__text">{op === "gap" ? "" : text}</Text>
    </div>
  );
}

function Value({ value, tone }: { value: ReviewValue; tone: "old" | "new" }) {
  const Tag = tone === "old" ? "del" : "ins";
  return (
    <Tag className={`fx-val fx-val--${tone}`}>
      {value.model && (
        <span className="nd-model__tile" aria-hidden>
          {(providerOf(value.text)[0] ?? "?").toUpperCase()}
        </span>
      )}
      <span className={value.model ? "fx-val__slug" : undefined}>{value.text}</span>
    </Tag>
  );
}
