import { describe, expect, it } from "vitest";

import {
  filesLine,
  filterDomains,
  footerLine,
  formatShortDate,
  formatUpdated,
  pieceSizeLabel,
  qualityLine,
  sortDomains,
  stateBadge,
  usageLine,
} from "./domainFormat";
import { NOW, domainItem, hoursAgo, sampleDomains } from "./domainsTestUtils";

const [support, vendor, research, q3] = sampleDomains();

describe("card lines (DM-10…DM-12)", () => {
  it("reads the design's four sample cards", () => {
    expect([support, vendor, research, q3].map(filesLine)).toEqual([
      "14 files · 1,212 pieces",
      "6 files · reading 4 of 6",
      "9 files · 1 needs attention",
      "No files yet",
    ]);
    expect([support, vendor, research, q3].map(qualityLine)).toEqual([
      "83% found the right file",
      "No test questions yet",
      "60% found the right file",
      "—",
    ]);
    expect([support, vendor, research, q3].map(usageLine)).toEqual([
      "Used 3 times in 2 teams",
      "Not used yet",
      "Used in 1 team",
      "Not used yet",
    ]);
    expect([support, vendor, research, q3].map((d) => footerLine(d, NOW))).toEqual([
      "Updated 2 hours ago",
      "Updated just now",
      "Updated yesterday",
      "Created Sep 23",
    ]);
  });

  it("words the proposed states: waiting for a key, re-reading, not run yet, singulars", () => {
    const base = { total: 3, ready: 0, reading: 0, waiting: 0, waiting_for_key: 3 };
    const waiting = domainItem({
      name: "Q3",
      state: "waiting_for_key",
      files: { ...base, needs_attention: 0 },
    });
    expect(filesLine(waiting)).toBe("3 files · waiting for an openai key");
    expect(
      filesLine({ ...waiting, reading_model: { ...waiting.reading_model, provider: "gemini" } }),
    ).toBe("3 files · waiting for a gemini key");
    const rereading = domainItem({
      name: "R",
      state: "rereading",
      files: { total: 4, ready: 1, reading: 1, waiting: 2, waiting_for_key: 0, needs_attention: 0 },
    });
    expect(filesLine(rereading)).toBe("4 files · re-reading 1 of 4");
    const two = domainItem({
      name: "Two",
      state: "needs_attention",
      files: { total: 5, ready: 3, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 2 },
    });
    expect(filesLine(two)).toBe("5 files · 2 need attention");
    const one = domainItem({
      name: "One",
      state: "ready",
      files: { total: 1, ready: 1, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 0 },
      pieces: 1,
    });
    expect(filesLine(one)).toBe("1 file · 1 piece");
    expect(qualityLine({ ...one, quality: { ...one.quality, cases: 12 } })).toBe(
      "12 test questions · not run yet",
    );
    expect(
      qualityLine({
        ...one,
        quality: { ...one.quality, cases: 2, last_run_at: hoursAgo(1), keyword_hit: 0.5 },
      }),
    ).toBe("50% had the key words");
    expect(usageLine({ ...one, usage: { uses: 2, teams: 1, steps: 1, agents: 1 } })).toBe(
      "Used 2 times in 1 team",
    );
  });

  it("badges each state", () => {
    expect(stateBadge("ready")).toEqual({ variant: "success", dot: true, label: "Ready" });
    expect(stateBadge("reading").label).toBe("Reading");
    expect(stateBadge("rereading").label).toBe("Re-reading");
    expect(stateBadge("needs_attention")).toEqual({
      variant: "warning",
      dot: true,
      label: "Needs attention",
    });
    expect(stateBadge("waiting_for_key").label).toBe("Waiting for a key");
    expect(stateBadge("empty")).toEqual({ variant: "neutral", dot: false, label: "Empty" });
  });
});

describe("dates", () => {
  it("says how long ago, then the date", () => {
    expect(formatUpdated(hoursAgo(0.01), NOW)).toBe("just now");
    expect(formatUpdated(hoursAgo(0.5), NOW)).toBe("30 minutes ago");
    expect(formatUpdated(hoursAgo(1), NOW)).toBe("1 hour ago");
    expect(formatUpdated(hoursAgo(30), NOW)).toBe("yesterday");
    expect(formatUpdated(hoursAgo(72), NOW)).toBe("3 days ago");
    expect(formatUpdated("2026-09-10T10:00:00Z", NOW)).toBe("Sep 10");
    expect(formatShortDate("2025-08-30T10:00:00Z", NOW)).toBe("Aug 30, 2025");
  });

  it("labels piece sizes", () => {
    expect(pieceSizeLabel(600)).toBe("600-character pieces");
    expect(pieceSizeLabel(1000)).toBe("1,000-character pieces");
  });
});

describe("search and sort (DM-7, DM-8)", () => {
  const all = sampleDomains();
  const names = (xs: { name: string }[]) => xs.map((d) => d.name);

  it("filters by a case-insensitive part of the name", () => {
    expect(names(filterDomains(all, "contr"))).toEqual(["Vendor contracts"]);
    expect(names(filterDomains(all, "  PAPERS "))).toEqual(["Research papers"]);
    expect(filterDomains(all, "filings 2025")).toEqual([]);
    expect(filterDomains(all, "")).toHaveLength(4);
  });

  it("sorts four ways", () => {
    expect(names(sortDomains(all, "recent"))).toEqual([
      "Vendor contracts",
      "Support docs",
      "Research papers",
      "Q3 filings",
    ]);
    expect(names(sortDomains(all, "name"))).toEqual([
      "Q3 filings",
      "Research papers",
      "Support docs",
      "Vendor contracts",
    ]);
    expect(names(sortDomains(all, "used"))).toEqual([
      "Support docs",
      "Research papers",
      "Q3 filings",
      "Vendor contracts",
    ]);
    expect(names(sortDomains(all, "attention"))).toEqual([
      "Research papers",
      "Vendor contracts",
      "Support docs",
      "Q3 filings",
    ]);
  });
});
