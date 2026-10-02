import { readFileSync } from "node:fs";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { NodeTab } from "../lib/nav";
import { NodeTabs } from "./NodeTabs";

// Read from disk: a `?raw` CSS import is empty under vitest, which would make the checks vacuous.
const panelCss = readFileSync(`${process.cwd()}/src/panel/panel.css`, "utf8");

function Harness({
  testsCount,
  skillsCount = 4,
  memoryCount = 3,
}: {
  testsCount?: number | null;
  skillsCount?: number;
  memoryCount?: number;
}) {
  const [tab, setTab] = useState<NodeTab>("setup");
  return (
    <NodeTabs
      value={tab}
      onChange={setTab}
      skillsCount={skillsCount}
      memoryCount={memoryCount}
      testsCount={testsCount}
    />
  );
}

const tabs = () =>
  within(screen.getByRole("tablist", { name: "Agent" }))
    .getAllByRole("tab")
    .map((t) => t.textContent);
const selected = () => screen.getByRole("tab", { selected: true }).textContent;

describe("NodeTabs — R18 all six tabs in the drawer", () => {
  it("the team drawer's six tabs, in order, with their counts", () => {
    render(<Harness testsCount={6} />);
    expect(tabs()).toEqual(["Setup", "Skills & tools4", "Memory3", "Runs", "Tests6", "Docs"]);
  });

  it("arrow keys still move the selection (and wrap)", () => {
    render(<Harness testsCount={6} />);
    const list = screen.getByRole("tablist", { name: "Agent" });
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(selected()).toBe("Skills & tools4");
    expect(document.activeElement).toBe(screen.getByRole("tab", { selected: true }));
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(selected()).toBe("Docs");
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(selected()).toBe("Tests6");
  });

  it("the row wraps like the board: no sideways-scroll class, no one-line rule", () => {
    render(<Harness testsCount={6} />);
    const row = screen.getByRole("tablist", { name: "Agent" }).closest(".nd-tabs");
    expect(row).not.toHaveClass("nd-tabs--scroll");
    expect(row).not.toHaveAttribute("style");
    // jsdom can't lay out; the drawer's tab rules must not force one line or scroll sideways.
    expect(panelCss).not.toMatch(/\.nd-tabs[^{]*\{[^}]*(nowrap|overflow-x)/);
  });

  it("two-digit counts tighten the row (MA board Test-TabsTight: gap 8, padding 14)", () => {
    render(<Harness testsCount={6} skillsCount={12} memoryCount={15} />);
    const row = screen.getByRole("tablist", { name: "Agent" }).closest(".nd-tabs");
    expect(row).toHaveClass("nd-tabs--tight");
    expect(tabs()).toEqual(["Setup", "Skills & tools12", "Memory15", "Runs", "Tests6", "Docs"]);
    expect(panelCss).toMatch(/\.nd-tabs--tight \.ds-tabs \{[^}]*padding: 0 14px;[^}]*gap: 8px;/);
  });

  it("single-digit counts keep the board's row (gap 16, padding 18)", () => {
    render(<Harness testsCount={9} skillsCount={9} memoryCount={9} />);
    const row = screen.getByRole("tablist", { name: "Agent" }).closest(".nd-tabs");
    expect(row).not.toHaveClass("nd-tabs--tight");
  });

  it("kept: the run view's drawer has its five tabs", () => {
    render(<Harness />);
    expect(tabs()).toEqual(["Setup", "Skills & tools4", "Memory3", "Runs", "Docs"]);
  });
});
