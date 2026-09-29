import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InstructionsCard } from "./InstructionsCard";

afterEach(() => vi.restoreAllMocks());

function renderCard(prompt: string, renderedHeight: number) {
  // jsdom lays nothing out: say how tall the editor renders (the card collapses above 196px).
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(renderedHeight);
  render(
    <InstructionsCard
      prompt={prompt}
      onChange={() => {}}
      banner="Added at run time"
      routing={null}
    />,
  );
}

describe("the expander's label (operator report: 'Show all 1 lines')", () => {
  it("says 'Show all' with no count when a few long lines only overflow by wrapping", () => {
    renderCard("Read the PRD below and create exactly the file it specifies. ".repeat(20), 400);
    expect(screen.getByRole("button", { name: "Show all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all \d+ lines?/ })).toBeNull();
  });

  it("keeps the design's line count when the instructions really have many lines (PANEL-29)", () => {
    renderCard(Array.from({ length: 38 }, (_, i) => `line ${i + 1}`).join("\n"), 760);
    expect(screen.getByRole("button", { name: "Show all 38 lines" })).toBeInTheDocument();
  });
});
