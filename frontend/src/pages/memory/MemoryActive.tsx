import { Brain, Pencil, Pin, Search, Trash, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button, ConfirmDialog, IconButton, Input, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import {
  type Memory,
  type MemoryPatch,
  type MemoryPolarity,
  type MemoryRepo,
  type MemoryScope,
  deleteMemory,
  listMemories,
  listMemoryRepos,
  pinMemory,
  unpinMemory,
  updateMemory,
} from "../../lib/api/memory";
import { FilterSelect } from "./FilterSelect";
import { MemoryEditor } from "./MemoryEditor";
import { MemoryEmptyState, MemoryLoading } from "./MemoryEmptyState";
import { MemoryRow } from "./MemoryRow";
import {
  FORCE_FILTER_OPTIONS,
  type MemoryFilters,
  NO_FILTERS,
  SCOPE_FILTER_OPTIONS,
  activeMeta,
  isFiltered,
  matchesFilters,
  repoFilterOptions,
  sortActive,
} from "./memoryModel";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: Memory[] };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;
const icon = { size: 14, strokeWidth: 1.6, "aria-hidden": true } as const;

/**
 * Memory › Active (Toolkit-MemoryActive, TkF-Filters-1…5, TkF-MemoryEmpty-1): what agents use now,
 * pinned first then newest. The filter bar (words, Repo, Scope, Force) narrows it with AND and says
 * "1 of 14" with a Clear filters link. Each row can be pinned (pinned notes go to the agent first),
 * edited in place, or deleted. `onChanged` lets the page refresh the tab counts; `onAdd` opens Add
 * memory.
 */
