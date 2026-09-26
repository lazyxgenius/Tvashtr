import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, Pencil, Pin, Trash } from "lucide-react";

import { Button, IconButton, Select, Switch, TextArea } from "../../design-system/components";
import {
  type Memory,
  type MemoryPolarity,
  pinMemory,
  promoteMemory,
  rejectMemory,
  requeueMemory,
  unpinMemory,
  updateMemory,
} from "../../lib/api/memory";
import { patchAgentNode } from "../../lib/api/nodes";
import { type Route, routeToHash } from "../../lib/nav";
import { GithubIcon } from "../../pages/home/homeIcons";
import type { ToastAction } from "../useDrawerToast";
import { FORCE_OPTIONS, noteGroups, noteOrigin } from "./memoryNotes";
import type { NodeMemories } from "./useNodeMemories";
import "../skills/skillsTools.css";
import "./memory.css";

export interface MemoryTabProps {
  teamId: string;
  nodeId: string;
  /** The saved "Remember what it learns" flag (`config.memory_remember_enabled`). */
  rememberSaved: boolean;
  /** The drawer's File access: only agents that can edit files record lessons. */
  editsAllowed: boolean;
  isEntry: boolean;
  memories: NodeMemories;
  notify: (message: string, action?: ToastAction) => void;
  /** The Remember switch saved: refetch the graph. */
  onRememberSaved: () => void;
  onOpenFileAccess: () => void;
  /** Ask before deleting a note (the drawer's confirm). */
  onDelete: (note: Memory) => void;
  onOpenShelf?: (route: Route) => void;
}

/**
 * The Memory tab (PANEL-63..71): the Remember switch, the notes waiting for review, this agent's
 * notes by repo, and a link to the Memory shelf. Everything here saves right away (no Save).
 */
