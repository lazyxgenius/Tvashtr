import { describe, expect, it } from "vitest";

import { changedLines, diffLines } from "./lineDiff";

describe("changedLines", () => {
  it("marks nothing when the text is unchanged", () => {
    expect([...changedLines("a\nb", "a\nb")]).toEqual([]);
  });

  it("marks an edited line and an inserted one, not the lines that only moved down", () => {
    const before = "one\n\ntwo\nthree";
    const after = "one\n \ntwo\nnew\nthree!";
    expect([...changedLines(before, after)].sort()).toEqual([1, 3, 4]);
  });

  it("marks nothing for a deleted line (there is no line left to mark)", () => {
    expect([...changedLines("a\nb\nc", "a\nc")]).toEqual([]);
  });

  it("falls back to comparing by position for very long texts", () => {
    const before = Array.from({ length: 600 }, (_, i) => `l${i}`).join("\n");
    const after = before.replace("l5\n", "L5\n");
    expect([...changedLines(before, after)]).toEqual([5]);
  });
});

describe("diffLines", () => {
  const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].join("\n");

  it("keeps three lines of context around a change and counts the lines", () => {
    const after = before.replace("e", "E1\nE2");
    const diff = diffLines(before, after);
    expect(diff.rows).toEqual([
      { op: "same", text: "b" },
      { op: "same", text: "c" },
      { op: "same", text: "d" },
      { op: "del", text: "e" },
      { op: "add", text: "E1" },
      { op: "add", text: "E2" },
      { op: "same", text: "f" },
      { op: "same", text: "g" },
      { op: "same", text: "h" },
    ]);
    expect([diff.added, diff.removed]).toEqual([2, 1]);
  });

  it("marks the unchanged lines left out between two hunks with a gap", () => {
    const after = before.replace("a", "A").replace("j", "J");
    expect(diffLines(before, after, 2).rows.map((r) => r.op)).toEqual([
      "del",
      "add",
      "same",
      "same",
      "gap",
      "same",
      "same",
      "del",
      "add",
    ]);
  });

  it("is empty when nothing changed", () => {
    expect(diffLines(before, before)).toEqual({ rows: [], added: 0, removed: 0 });
  });
});
