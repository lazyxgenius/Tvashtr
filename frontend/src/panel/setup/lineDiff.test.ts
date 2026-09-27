import { describe, expect, it } from "vitest";

import { changedLines } from "./lineDiff";

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
