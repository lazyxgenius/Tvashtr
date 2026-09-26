import { Archive, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../design-system/components";
import { type Memory, listMemories } from "../../lib/api/memory";
import { MemoryEmptyState, MemoryLoading } from "./MemoryEmptyState";
import { MemoryRow } from "./MemoryRow";
import { sortNewestFirst } from "./memoryModel";

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: Memory[] };

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : String(e));

const fetchArchive = (): Promise<Memory[]> =>
  Promise.all([listMemories("superseded"), listMemories("rejected")]).then(([a, b]) => [
    ...a,
    ...b,
  ]);

/**
 * The Archive tab as a plain list, newest first. Its intro, badges and Restore are their own slice
 * (G6: MemoryArchive replaces this); this keeps the tab readable meanwhile.
 */
export function MemoryList() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const reload = useCallback(() => {
    setLoad({ state: "loading" });
    fetchArchive().then(
      (data) => setLoad({ state: "ready", data: sortNewestFirst(data) }),
      (e: unknown) => setLoad({ state: "error", message: errorText(e) }),
    );
  }, []);
  useEffect(reload, [reload]);

  if (load.state === "loading") return <MemoryLoading label="Archive" />;
  if (load.state === "error")
    return (
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
    );
  if (load.data.length === 0)
    return (
      <MemoryEmptyState
        icon={<Archive size={24} strokeWidth={1.6} />}
        title="Archive is empty"
        body="Memories that were replaced or discarded show up here."
      />
    );

  return (
    <section className="mem-card" aria-label="Archive">
      <ul className="mem-list">
        {load.data.map((m) => (
          <MemoryRow key={m.id} memory={m} />
        ))}
      </ul>
    </section>
  );
}
