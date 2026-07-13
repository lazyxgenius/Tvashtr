import { useState } from "react";

import type { MemoryPolarity, NodeMemoryRow } from "../lib/api";
import { POLARITY_META, POLARITY_ORDER, TIER_LABEL } from "../lib/memory";

// The three action modes a fact row renders in: `manage` (pin / edit-inline / delete-with-confirm —
// the shelf's live facts + S5b's drawer), `pending` (Confirm / Discard — the review queue), and
// `archived` (read-only — the superseded/rejected audit list).
export type MemoryFactVariant = "manage" | "pending" | "archived";

export interface MemoryFactProps {
  memory: NodeMemoryRow;
  variant?: MemoryFactVariant;
  // Show the tier tag (Account / This repo / Per-node) — for lists that mix tiers.
  showTier?: boolean;
  onTogglePin?: (m: NodeMemoryRow) => void;
  onSaveEdit?: (m: NodeMemoryRow, patch: { content: string; polarity: MemoryPolarity }) => void;
  onDelete?: (m: NodeMemoryRow) => void;
  onConfirm?: (m: NodeMemoryRow) => void;
  onDiscard?: (m: NodeMemoryRow) => void;
}

/**
 * M-memory S5 — one memory fact row: the content, a colored RFC-2119 polarity badge, an optional
 * tier tag, a "seen N×" confirmation signal + provenance, and per-variant actions. Presentational +
 * self-contained (it owns only the inline edit / delete-confirm UI state); the shelf owns the data.
 * Built clean so S5b (the run-inspector tab + the per-node drawer) reuses it verbatim.
 */
export function MemoryFact({
  memory,
  variant = "manage",
  showTier = false,
  onTogglePin,
  onSaveEdit,
  onDelete,
  onConfirm,
  onDiscard,
}: MemoryFactProps) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftContent, setDraftContent] = useState(memory.content);
  const [draftPolarity, setDraftPolarity] = useState<MemoryPolarity>(memory.polarity);

  const meta = POLARITY_META[memory.polarity];
  const when = memory.created_at ? memory.created_at.slice(0, 10) : null;

  const startEdit = () => {
    setDraftContent(memory.content);
    setDraftPolarity(memory.polarity);
    setConfirmingDelete(false);
    setEditing(true);
  };
  const saveEdit = () => {
    const content = draftContent.trim();
    if (content === "") return;
    onSaveEdit?.(memory, { content, polarity: draftPolarity });
    setEditing(false);
  };

  return (
    <li className="tv-mem-fact">
      <div className="tv-mem-fact__row">
        <span
          className={`tv-badge tv-mem-badge tv-mem-badge--${meta.cls}`}
          title={`${meta.label} — ${memory.polarity}`}
        >
          {meta.label}
        </span>
        {showTier && (
          <span className="tv-badge tv-badge--outline tv-mem-fact__tier">
            {TIER_LABEL[memory.tier]}
          </span>
        )}
        {editing ? (
          <textarea
            className="tv-mem-fact__edit"
            aria-label="Edit content"
            rows={2}
            value={draftContent}
            onChange={(e) => setDraftContent(e.target.value)}
          />
        ) : (
          <span className="tv-mem-fact__content">{memory.content}</span>
        )}
      </div>

      <div className="tv-mem-fact__meta">
        {memory.pinned && <span className="tv-mem-fact__pinned">pinned</span>}
        {memory.confirmation_count > 1 && <span>seen {memory.confirmation_count}×</span>}
        {variant === "archived" && <span className="tv-mem-fact__status">{memory.status}</span>}
        <span>{memory.source_run_id ? "learned from a run" : "added by you"}</span>
        {when && <span>{when}</span>}
      </div>

      {variant === "manage" && (
        <div className="tv-mem-fact__actions">
          {editing ? (
            <>
              <select
                className="tv-mem-fact__polarity"
                aria-label="Edit polarity"
                value={draftPolarity}
                onChange={(e) => setDraftPolarity(e.target.value as MemoryPolarity)}
              >
                {POLARITY_ORDER.map((p) => (
                  <option key={p} value={p}>
                    {POLARITY_META[p].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="tv-btn tv-btn--primary tv-btn--sm"
                aria-label="Save memory"
                onClick={saveEdit}
              >
                Save
              </button>
              <button
                type="button"
                className="tv-btn tv-btn--ghost tv-btn--sm"
                aria-label="Cancel edit"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </>
          ) : confirmingDelete ? (
            <>
              <span className="tv-mem-fact__confirm">Delete this memory?</span>
              <button
                type="button"
                className="tv-btn tv-btn--danger tv-btn--sm"
                aria-label="Confirm delete"
                onClick={() => onDelete?.(memory)}
              >
                Confirm
              </button>
              <button
                type="button"
                className="tv-btn tv-btn--ghost tv-btn--sm"
                aria-label="Cancel delete"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {onTogglePin && (
                <button
                  type="button"
                  className="tv-btn tv-btn--ghost tv-btn--sm"
                  aria-label={`${memory.pinned ? "Unpin" : "Pin"} ${memory.content}`}
                  onClick={() => onTogglePin(memory)}
                >
                  {memory.pinned ? "Unpin" : "Pin"}
                </button>
              )}
              {onSaveEdit && (
                <button
                  type="button"
                  className="tv-btn tv-btn--ghost tv-btn--sm"
                  aria-label={`Edit ${memory.content}`}
                  onClick={startEdit}
                >
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  className="tv-btn tv-btn--ghost tv-btn--sm"
                  aria-label={`Delete ${memory.content}`}
                  onClick={() => setConfirmingDelete(true)}
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}

      {variant === "pending" && (
        <div className="tv-mem-fact__actions">
          <button
            type="button"
            className="tv-btn tv-btn--primary tv-btn--sm"
            aria-label={`Confirm ${memory.content}`}
            onClick={() => onConfirm?.(memory)}
          >
            Confirm
          </button>
          <button
            type="button"
            className="tv-btn tv-btn--ghost tv-btn--sm"
            aria-label={`Discard ${memory.content}`}
            onClick={() => onDiscard?.(memory)}
          >
            Discard
          </button>
        </div>
      )}
    </li>
  );
}
