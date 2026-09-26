import { CircleCheck, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { reportFetchOk } from "../../lib/backendStatus";
import {
  type Memory,
  type MemoryPatch,
  isEmbeddingFailure,
  listMemories,
  promoteMemory,
  rejectMemory,
  requeueMemory,
  updateMemory,
} from "../../lib/api/memory";
import { MemoryEditor } from "./MemoryEditor";
import { MemoryEmptyState, MemoryLoading } from "./MemoryEmptyState";
import { MemoryRow } from "./MemoryRow";
import { EDIT_EMBED_FAILED, keptMessage, sortNewestFirst } from "./memoryModel";

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: T };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;

/**
 * Memory › Inbox (Toolkit-MemoryInbox, TkF-Inbox-1…4): what runs taught, newest first, each with
 * Keep / Edit / Discard. Keep and Discard take the row out and toast with an Undo that sends it back
 * (`/requeue`; for a merge, the id that was merged). Edit opens the inline editor in place.
 * `onChanged` lets the page refresh the tab counts and the nav badge; `onRequeued` tells it an Undo
 * moved a memory back (the toast outlives the tab, so Active or the Archive may be showing).
 */
export function MemoryInbox({
  onChanged,
  onRequeued,
  onSeeActive,
}: {
  onChanged: () => void;
  onRequeued: () => void;
  onSeeActive: () => void;
}) {
  const toast = useToast();
  const [load, setLoad] = useState<Load<Memory[]>>({ state: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoad({ state: "loading" });
    listMemories("pending_review").then(
      (data) => setLoad({ state: "ready", data: sortNewestFirst(data) }),
      (e: unknown) => setLoad({ state: "error", message: errorText(e) }),
    );
  }, []);
  useEffect(reload, [reload]);

  const update = (f: (rows: Memory[]) => Memory[]) =>
    setLoad((l) => (l.state === "ready" ? { state: "ready", data: f(l.data) } : l));
  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** Undo: back to the Inbox, in its place by date. */
  const undo = async (id: string) => {
    try {
      const { memory } = await requeueMemory(id);
      update((rows) => sortNewestFirst([...rows.filter((r) => r.id !== memory.id), memory]));
      onRequeued();
    } catch (e) {
      toast({ message: `Couldn’t undo: ${errorText(e)}`, tone: "error" });
    }
  };

  /** A 404 means someone (another tab) already handled it: show the Inbox as it is now. */
  const failed = (e: unknown) => {
    if (isGone(e)) {
      reload();
      onChanged();
      toast({ message: "That memory is no longer in the Inbox.", tone: "error" });
    } else toast({ message: errorText(e), tone: "error" });
  };

  const keep = async (m: Memory) => {
    mark(m.id, true);
    try {
      const res = await promoteMemory(m.id);
      update((rows) => rows.filter((r) => r.id !== m.id));
      if (editing === m.id) setEditing(null);
      onChanged();
      toast({
        message: keptMessage(m, res),
        action: { label: "Undo", onClick: () => void undo(res.mergedId ?? m.id) },
      });
    } catch (e) {
      failed(e);
    } finally {
      mark(m.id, false);
    }
  };

  const discard = async (m: Memory) => {
    mark(m.id, true);
    try {
      await rejectMemory(m.id);
      update((rows) => rows.filter((r) => r.id !== m.id));
      onChanged();
      toast({
        message: "Discarded. You’ll find it in Archive.",
        action: { label: "Undo", onClick: () => void undo(m.id) },
      });
    } catch (e) {
      failed(e);
    } finally {
      mark(m.id, false);
    }
  };

  const openEditor = (m: Memory) => {
    setEditError(null);
    setEditing(m.id);
  };

  const save = async (m: Memory, patch: MemoryPatch | null) => {
    if (!patch) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const saved = await updateMemory(m.id, patch);
      update((rows) => rows.map((r) => (r.id === m.id ? saved : r)));
      setEditing(null);
      toast({ message: "Saved." });
    } catch (e) {
      if (isGone(e)) {
        setEditing(null);
        failed(e);
      } else if (isEmbeddingFailure(e)) {
        // The app answered; only the embedding service behind it didn't.
        reportFetchOk();
        setEditError(EDIT_EMBED_FAILED);
      } else setEditError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  if (load.state === "loading") return <MemoryLoading label="Inbox" />;
  if (load.state === "error")
    return (
      <MemoryEmptyState
        icon={<TriangleAlert size={24} strokeWidth={1.6} />}
        title="Couldn’t load the Inbox"
        body={load.message}
        actions={
          <Button variant="secondary" size="sm" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  if (load.data.length === 0)
    return (
      <MemoryEmptyState
        icon={<CircleCheck size={24} strokeWidth={1.6} />}
        title="Inbox is clear"
        body="New memories from your runs show up here for you to keep or discard."
        actions={
          <Button variant="secondary" size="sm" onClick={onSeeActive}>
            See Active
          </Button>
        }
      />
    );

  return (
    <section className="mem-card" aria-label="Inbox">
      <ul className="mem-list">
        {load.data.map((m) =>
          editing === m.id ? (
            <MemoryEditor
              key={m.id}
              memory={m}
              saving={saving}
              error={editError}
              onCancel={() => setEditing(null)}
              onSave={(patch) => void save(m, patch)}
            />
          ) : (
            <MemoryRow
              key={m.id}
              memory={m}
              actions={
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy.has(m.id)}
                    onClick={() => void keep(m)}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy.has(m.id)}
                    onClick={() => openEditor(m)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy.has(m.id)}
                    onClick={() => void discard(m)}
                  >
                    Discard
                  </Button>
                </>
              }
            />
          ),
        )}
      </ul>
    </section>
  );
}
