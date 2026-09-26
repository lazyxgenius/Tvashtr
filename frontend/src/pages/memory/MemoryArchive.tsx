import { Archive, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Badge, Button, useToast } from "../../design-system/components";
import { ApiError } from "../../lib/api";
import { type Memory, listMemories, promoteMemory } from "../../lib/api/memory";
import { MemoryEmptyState, MemoryLoading } from "./MemoryEmptyState";
import { MemoryRow } from "./MemoryRow";
import { archiveMeta, restoredMessage, sortArchive } from "./memoryModel";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: Memory[] };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));
const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;

const fetchArchive = (): Promise<Memory[]> =>
  Promise.all([listMemories("superseded"), listMemories("rejected")]).then(([replaced, gone]) =>
    sortArchive([...replaced, ...gone]),
  );

/**
 * Memory › Archive (TkF-Archive-1, TkF-Archive-2): what was replaced or discarded, most recent
 * first. Agents don't see these. A replaced memory has a neutral "Superseded" badge and no action;
 * a discarded one has an outline "Discarded" badge and Restore, which puts it back in Active
 * through the same consolidation as Keep. `onChanged` refreshes the tab counts; `onOpenActive` is
 * the toast's "Open Active". A change of `version` re-reads it quietly (another tab's Undo moved a
 * memory).
 */
export function MemoryArchive({
  onChanged,
  onOpenActive,
  version = 0,
}: {
  onChanged: () => void;
  onOpenActive: () => void;
  version?: number;
}) {
  const toast = useToast();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setLoad({ state: "loading" });
    fetchArchive().then(
      (data) => live.current && setLoad({ state: "ready", data }),
      (e: unknown) => live.current && setLoad({ state: "error", message: errorText(e) }),
    );
  }, []);
  useEffect(reload, [reload]);

  /** Re-read the Archive without the loading card (a restore can merge or retire another row). */
  const refresh = () =>
    fetchArchive().then(
      (data) => live.current && setLoad({ state: "ready", data }),
      () => undefined,
    );

  // Not on mount (the load above reads it): only when the page says memories moved meanwhile.
  const seenVersion = useRef(version);
  useEffect(() => {
    if (seenVersion.current === version) return;
    seenVersion.current = version;
    void refresh();
  }, [version]);

  const mark = (id: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** MEM-27: Restore a discarded memory to Active. */
  const restore = async (m: Memory) => {
    mark(m.id, true);
    try {
      const res = await promoteMemory(m.id);
      setLoad((l) =>
        l.state === "ready" ? { state: "ready", data: l.data.filter((r) => r.id !== m.id) } : l,
      );
      onChanged();
      toast({
        message: restoredMessage(res),
        action: { label: "Open Active", onClick: onOpenActive },
      });
      void refresh();
    } catch (e) {
      if (isGone(e)) {
        reload();
        onChanged();
        toast({ message: "That memory is no longer in the Archive.", tone: "error" });
      } else toast({ message: errorText(e), tone: "error" });
    } finally {
      mark(m.id, false);
    }
  };

  return (
    <>
      <p className="mem-archive__intro">
        Memories that were replaced or discarded. Agents don’t see these. You can restore a
        discarded one.
      </p>

      {load.state === "loading" ? (
        <MemoryLoading label="Archive" />
      ) : load.state === "error" ? (
        <MemoryEmptyState
          icon={<TriangleAlert size={24} strokeWidth={1.6} />}
          title="Couldn’t load the Archive"
          body={load.message}
          actions={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : load.data.length === 0 ? (
        <MemoryEmptyState
          icon={<Archive size={24} strokeWidth={1.6} />}
          title="Nothing in the Archive"
          body="When you discard a memory, or a newer one replaces it, it shows up here."
        />
      ) : (
        <section className="mem-card" aria-label="Archive">
          <ul className="mem-list">
            {load.data.map((m) => (
              <MemoryRow
                key={m.id}
                memory={m}
                meta={archiveMeta(m)}
                actions={
                  m.status === "rejected" ? (
                    <>
                      <Badge variant="outline">Discarded</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy.has(m.id)}
                        onClick={() => void restore(m)}
                      >
                        Restore
                      </Button>
                    </>
                  ) : (
                    <Badge variant="neutral">Superseded</Badge>
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
