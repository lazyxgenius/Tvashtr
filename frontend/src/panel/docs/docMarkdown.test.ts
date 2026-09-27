import { describe, expect, it } from "vitest";

import { compareDocs, docBlocks, linesLabel, renderMarkdown } from "./docMarkdown";

const V2 = [
  "# Add an RSI indicator",
  "",
  "## Acceptance",
  "",
  "- `TestRegistry` lists 29 indicators, including `rsi`.",
  "- `TestRegistry` lists 28 indicators.",
  "",
  "## Out of scope",
  "",
  "- Alerts on RSI crossovers.",
].join("\n");
const V3 = V2.replace(
  "- `TestRegistry` lists 28 indicators.",
  "- `web/lib/engine-facts.ts` sets `indicator_count` to 29.\n- A unit test checks RSI against a known series.",
);

describe("docMarkdown", () => {
  it("renders markdown and never raw HTML", () => {
    expect(renderMarkdown("## Goals\n\n- Ship `rsi`")).toContain("<h2>Goals</h2>");
    expect(renderMarkdown("<script>x()</script>")).not.toContain("<script>");
  });

  it("splits a document into headings, paragraphs, code blocks and list items", () => {
    expect(
      docBlocks("# T\n\nOne\ntwo\n\n- a\n  - a.1\n- b\n\n```\ncode\n```\n\n1. first\n2. second"),
    ).toEqual([
      "# T",
      "One\ntwo",
      "- a\n  - a.1",
      "- b",
      "```\ncode\n```",
      "1. first",
      "2. second",
    ]);
  });

  it("compares two versions block by block, counting lines (Docs-Compare)", () => {
    const diff = compareDocs(V2, V3);
    expect(diff.blocks.map((b) => b.op)).toEqual([
      "same",
      "same",
      "same",
      "del",
      "add",
      "add",
      "same",
      "same",
    ]);
    expect(diff.blocks[3].html).toContain("lists 28 indicators.");
    expect([diff.added, diff.removed]).toEqual([2, 1]);
    expect(linesLabel("+", diff.added)).toBe("+2 lines");
    expect(linesLabel("−", diff.removed)).toBe("−1 line");
    // An ordered item keeps its number when it renders on its own.
    expect(compareDocs("", "1. a\n2. b").blocks[1].html).toContain('<ol start="2">');
  });
});
