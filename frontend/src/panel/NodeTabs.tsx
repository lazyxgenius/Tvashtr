import { Tabs, type TabItem } from "../design-system/components";
import type { NodeTab } from "../lib/nav";

/**
 * Setup · Skills & tools · Memory · Runs · Docs (PANEL-16). A count shows only when it isn't 0.
 * M7: the team drawer adds Tests between Runs and Docs (`testsCount` given, even 0); the run view's
 * drawer keeps its five. R18: all six show at once in the 384px drawer, as the Quality boards draw
 * the row (`tabsT`): the tabs shrink and "Skills & tools" wraps over three lines beside its count.
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
  // MA (board Test-TabsTight): a two-digit count would push Docs past the drawer, so the row
  // tightens (gap 8, padding 14) — every tab, label and count stays as it is.
  const tight = [skillsCount, memoryCount, testsCount ?? 0].some((n) => n >= 10);
  return (
    <div className={`nd-tabs${tight ? " nd-tabs--tight" : ""}`}>
      <Tabs variant="line" items={items} value={value} onChange={onChange} aria-label="Agent" />
    </div>
  );
}
