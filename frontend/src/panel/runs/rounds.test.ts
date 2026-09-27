import { describe, expect, it } from "vitest";

import { clipDetail, compactTokens, detailParts, runLine } from "./rounds";

describe("clipDetail (PANEL-72 Show all)", () => {
  it("leaves a short detail whole and cuts a long one at a word", () => {
    expect(clipDetail("Looks good.", 20)).toBeNull();
    expect(clipDetail("one two three four", 10)).toBe("one two");
  });

  it("never cuts inside a code span", () => {
    expect(clipDetail("see `core/indicators.py` now", 18)).toBe("see");
  });
});

describe("detailParts", () => {
  it("reads backticked spans and paths as code", () => {
    expect(detailParts("register `INDICATORS` in core/indicators.py, then test")).toEqual([
      { code: false, text: "register " },
      { code: true, text: "INDICATORS" },
      { code: false, text: " in " },
      { code: true, text: "core/indicators.py" },
      { code: false, text: ", then test" },
    ]);
  });
});

describe("compactTokens", () => {
  it("shortens thousands and millions", () => {
    expect([compactTokens(950), compactTokens(1000), compactTokens(16900)]).toEqual([
      "950",
      "1k",
      "16.9k",
    ]);
    expect(compactTokens(2_400_000)).toBe("2.4M");
  });
});

describe("runLine (the run switcher)", () => {
  const run = {
    run_id: "r",
    idea: "Add RSI",
    status: "completed",
    created_at: "2026-09-20T10:00:00Z",
    live: false,
    rounds_count: 1,
    last_outcome: "approved",
    last_status: "done",
    last_round_at: "2026-09-20T10:30:00Z",
  };
  it("names the rounds of a run that looped, else how it went", () => {
    expect(runLine(run)).toMatch(/^Sep 20 · approved$/);
    const recent = new Date(Date.now() - 31 * 60_000).toISOString();
    expect(runLine({ ...run, rounds_count: 3, last_round_at: recent })).toBe("31m ago · 3 rounds");
  });
});
