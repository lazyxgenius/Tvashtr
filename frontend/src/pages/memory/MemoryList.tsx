import { Archive, BookOpen, TriangleAlert } from "lucide-react";
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

const fetchTab = (tab: "active" | "archive"): Promise<Memory[]> =>
  tab === "active"
    ? listMemories("active")
    : Promise.all([listMemories("superseded"), listMemories("rejected")]).then(([a, b]) => [
        ...a,
        ...b,
      ]);

/**
 * The Active and Archive tabs as plain lists, newest first. The Active tab's filters and note
 * actions and the Archive's Restore are their own slices; this keeps the tabs readable meanwhile.
 */
export function MemoryList({ tab }: { tab: "active" | "archive" }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const label = tab === "active" ? "Active" : "Archive";

  const reload = useCallback(() => {
    setLoad({ state: "loading" });
    fetchTab(tab).then(
      (data) => setLoad({ state: "ready", data: sortNewestFirst(data) }),
      (e: unknown) => setLoad({ state: "error", message: errorText(e) }),
    );
  }, [tab]);
  useEffect(reload, [reload]);

  if (load.state === "loading") return <MemoryLoading label={label} />;
  if (load.state === "error")
    return (
      <MemoryEmptyState
        icon={<TriangleAlert size={24} strokeWidth={1.6} />}
        title={`Couldn’t load ${tab === "active" ? "your memories" : "the Archive"}`}
        body={load.message}
        actions={
          <Button variant="secondary" size="sm" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  if (load.data.length === 0)
    return tab === "active" ? (
      <MemoryEmptyState
        icon={<BookOpen size={24} strokeWidth={1.6} />}
        title="Your agents haven’t learned anything yet"
        body="As agents run, useful facts about your repos show up in the Inbox. You can also add your own."
      />
    ) : (
      <MemoryEmptyState
        icon={<Archive size={24} strokeWidth={1.6} />}
        title="Archive is empty"
        body="Memories that were replaced or discarded show up here."
      />
    );

  return (
    <section className="mem-card" aria-label={label}>
      <ul className="mem-list">
        {load.data.map((m) => (
          <MemoryRow key={m.id} memory={m} />
        ))}
      </ul>
    </section>
  );
}
