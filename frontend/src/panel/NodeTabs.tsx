import { Tabs, type TabItem } from "../design-system/components";
import type { NodeTab } from "../lib/nav";

/** Setup · Skills & tools · Memory · Runs · Docs (PANEL-16). A count shows only when it isn't 0. */
export function NodeTabs({
  value,
  onChange,
  skillsCount,
  memoryCount,
}: {
  value: NodeTab;
  onChange: (tab: NodeTab) => void;
  skillsCount: number;
  memoryCount: number;
}) {
  const items: TabItem<NodeTab>[] = [
    { value: "setup", label: "Setup" },
    { value: "skills", label: "Skills & tools", count: skillsCount || null },
    { value: "memory", label: "Memory", count: memoryCount || null },
    { value: "runs", label: "Runs" },
    { value: "docs", label: "Docs" },
  ];
  return (
    <div className="nd-tabs">
      <Tabs variant="line" items={items} value={value} onChange={onChange} aria-label="Agent" />
    </div>
  );
}
