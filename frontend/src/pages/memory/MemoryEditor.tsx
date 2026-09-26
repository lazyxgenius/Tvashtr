import { useEffect, useRef, useState } from "react";

import { Button, Select, TextArea } from "../../design-system/components";
import type { Memory, MemoryPatch, MemoryPolarity, MemoryScope } from "../../lib/api/memory";
import { FORCE_OPTIONS, draftOf, editPatch, scopeChoices } from "./memoryModel";

/**
 * MEM-13: the row turned into an editor (TkF-Inbox-3) — the text (3 rows), Force and Scope, Cancel
 * and Save. Blank text can't be saved; Save with nothing changed just closes. Save only edits: an
 * Inbox memory stays in the Inbox until Keep (Q7).
 */
export function MemoryEditor({
  memory,
  saving,
  error,
  onCancel,
  onSave,
}: {
  memory: Memory;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  /** `null` = nothing changed. */
  onSave: (patch: MemoryPatch | null) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(memory));
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = text.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const blank = draft.content.trim() === "";
  const submit = () => {
    if (blank || saving) return;
    onSave(editPatch(memory, draft));
  };

  return (
    <li className="mem-edit">
      <TextArea
        ref={text}
        rows={3}
        aria-label="Memory text"
        className="mem-edit__text"
        value={draft.content}
        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="mem-edit__bar">
        <Select
          aria-label="Force"
          className="mem-edit__force"
          value={draft.polarity}
          options={FORCE_OPTIONS}
          onChange={(e) => setDraft({ ...draft, polarity: e.target.value as MemoryPolarity })}
        />
        <Select
          aria-label="Scope"
          className="mem-edit__scope"
          value={draft.scope}
          onChange={(e) => setDraft({ ...draft, scope: e.target.value as MemoryScope })}
        >
          {scopeChoices(memory).map((c) => (
            <option key={c.value} value={c.value} disabled={c.disabled}>
              {c.label}
            </option>
          ))}
        </Select>
        <span className="mem-edit__actions">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={blank} loading={saving}>
            Save
          </Button>
        </span>
      </div>
      {error && (
        <span className="mem-edit__error" role="alert">
          {error}
        </span>
      )}
    </li>
  );
}
