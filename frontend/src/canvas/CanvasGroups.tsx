import { useState } from "react";
import type { NodeProps } from "@xyflow/react";
import { ChevronRight, ChevronUp } from "lucide-react";

import { IconButton } from "../design-system/components";
import { NodeHandles } from "./AgentNodeCard";
import type { Box } from "./groups";

/** The label being typed: Enter or leaving the field keeps it (if not blank), Escape drops it. */
function LabelField({
  label,
  onCommit,
  onCancel,
}: {
  label: string;
  onCommit: (label: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(label);
  const done = () => (value.trim() ? onCommit(value.trim()) : onCancel());
  return (
    <input
      className="cv-group__label cv-group__label--edit"
      aria-label="Group name"
      value={value}
      maxLength={60}
      size={Math.max(value.length + 1, 12)}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        else if (e.key === "Escape") onCancel();
      }}
    />
  );
}

/**
 * M11 (Cnv-Group): a group's dashed frame round its agents, its label (click to rename inline), what
 * runs inside ("Engineer ⇄ Reviewer · up to 3 rounds") and its fold control. A group just made is
 * being named, with the note that groups are only labels.
 */
export function GroupFrame({
  box,
  label,
  summary,
  editing,
  isNew,
  onCommit,
  onCancel,
  onEdit,
  onFold,
}: {
  box: Box;
  label: string;
  summary: string | null;
  editing: boolean;
  isNew: boolean;
  onCommit: (label: string) => void;
  onCancel: () => void;
  onEdit: () => void;
  onFold: () => void;
}) {
  return (
    <>
      <div
        className="cv-group"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        aria-hidden
      />
      <div
        className="cv-group__head nodrag nopan nowheel"
        style={{ left: box.x + 14, top: box.y - 24 }}
      >
        {editing ? (
          <LabelField label={label} onCommit={onCommit} onCancel={onCancel} />
        ) : (
          <button type="button" className="cv-group__label" title="Rename" onClick={onEdit}>
            {label}
          </button>
        )}
        {summary && <span className="cv-group__summary">{summary}</span>}
        {!isNew && (
          <button
            type="button"
            className="cv-group__fold"
            aria-label={`Fold ${label}`}
            title={`Fold ${label}`}
            onClick={onFold}
          >
            <ChevronUp size={14} strokeWidth={1.6} aria-hidden />
          </button>
        )}
        {isNew && (
          <div role="note" className="cv-tip cv-tip--above">
            <span className="cv-tip__title">Groups are labels</span>
            They help you read a big team and can be folded away. They don’t change how work flows.
          </div>
        )}
      </div>
    </>
  );
}

export interface FoldData {
  label: string;
  line: string;
  onUnfold: () => void;
}

/** M11 (Cnv-GroupFolded): a folded group — one box with its name, what's inside, and Unfold. */
export function FoldedGroupNode({ data }: NodeProps) {
  const d = data as unknown as FoldData;
  return (
    <div role="group" aria-label={`${d.label}, folded`} className="cv-group-fold">
      <NodeHandles />
      <div className="cv-group-fold__text">
        <span className="cv-group-fold__label">{d.label}</span>
        <span className="cv-group-fold__line">{d.line}</span>
      </div>
      <IconButton
        size="sm"
        className="nodrag nopan"
        aria-label={`Unfold ${d.label}`}
        title={`Unfold ${d.label}`}
        onClick={(e) => {
          e.stopPropagation();
          d.onUnfold();
        }}
      >
        <ChevronRight size={15} strokeWidth={1.6} />
      </IconButton>
    </div>
  );
}

/** M11 (Cnv-Tidy): after Tidy, dashed boxes where the nodes were, each tied to where it went. */
export function TidyGhosts({ moves }: { moves: { id: string; from: Box; to: Box }[] }) {
  const mid = (b: Box) => [b.x + b.width / 2, b.y + b.height / 2];
  return (
    <>
      {moves.map((m) => (
        <div
          key={m.id}
          className="cv-ghost"
          style={{ left: m.from.x, top: m.from.y, width: m.from.width, height: m.from.height }}
        />
      ))}
      <svg className="cv-ghost__lines" aria-hidden>
        {moves.map((m) => {
          const [x1, y1] = mid(m.from);
          const [x2, y2] = mid(m.to);
          return <path key={m.id} d={`M${x1} ${y1} L ${x2} ${y2}`} />;
        })}
      </svg>
    </>
  );
}