export function MemoryTab({
  teamId,
  nodeId,
  rememberSaved,
  editsAllowed,
  isEntry,
  memories,
  notify,
  onRememberSaved,
  onOpenFileAccess,
  onDelete,
  onOpenShelf,
}: MemoryTabProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { state, active, pending, change } = memories;

  const undo = async (id: string) => {
    if (!(await change(() => requeueMemory(id)))) notify("Couldn’t undo that. Try again.");
  };
  const review = async (note: Memory, keep: boolean) => {
    setBusy(note.id);
    const done = keep
      ? await change(async () => (await promoteMemory(note.id)).mergedId ?? note.id)
      : await change(async () => (await rejectMemory(note.id)).id);
    setBusy(null);
    if (!done) {
      notify(
        keep ? "Couldn’t keep that note. Try again." : "Couldn’t discard that note. Try again.",
      );
      return;
    }
    const undoAction = { label: "Undo", onAction: () => void undo(done.value) };
    notify(keep ? "Kept. It applies to future runs." : "Discarded", undoAction);
  };
  const togglePin = async (note: Memory) => {
    setBusy(note.id);
    const done = await change(() => (note.pinned ? unpinMemory : pinMemory)(note.id));
    setBusy(null);
    if (!done) notify("Couldn’t change the pin. Try again.");
  };
  const saveEdit = async (note: Memory, content: string, polarity: MemoryPolarity) => {
    const done = await change(() => updateMemory(note.id, { content, polarity }));
    if (done) setEditing(null);
    else notify("Couldn’t save the note. Try again.");
  };

  const shelf: Route = { page: "memory", tab: pending.length > 0 ? "inbox" : "active" };
  const empty = state === "ready" && active.length === 0 && pending.length === 0;

  return (
    <div className="nd-mem">
      <RememberCard
        teamId={teamId}
        nodeId={nodeId}
        saved={rememberSaved}
        editsAllowed={editsAllowed}
        isEntry={isEntry}
        onSaved={onRememberSaved}
        onOpenFileAccess={onOpenFileAccess}
      />
      <p className="nd-mem__intro">
        Private lessons that apply only to this agent. Team-wide lessons live in the Memory shelf.
      </p>

      {state === "loading" && (
        <div className="nd-mem__skel" role="status" aria-label="Loading notes">
          <span />
          <span />
        </div>
      )}
      {state === "error" && (
        <div className="nd-mem__error" role="alert">
          Couldn’t load notes.
          <Button variant="secondary" size="sm" onClick={memories.retry}>
            Retry
          </Button>
        </div>
      )}
      {empty && (
        <div className="nd-mem__empty">
          <img src="/mark-coral.png" alt="" width={40} height={40} />
          <div className="nd-mem__empty-title">No notes yet</div>
          <div className="nd-mem__empty-body">
            As this agent runs, lessons that only apply to it will appear here.
          </div>
        </div>
      )}

      {state === "ready" && pending.length > 0 && (
        <section className="nd-mem__group" aria-labelledby="nd-mem-review">
          <h4 className="nd-mem__head" id="nd-mem-review">
            Waiting for your review · {pending.length}
          </h4>
          <ul className="nd-mem__list">
            {pending.map((note) => (
              <li key={note.id} className="nd-mem__note nd-mem__note--pending">
                <div className="nd-mem__text">{note.content}</div>
                <div className="nd-mem__review">
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy === note.id}
                    onClick={() => void review(note, true)}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === note.id}
                    onClick={() => void review(note, false)}
                  >
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state === "ready" &&
        noteGroups(active).map((group) => (
          <section
            key={group.key}
            className="nd-mem__group"
            aria-labelledby={`nd-mem-${group.key || "none"}`}
          >
            <h4 className="nd-mem__head" id={`nd-mem-${group.key || "none"}`}>
              {group.repo && <GithubIcon size={12} />}
              {group.label} · {group.notes.length}
            </h4>
            <ul className="nd-mem__list">
              {group.notes.map((note) => (
                <MemoryNoteRow
                  key={note.id}
                  note={note}
                  busy={busy === note.id}
                  editing={editing === note.id}
                  onTogglePin={() => void togglePin(note)}
                  onEdit={() => setEditing(note.id)}
                  onCancelEdit={() => setEditing(null)}
                  onSave={(content, polarity) => saveEdit(note, content, polarity)}
                  onDelete={() => onDelete(note)}
                />
              ))}
            </ul>
          </section>
        ))}

      <a
        className="nd-mem__shelf"
        href={routeToHash(shelf)}
        onClick={(e) => {
          if (!onOpenShelf) return;
          e.preventDefault();
          onOpenShelf(shelf);
        }}
      >
        Open Memory shelf
        <ArrowRight size={14} strokeWidth={1.6} aria-hidden />
      </a>
    </div>
  );
}

/** PANEL-63: saves the flag alone, right away; off (and locked) for an agent that can't edit files. */
function RememberCard({
  teamId,
  nodeId,
  saved,
  editsAllowed,
  isEntry,
  onSaved,
  onOpenFileAccess,
}: {
  teamId: string;
  nodeId: string;
  saved: boolean;
  editsAllowed: boolean;
  isEntry: boolean;
  onSaved: () => void;
  onOpenFileAccess: () => void;
}) {
  // What was just switched, until the refetched node agrees.
  const [value, setValue] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setValue(null), [saved]);

  const flip = async (on: boolean) => {
    setValue(on);
    setSaving(true);
    setFailed(false);
    try {
      await patchAgentNode(teamId, nodeId, { memory_remember_enabled: on });
      onSaved();
    } catch {
      setValue(null);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  let hint;
  if (isEntry) {
    hint =
      "Only agents that can edit files record new lessons, and the entry agent stays read-only.";
  } else if (!editsAllowed) {
    hint = (
      <>
        Only agents that can edit files record new lessons. Turn on{" "}
        <button type="button" className="nd-mem__access" onClick={onOpenFileAccess}>
          File access
        </button>{" "}
        in Setup to use this.
      </>
    );
  } else {
    hint = "While it works, it writes down lessons worth keeping. They show up here.";
  }
  return (
    <div className="nd-kit__card nd-kit__card--rules">
      <div>
        <div className="nd-kit__opt-title">Remember what it learns</div>
        <div className="nd-kit__opt-desc nd-kit__opt-desc--gap">{hint}</div>
        {failed && (
          <div className="nd-mem__fail" role="alert">
            Couldn’t save. Try again.
          </div>
        )}
      </div>
      <Switch
        aria-label="Remember what it learns"
        checked={editsAllowed && (value ?? saved)}
        disabled={!editsAllowed || saving}
        onCheckedChange={(on) => void flip(on)}
      />
    </div>
  );
}

/** One of this agent's notes (PANEL-67/68): its text, where it came from, Pin / Edit / Delete. */
function MemoryNoteRow({
  note,
  busy,
  editing,
  onTogglePin,
  onEdit,
  onCancelEdit,
  onSave,
  onDelete,
}: {
  note: Memory;
  busy: boolean;
  editing: boolean;
  onTogglePin: () => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (content: string, polarity: MemoryPolarity) => Promise<void>;
  onDelete: () => void;
}) {
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  useEffect(() => {
    // Back on Edit once the editor closes.
    if (wasEditing.current && !editing) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  if (editing) return <NoteEditor note={note} onCancel={onCancelEdit} onSave={onSave} />;
  return (
    <li className="nd-mem__note">
      <div className="nd-mem__text">{note.content}</div>
      <div className="nd-mem__meta">
        <span className="nd-mem__origin">{noteOrigin(note)}</span>
        <div className="nd-mem__actions">
          <IconButton
            size="sm"
            active={note.pinned}
            aria-label="Pin"
            title={note.pinned ? "Pinned: it always reaches this agent" : "Pin"}
            disabled={busy}
            onClick={onTogglePin}
          >
            <span className={`nd-mem__pin${note.pinned ? " nd-mem__pin--on" : ""}`}>
              <Pin size={14} strokeWidth={1.6} aria-hidden />
            </span>
          </IconButton>
          <IconButton ref={editButton} size="sm" aria-label="Edit" onClick={onEdit}>
            <Pencil size={14} strokeWidth={1.6} aria-hidden />
          </IconButton>
          <IconButton size="sm" aria-label="Delete" onClick={onDelete}>
            <Trash size={14} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </div>
      </div>
    </li>
  );
}

function NoteEditor({
  note,
  onCancel,
  onSave,
}: {
  note: Memory;
  onCancel: () => void;
  onSave: (content: string, polarity: MemoryPolarity) => Promise<void>;
}) {
  const [text, setText] = useState(note.content);
  const [force, setForce] = useState<MemoryPolarity>(note.polarity);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await onSave(text.trim(), force);
    setSaving(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    onCancel();
  };
  return (
    <li className="nd-mem__note nd-mem__note--edit" onKeyDown={onKeyDown}>
      <TextArea
        aria-label="Note"
        rows={3}
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
      />
      <div className="nd-mem__edit-row">
        <Select
          aria-label="Force"
          className="nd-mem__force"
          options={FORCE_OPTIONS}
          value={force}
          onChange={(e) => setForce(e.target.value as MemoryPolarity)}
        />
        <span className="nd-mem__edit-actions">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!text.trim()}
            onClick={() => void save()}
          >
            Save note
          </Button>
        </span>
      </div>
    </li>
  );
}
