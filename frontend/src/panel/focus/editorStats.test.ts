import { describe, expect, it } from "vitest";

import { approxTokens, caretPosition, sizeLine } from "./editorStats";

describe("caretPosition", () => {
  const text = "first\nsecond line\n\nfourth";
  it("counts lines and columns from 1", () => {
    expect(caretPosition(text, 0)).toEqual({ line: 1, column: 1 });
    expect(caretPosition(text, 5)).toEqual({ line: 1, column: 6 });
    expect(caretPosition(text, 6)).toEqual({ line: 2, column: 1 });
    expect(caretPosition(text, 13)).toEqual({ line: 2, column: 8 });
    expect(caretPosition(text, 18)).toEqual({ line: 3, column: 1 });
    expect(caretPosition(text, 19)).toEqual({ line: 4, column: 1 });
    expect(caretPosition(text, text.length)).toEqual({ line: 4, column: 7 });
  });
  it("clamps an offset past either end", () => {
    expect(caretPosition(text, -3)).toEqual({ line: 1, column: 1 });
    expect(caretPosition(text, 999)).toEqual({ line: 4, column: 7 });
  });
});

describe("approxTokens / sizeLine", () => {
  it("is the executor's characters ÷ 4, to the nearest ten above 100", () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(7)).toBe(1);
    expect(approxTokens(399)).toBe(99);
    expect(approxTokens(1284)).toBe(320);
    expect(approxTokens(1300)).toBe(330);
  });
  it("reads like the design's counter", () => {
    expect(sizeLine(1284)).toBe("1,284 characters · about 320 tokens");
    expect(sizeLine(1)).toBe("1 character · about 0 tokens");
    expect(sizeLine(4)).toBe("4 characters · about 1 token");
  });
});
