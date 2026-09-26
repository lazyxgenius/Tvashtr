/**
 * Deleting a file with Undo (DM-53, OQ-12): a client-side deferred commit, no soft-delete schema.
 * The row hides at once and a toast "<file> deleted" offers Undo; the DELETE is sent when the
 * toast closes — or at once, with `fetch keepalive`, when the user leaves the domain (route change,
 * unmount) or the page (`pagehide`). Undo before that restores the row; after it, it says so.
 *
 * Reads are stamped (`readStamp()` when a load starts) and a landed delete takes a stamp too, so a
 * screen subtracts a deleted file only from reads that still include it: `gone(stamp)`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "../../design-system/components";
import { type DomainFile, deleteDomainFile } from "../../lib/api/domains";

/** The Undo window; the toast stays up exactly as long. */
export const UNDO_MS = 6000;

let clock = 0;
/** A monotonic stamp: take one when a load starts; a landed delete takes one too. */
export function readStamp(): number {
  clock += 1;
  return clock;
}

interface Entry {
  domainId: string;
  file: DomainFile;
  /** The stamp taken when the DELETE landed; unset while it can still be undone or is in flight. */
  done?: number;
}

export interface FileDeletes {
  /** Hide this file now and delete it when the Undo toast closes. */
  schedule: (file: DomainFile) => void;
  /** The deleted files a read started at `stamp` still includes (to hide and subtract). */
  gone: (stamp: number) => DomainFile[];
}

export function useFileDeletes(domainId: string, onCommitted: () => void): FileDeletes {
  const toast = useToast();
  const [entries, setEntries] = useState<Entry[]>([]);
  const timers = useRef(new Map<string, number>());
  // Deletes already sent: Undo can't bring these back.
  const sent = useRef(new Set<string>());
  const unsent = useRef(new Map<string, Entry>());
  const live = useRef(true);
  const committed = useRef(onCommitted);
  committed.current = onCommitted;

  const send = useCallback(
    (entry: Entry, keepalive: boolean) => {
      const id = entry.file.document_id;
      if (sent.current.has(id)) return;
      sent.current.add(id);
      unsent.current.delete(id);
      const timer = timers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(id);
      deleteDomainFile(entry.domainId, id, { keepalive })
        .then(() => {
          const done = readStamp();
          if (!live.current) return;
          setEntries((es) => es.map((e) => (e.file.document_id === id ? { ...e, done } : e)));
          committed.current();
        })
        .catch(() => {
          if (!live.current) return;
          sent.current.delete(id);
          setEntries((es) => es.filter((e) => e.file.document_id !== id));
          toast({
            message: `Couldn’t delete ${entry.file.filename}. It’s back in the list.`,
            tone: "error",
          });
          committed.current();
        });
    },
    [toast],
  );

  const undo = useCallback(
    (entry: Entry) => {
      const id = entry.file.document_id;
      if (sent.current.has(id)) {
        toast({ message: `${entry.file.filename} was already deleted.`, tone: "error" });
        return;
      }
      const timer = timers.current.get(id);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(id);
      unsent.current.delete(id);
      setEntries((es) => es.filter((e) => e.file.document_id !== id));
    },
    [toast],
  );

  const schedule = useCallback(
    (file: DomainFile) => {
      const entry: Entry = { domainId, file };
      const id = file.document_id;
      if (sent.current.has(id) || unsent.current.has(id)) return;
      unsent.current.set(id, entry);
      setEntries((es) => [...es, entry]);
      timers.current.set(
        id,
        window.setTimeout(() => send(entry, false), UNDO_MS),
      );
      toast({
        message: `${file.filename} deleted`,
        action: { label: "Undo", onClick: () => undo(entry) },
        duration: UNDO_MS,
      });
    },
    [domainId, send, undo, toast],
  );

  // Leaving the page commits what's still waiting, with keepalive so the request outlives it.
  useEffect(() => {
    const flush = () => {
      for (const entry of [...unsent.current.values()]) send(entry, true);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [send]);

  // Leaving this domain (another domain, another page, unmount) commits too.
  useEffect(() => {
    live.current = true;
    const pending = unsent.current;
    return () => {
      for (const entry of [...pending.values()]) {
        if (entry.domainId === domainId) send(entry, true);
      }
    };
  }, [domainId, send]);

  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const mine = useMemo(() => entries.filter((e) => e.domainId === domainId), [entries, domainId]);
  const gone = useCallback(
    (stamp: number) =>
      mine.filter((e) => e.done === undefined || stamp < e.done).map((e) => e.file),
    [mine],
  );
  return { schedule, gone };
}
