import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Switch, Tabs, useToast } from "../../design-system/components";
import {
  type MemoryCounts,
  getMemoryCounts,
  getReviewMode,
  setReviewMode,
} from "../../lib/api/memory";
import { type MemoryTab, navigate } from "../../lib/nav";
import { publishBadges } from "../../lib/workspaceStatus";
import { MemoryActive } from "./MemoryActive";
import { MemoryInbox } from "./MemoryInbox";
import { MemoryList } from "./MemoryList";
import "./memory.css";

const REVIEW_TITLE = "Review new memories before they apply";

/**
 * Toolkit › Memory (Toolkit-MemoryInbox, Toolkit-MemoryActive; flows TkF-Review, TkF-Inbox,
 * TkF-Filters): the page header with Add memory, the review switch (Inbox only), pill tabs
 * "Inbox N / Active N / Archive" from `/api/memories/counts` (the address carries the tab), and the
 * tab's list. The Inbox count is also the nav badge ("2 new").
 */
export function MemoryPage({ tab }: { tab: MemoryTab }) {
  const [counts, setCounts] = useState<MemoryCounts | null>(null);

  const refreshCounts = useCallback(() => {
    getMemoryCounts().then(
      (c) => {
        setCounts(c);
        publishBadges({ memoryInbox: c.inbox });
      },
      // The tabs just go without counts; the lists say what failed.
      () => undefined,
    );
  }, []);
  useEffect(refreshCounts, [refreshCounts]);

  // Add memory (the header's and the empty states') — the drawer is its own slice (G7).
  const openAdd = useCallback(() => undefined, []);

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
          onSeeActive={() => navigate({ page: "memory", tab: "active" })}
        />
      ) : tab === "active" ? (
        <MemoryActive onChanged={refreshCounts} onAdd={openAdd} />
      ) : (
        <MemoryList />
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