export function MemoryActive({ onChanged, onAdd }: { onChanged: () => void; onAdd: () => void }) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [repos, setRepos] = useState<MemoryRepo[] | null>(null);
  const [filters, setFilters] = useState<MemoryFilters>(NO_FILTERS);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Memory | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoad({ state: "loading" });
    listMemories("active").then(
      (data) => setLoad({ state: "ready", data: sortActive(data) }),
      (e: unknown) => setLoad({ state: "error", message: errorText(e) }),
    );
  }, []);
  useEffect(reload, [reload]);

  // The Repo filter's choices; without them it still lists the memories' own repos.
  useEffect(() => {
    let live = true;
    listMemoryRepos().then(
      (r) => live && setRepos(r),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  const all = useMemo(() => (load.state === "ready" ? load.data : []), [load]);
  const shown = useMemo(() => all.filter((m) => matchesFilters(m, filters)), [all, filters]);
  const repoOptions = useMemo(() => repoFilterOptions(repos, all), [repos, all]);
  const filtered = isFiltered(filters);
  const set = (patch: Partial<MemoryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const clear = () => setFilters(NO_FILTERS);

  const update = (f: (rows: Memory[]) => Memory[]) =>
    setLoad((l) => (l.state === "ready" ? { state: "ready", data: sortActive(f(l.data)) } : l));
  const replace = (saved: Memory) =>
    update((rows) => rows.map((r) => (r.id === saved.id ? saved : r)));
  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** A 404 means it went meanwhile (another tab): show Active as it is now. */
  const failed = (e: unknown) => {
    if (isGone(e)) {
      reload();
      onChanged();
      toast({ message: "That memory is no longer in Active.", tone: "error" });
    } else toast({ message: errorText(e), tone: "error" });
  };

  /** MEM-20: pin or unpin; the toast's Undo flips it back (quietly). */
  const setPinned = async (m: Memory, pinned: boolean, withUndo: boolean) => {
    mark(m.id, true);
    try {
      const saved = pinned ? await pinMemory(m.id) : await unpinMemory(m.id);
      replace(saved);
      if (withUndo)
        toast({
          message: pinned ? "Pinned. Pinned notes go to the agent first." : "Unpinned.",
          action: { label: "Undo", onClick: () => void setPinned(saved, !pinned, false) },
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

  /** MEM-21: save in place; the meta turns to "Edited by you · just now". */
  const save = async (m: Memory, patch: MemoryPatch | null) => {
    if (!patch) {
      setEditing(null);
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      replace(await updateMemory(m.id, patch));
      setEditing(null);
      toast({ message: "Saved. Agents see the new text on their next run." });
    } catch (e) {
      if (isGone(e)) {
        setEditing(null);
        failed(e);
      } else setEditError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const askDelete = (m: Memory) => {
    setDeleteError(null);
    setDeleting(m);
  };

  /** MEM-22: gone for good once confirmed. */
  const confirmDelete = async () => {
    if (!deleting) return;
    const m = deleting;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteMemory(m.id);
      update((rows) => rows.filter((r) => r.id !== m.id));
      setDeleting(null);
      if (editing === m.id) setEditing(null);
      onChanged();
      toast({ message: "Memory deleted." });
    } catch (e) {
      if (isGone(e)) {
        setDeleting(null);
        failed(e);
      } else setDeleteError(errorText(e));
    } finally {
      setDeleteBusy(false);
    }
  };

  const q = filters.q.trim();

  return (
    <>
      <div className="mem-filters">
        <Input
          size="sm"
          className="mem-search"
          placeholder="Search memory"
          aria-label="Search memory"
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <FilterSelect
          label="Repo"
          className="mem-filterbox mem-filterbox--repo"
          listWidth={282}
          value={filters.repo}
          options={repoOptions}
          onChange={(repo) => set({ repo })}
        />
        <FilterSelect
          label="Scope"
          className="mem-filterbox mem-filterbox--scope"
          listWidth={182}
          value={filters.scope}
          options={SCOPE_FILTER_OPTIONS}
          onChange={(scope) => set({ scope: scope as MemoryScope | "" })}
        />
        <FilterSelect
          label="Force"
          className="mem-filterbox mem-filterbox--force"
          listWidth={182}
          value={filters.force}
          options={FORCE_FILTER_OPTIONS}
          onChange={(force) => set({ force: force as MemoryPolarity | "" })}
        />
        {filtered && shown.length > 0 && (
          <>
            <span className="mem-filters__count">
              {shown.length} of {all.length}
            </span>
            <button type="button" className="mem-filters__clear" onClick={clear}>
              Clear filters
            </button>
          </>
        )}
      </div>

      {load.state === "loading" ? (
        <MemoryLoading label="Active" />
      ) : load.state === "error" ? (
        <MemoryEmptyState
          icon={<TriangleAlert size={24} strokeWidth={1.6} />}
          title="Couldn’t load your memories"
          body={load.message}
          actions={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : all.length === 0 ? (
        <MemoryEmptyState
          icon={<Brain size={24} strokeWidth={1.6} />}
          title="Your agents haven’t learned anything yet"
          body="As agents run, useful facts about your repos show up in the Inbox. You can also add your own."
          actions={
            <Button variant="primary" size="sm" onClick={onAdd}>
              Add memory
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <MemoryEmptyState
          icon={<Search size={24} strokeWidth={1.6} />}
          title={q ? `Nothing matches “${q}”` : "Nothing matches these filters"}
          body="Try another word, or clear the filters."
          actions={
            <>
              <Button variant="secondary" size="sm" onClick={clear}>
                Clear filters
              </Button>
              <Button variant="primary" size="sm" onClick={onAdd}>
                Add memory
              </Button>
            </>
          }
        />
      ) : (
        <section className="mem-card" aria-label="Active">
          <ul className="mem-list">
            {shown.map((m) =>
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
                  meta={activeMeta(m)}
                  actions={
                    <>
                      <IconButton
                        size="sm"
                        active={m.pinned}
                        aria-label={m.pinned ? "Unpin" : "Pin"}
                        disabled={busy.has(m.id)}
                        onClick={() => void setPinned(m, !m.pinned, true)}
                      >
                        <Pin {...icon} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        aria-label="Edit"
                        disabled={busy.has(m.id)}
                        onClick={() => openEditor(m)}
                      >
                        <Pencil {...icon} />
                      </IconButton>
                      <IconButton
                        size="sm"
                        aria-label="Delete"
                        disabled={busy.has(m.id)}
                        onClick={() => askDelete(m)}
                      >
                        <Trash {...icon} />
                      </IconButton>
                    </>
                  }
                />
              ),
            )}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this memory?"
        confirmLabel="Delete memory"
        busy={deleteBusy}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      >
        “{deleting?.content}” Agents stop seeing it on their next run. You can’t undo this.
      </ConfirmDialog>
    </>
  );
}
