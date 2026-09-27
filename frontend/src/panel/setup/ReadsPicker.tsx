import { GripVertical } from "lucide-react";
import { type KeyboardEvent, type RefObject, useId, useRef, useState } from "react";

import { Input } from "../../design-system/components";
import {
  DOC_NAME_MAX,
  documentLabel,
  type KnownDocument,
  readsChips,
  readsFor,
  type ReadsValue,
  writersText,
} from "./documents";
import { useRowPopover } from "./rowPopover";

/**
 * Flow-Reads-1 (PANEL-53): "Documents it reads, in order". Every document the team knows about,
 * with who writes it; the checked ones are what the agent reads, top to bottom. Rows drag to change
 * the order (Alt+↑/↓ on a checkbox does the same), and a new name typed in the field (Enter) is
 * added to the end and checked. Every change goes straight into the draft.
 */
export function ReadsPicker({
  value,
  spec,
  documents,
  onChange,
  onClose,
  anchorRef,
  triggerRef,
}: {
  value: ReadsValue;
  /** The shared spec's document name. */
  spec: string;
  documents: readonly KnownDocument[];
  onChange: (next: ReadsValue) => void;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const noteId = useId();
  useRowPopover({ onClose, anchorRef, popoverRef: ref, triggerRef });
  const checked = new Set(readsChips(value, spec));
  // The rows: what it reads (in order), then the rest. The order of unchecked rows is this
  // popover's own; only the checked ones are saved.
  const [order, setOrder] = useState<string[]>(() => {
    const reads = readsChips(value, spec);
    return [...reads, ...documents.map((d) => d.name).filter((n) => !reads.includes(n))];
  });
  const [dragging, setDragging] = useState<string | null>(null);
  // The row last dragged over: a row moves once per row entered, so rows of different heights
  // don't swap back and forth under a still pointer.
  const overRef = useRef<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const byName = new Map(documents.map((d) => [d.name, d]));
  const rows = [...order, ...documents.map((d) => d.name).filter((n) => !order.includes(n))];

  const commit = (nextOrder: string[], nextChecked: ReadonlySet<string>) =>
    onChange(
      readsFor(
        nextOrder.filter((n) => nextChecked.has(n)),
        spec,
        value,
      ),
    );
  const toggle = (name: string) => {
    const next = new Set(checked);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    commit(rows, next);
  };
  const move = (name: string, to: number) => {
    const next = rows.filter((n) => n !== name);
    next.splice(Math.max(0, Math.min(to, next.length)), 0, name);
    setOrder(next);
    return next;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>, name: string) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const at = rows.indexOf(name);
    commit(move(name, e.key === "ArrowUp" ? at - 1 : at + 1), checked);
  };
  const addName = () => {
    const name = draftName.trim();
    if (!name) return;
    const next = rows.includes(name) ? rows : [...rows, name];
    setOrder(next);
    commit(next, new Set([...checked, name]));
    setDraftName("");
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Documents it reads, in order"
      className="nd-pop nd-pop--reads"
    >
      <div className="nd-pop__title">Documents it reads, in order</div>
      {rows.map((name) => {
        const doc = byName.get(name) ?? { name, isSpec: name === spec, writers: [] };
        return (
          <label
            key={name}
            className={`nd-pop__opt${dragging === name ? " nd-pop__opt--dragging" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragging(name);
              overRef.current = name;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", name);
            }}
            onDragOver={(e) => {
              if (dragging === null) return;
              e.preventDefault();
              if (overRef.current === name) return;
              overRef.current = name;
              if (dragging !== name) move(dragging, rows.indexOf(name));
            }}
            onDrop={(e) => {
              e.preventDefault();
              commit(rows, checked);
              setDragging(null);
            }}
            onDragEnd={() => {
              if (dragging !== null) commit(rows, checked);
              setDragging(null);
            }}
          >
            <span className="nd-pop__grip" aria-hidden>
              <GripVertical size={14} strokeWidth={1.6} />
            </span>
            <input
              type="checkbox"
              className="nd-pop__check"
              checked={checked.has(name)}
              onChange={() => toggle(name)}
              onKeyDown={(e) => onKey(e, name)}
              aria-describedby={noteId}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            />
            <span className="nd-pop__name">{documentLabel(doc)}</span>
            <span className="nd-pop__note">{writersText(doc)}</span>
          </label>
        );
      })}
      <Input
        size="sm"
        placeholder="New document name"
        aria-label="New document name"
        maxLength={DOC_NAME_MAX}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addName();
          }
        }}
      />
      <div className="nd-pop__hint" id={noteId}>
        Drag to change the order. It reads them top to bottom.
      </div>
    </div>
  );
}
