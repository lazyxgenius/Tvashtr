import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Switch, Tabs, useToast } from "../../design-system/components";
import {
  type Memory,
  type MemoryCounts,
  getMemoryCounts,
  getReviewMode,
  setReviewMode,
} from "../../lib/api/memory";
import { type MemoryTab, navigate } from "../../lib/nav";
import { publishBadges } from "../../lib/workspaceStatus";
import { AddMemorySheet } from "./AddMemorySheet";
import { MemoryActive } from "./MemoryActive";
import { MemoryArchive } from "./MemoryArchive";
import { MemoryLoading } from "./MemoryEmptyState";
import { MemoryInbox } from "./MemoryInbox";
import { addedMessage } from "./memoryModel";
import "./memory.css";

const REVIEW_TITLE = "Review new memories before they apply";

/**
 * Toolkit › Memory (Toolkit-MemoryInbox, Toolkit-MemoryActive; flows TkF-Review, TkF-Inbox,
 * TkF-Filters, TkF-NoteActions, TkF-Archive, TkF-AddMemory): the page header with Add memory, the
 * review switch (Inbox only), pill tabs "Inbox N / Active N / Archive" from `/api/memories/counts`
 * (the address carries the tab), and the tab's list. The Inbox count is also the nav badge ("2 new").
 * `pick` = the bare address (the nav's Memory link): it opens the Inbox when memories wait there,
 * otherwise Active (MEM-4), once the counts answer.
 */
export function MemoryPage({ tab, pick = false }: { tab: MemoryTab; pick?: boolean }) {
  const toast = useToast();
  const [counts, setCounts] = useState<MemoryCounts | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Memory | null>(null);

  const refreshCounts = useCallback((then?: (c: MemoryCounts | null) => void) => {
    getMemoryCounts().then(
      (c) => {
        setCounts(c);
        publishBadges({ memoryInbox: c.inbox });
        then?.(c);
      },
      // The tabs just go without counts; the lists say what failed.
      () => then?.(null),
    );
  }, []);

  // Read the counts on arrival; from the bare address, they also pick the tab (the Inbox when they
  // can't be read). The pick replaces the address, so Back skips it.
  const picked = useRef(false);
  useEffect(() => {
    if (!pick) {
      // The address a pick just wrote needs no second read.
      if (picked.current) picked.current = false;
      else refreshCounts();
      return;
    }
    let live = true;
    refreshCounts((c) => {
      if (!live) return; // the person went elsewhere meanwhile
      picked.current = true;
      navigate({ page: "memory", tab: c && c.inbox === 0 ? "active" : "inbox" }, { replace: true });
    });
    return () => {
      live = false;
    };
  }, [pick, refreshCounts]);

  // An Undo on a Keep or Discard toast can land after the person opened Active or the Archive (the
  // toast outlives the tab): those lists re-read when this changes.
  const [listsVersion, setListsVersion] = useState(0);
  const onRequeued = useCallback(() => {
    refreshCounts();
    setListsVersion((v) => v + 1);
  }, [refreshCounts]);

  // Add memory (the header's and the empty states'). The new memory applies right away, so the
  // page shows it where it went: first in Active's unpinned group.
  const openAdd = useCallback(() => setAdding(true), []);
  const onAdded = (m: Memory, repo: string | null) => {
    setAdding(false);
    setAdded(m);
    refreshCounts();
    toast({ message: addedMessage(repo) });
    if (tab !== "active") navigate({ page: "memory", tab: "active" });
  };

  return (
    <>
      <div className="pg-head">
        <div>
          <h1 className="pg-head__title mem-title">Memory</h1>
          <p className="pg-head__lede mem-lede">
            What your agents learned across runs. Keep what’s useful, pin what matters, and remove
            what’s wrong.
          </p>
        </div>
        <div className="pg-head__actions">
          <Button variant="primary" className="mem-btn-inline" onClick={openAdd}>
            <Plus size={15} strokeWidth={1.6} aria-hidden />
            <span>Add memory</span>
          </Button>
        </div>
      </div>

      {pick ? (
        // Until the counts pick the tab (a moment).
        <MemoryLoading label="Memory" />
      ) : (
        <MemoryTabs
          tab={tab}
          counts={counts}
          added={added}
          listsVersion={listsVersion}
          refreshCounts={refreshCounts}
          onRequeued={onRequeued}
          openAdd={openAdd}
        />
      )}

      {adding && <AddMemorySheet onClose={() => setAdding(false)} onAdded={onAdded} />}
    </>
  );
}

/** The review switch (Inbox only), the pill tabs with their counts, and the tab's list. */
function MemoryTabs({
  tab,
  counts,
  added,
  listsVersion,
  refreshCounts,
  onRequeued,
  openAdd,
}: {
  tab: MemoryTab;
  counts: MemoryCounts | null;
  added: Memory | null;
  listsVersion: number;
  refreshCounts: () => void;
  onRequeued: () => void;
  openAdd: () => void;
}) {
  return (
    <>
      {tab === "inbox" && <ReviewSwitch />}

      <div>
        <Tabs
          variant="pill"
          aria-label="Memory"
          value={tab}
          onChange={(t) => navigate({ page: "memory", tab: t })}
          items={[
            { value: "inbox", label: "Inbox", count: counts?.inbox ?? null },
            { value: "active", label: "Active", count: counts?.active ?? null },
            { value: "archive", label: "Archive" },
          ]}
        />
      </div>

      {tab === "inbox" ? (
        <MemoryInbox
          onChanged={refreshCounts}
          onRequeued={onRequeued}
          onSeeActive={() => navigate({ page: "memory", tab: "active" })}
        />
      ) : tab === "active" ? (
        <MemoryActive
          onChanged={refreshCounts}
          onAdd={openAdd}
          added={added}
          version={listsVersion}
        />
      ) : (
        <MemoryArchive
          version={listsVersion}
          onChanged={refreshCounts}
          onOpenActive={() => navigate({ page: "memory", tab: "active" })}
        />
      )}
    </>
  );
}

/**
 * MEM-5 / MEM-6: review before apply. The switch flips at once and rolls back if the save fails;
 * the toast's Undo flips it back.
 */
function ReviewSwitch() {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let live = true;
    getReviewMode().then(
      (v) => live && setOn(v),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const apply = async (next: boolean, withUndo: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOn(next);
    try {
      setOn(await setReviewMode(next));
      if (withUndo)
        toast({
          message: next
            ? "New memories now wait in the Inbox."
            : "New memories now apply right away.",
          action: { label: "Undo", onClick: () => void apply(!next, false) },
        });
    } catch {
      setOn(!next);
      toast({ message: "Couldn’t change the review setting. Try again.", tone: "error" });
    } finally {
      inFlight.current = false;
    }
  };

  const copy =
    on === true
      ? "On: every new memory waits in the Inbox until you keep it."
      : on === false
        ? "Off: new memories apply right away. Cautions from failed runs still wait here."
        : failed
          ? "Couldn’t load this setting."
          : "";

  return (
    <div className="mem-review">
      <div>
        <div className="mem-review__title">{REVIEW_TITLE}</div>
        <div className="mem-review__copy">{copy}</div>
      </div>
      <Switch
        aria-label={REVIEW_TITLE}
        checked={on === true}
        disabled={on === null}
        onCheckedChange={(checked) => void apply(checked, true)}
      />
    </div>
  );
}
