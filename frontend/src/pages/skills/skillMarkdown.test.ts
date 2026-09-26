import { describe, expect, it } from "vitest";

import { parseInline, parseSkillMarkdown } from "./skillMarkdown";

describe("SKILL.md preview reader", () => {
  it("reads headings and bullets (TkF-NewSkill-3)", () => {
    const md =
      "# API conventions\n\n- Routes are nouns: /api/runs, /api/teams.\n- Return 422 for bad input.";
    expect(parseSkillMarkdown(md)).toEqual([
      { kind: "heading", level: 1, inline: [{ kind: "text", text: "API conventions" }] },
      {
        kind: "bullet",
        inline: [{ kind: "text", text: "Routes are nouns: /api/runs, /api/teams." }],
      },
      { kind: "bullet", inline: [{ kind: "text", text: "Return 422 for bad input." }] },
    ]);
  });

  it("joins a paragraph's lines, numbers items, and keeps code blocks and frontmatter as written", () => {
    const md = "---\nname: x\n---\nOne line\nand the next.\n\n1. first\n```\nrun --fast\n```";
    expect(parseSkillMarkdown(md)).toEqual([
      { kind: "code", text: "---\nname: x\n---" },
      { kind: "para", inline: [{ kind: "text", text: "One line and the next." }] },
      { kind: "number", marker: "1.", inline: [{ kind: "text", text: "first" }] },
      { kind: "code", text: "run --fast" },
    ]);
  });

  it("marks `code` and **bold** inside a line, never HTML", () => {
    expect(parseInline("Name files in `code`, **always** <b>")).toEqual([
      { kind: "text", text: "Name files in " },
      { kind: "code", text: "code" },
      { kind: "text", text: ", " },
      { kind: "strong", text: "always" },
      { kind: "text", text: " <b>" },
    ]);
  });

  it("empty text has nothing to show", () => {
    expect(parseSkillMarkdown("  \n\n")).toEqual([]);
  });
});
