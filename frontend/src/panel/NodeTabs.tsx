import { useEffect, useRef } from "react";

import { Tabs, type TabItem } from "../design-system/components";
import type { NodeTab } from "../lib/nav";

/**
 * Setup · Skills & tools · Memory · Runs · Docs (PANEL-16). A count shows only when it isn't 0.
 * M7: the team drawer adds Tests between Runs and Docs (`testsCount` given, even 0); the run view's
 * drawer keeps its five. Six tabs don't fit the 384px drawer, so that row scrolls sideways (no
 * scrollbar) with every label on one line, and the open tab is kept in view.
 */
export function NodeTabs({
  value,
  onChange,
  skillsCount,
  memoryCount,
  testsCount,
}: {
  value: NodeTab;
  onChange: (tab: NodeTab) => void;
  skillsCount: number;
  memoryCount: number;
  testsCount?: number | null;
}) {
  const withTests = testsCount !== undefined;
  const items: TabItem<NodeTab>[] = [
    { value: "setup", label: "Setup" },
    { value: "skills", label: "Skills & tools", count: skillsCount || null },
    { value: "memory", label: "Memory", count: memoryCount || null },
    { value: "runs", label: "Runs" },
    ...(withTests ? [{ value: "tests" as const, label: "Tests", count: testsCount || null }] : []),
    { value: "docs", label: "Docs" },
  ];
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!withTests) return;
    row.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value, withTests]);
  return (
    <div ref={row} className={`nd-tabs${withTests ? " nd-tabs--scroll" : ""}`}>
      <Tabs variant="line" items={items} value={value} onChange={onChange} aria-label="Agent" />
    </div>
  );
}
