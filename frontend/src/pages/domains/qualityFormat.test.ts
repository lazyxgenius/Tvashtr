import { describe, expect, it } from "vitest";

import type { DomainTestCase, DomainTestRun } from "../../lib/api/domains";
import {
  changeMark,
  compareOptions,
  expectedLabel,
  isMiss,
  missHint,
  modeLabel,
  percent,
  runLine,
  runningText,
  scoreDelta,
  splitKeywords,
} from "./qualityFormat";

const NOW = new Date(2026, 8, 26, 12, 0);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

function run(over: Partial<DomainTestRun> = {}): DomainTestRun {
  return {
    run_id: "r5",
    number: 5,
    status: "completed",
    created_at: ago(120),
    completed_at: ago(120),
    hit_at_k: 0.83,
    keyword_hit: 0.75,
    retrieval_mode: "dense",
    top_k: 8,
    config: { chunking: { size: 600 }, embedding: { model: "text-embedding-3-small" } },
    progress: { done: 12, total: 12 },
    error_message: null,
    results: null,
    ...over,
  };
}

const CASE: DomainTestCase = {
  case_id: "c1",
  question: "How do I verify webhook signatures?",
  expected_files: [{ document_id: "d1", filename: "webhooks.md", exists: true }],
  expected_keywords: ["signature", "secret"],
  ordinal: 1,
};

describe("the Quality tab's words", () => {
  it("names the search modes and scores", () => {
    expect(modeLabel("dense")).toBe("Meaning");
    expect(modeLabel("lexical")).toBe("Exact words");
    expect(modeLabel("hybrid")).toBe("Both");
    expect(percent(0.833)).toBe("83%");
    expect(percent(null)).toBe("—");
  });

  it("says how a score moved against the compared run, and nothing when it didn't", () => {
    expect(scoreDelta(0.92, 0.83, "previous run")).toBe("+9 vs previous run");
    expect(scoreDelta(0.75, 0.8, "Run 3")).toBe("−5 vs Run 3");
    expect(scoreDelta(0.83, 0.83, "previous run")).toBeNull();
    expect(scoreDelta(null, 0.5, "previous run")).toBeNull();
  });

  it("describes the latest run (DM-72)", () => {
    expect(runLine(null, NOW)).toBe("Not run yet");
    expect(runLine(run(), NOW)).toBe("Last run 2 hours ago · Meaning search · 8 passages");
    expect(runLine(run({ completed_at: ago(0.2), retrieval_mode: "hybrid" }), NOW)).toBe(
      "Ran just now · Both search · 8 passages",
    );
  });

  it("labels earlier runs: the previous one by time, older ones by what differed (DM-73)", () => {
    const latest = run();
    const at = (d: number, h: number, m: number) => new Date(2026, 8, d, h, m).toISOString();
    const older = [
      run({ run_id: "r4", number: 4, completed_at: at(24, 10, 2) }),
      run({ run_id: "r3", number: 3, completed_at: at(22, 9, 0) }),
      run({ run_id: "r2", number: 2, completed_at: at(20, 9, 0), retrieval_mode: "lexical" }),
      run({
        run_id: "r1",
        number: 1,
        completed_at: at(19, 9, 0),
        config: { chunking: { size: 500 } },
      }),
      run({
        run_id: "r0",
        number: 1,
        completed_at: at(18, 9, 0),
        config: { chunking: { size: 600 }, embedding: { model: "text-embedding-ada-002" } },
      }),
    ];
    expect(compareOptions(older, latest, NOW).map((o) => [o.label, o.vs])).toEqual([
      ["Previous run · Sep 24, 10:02", "previous run"],
      ["Run 3 · Sep 22 · Meaning search", "Run 3"],
      ["Run 2 · Sep 20 · Exact words search", "Run 2"],
      ["Run 1 · Sep 19 · 500-character pieces", "Run 1"],
      ["Run 1 · Sep 18 · OpenAI text-embedding-ada-002", "Run 1"],
    ]);
  });

  it("marks a result that changed (DM-76)", () => {
    expect(changeMark(true, false)).toBe("fixed");
    expect(changeMark(false, true)).toBe("new miss");
    expect(changeMark(true, true)).toBeNull();
    expect(changeMark(true, undefined)).toBeNull();
  });

  it("estimates the rest of a run: 2.5 s a test until one finishes, then the pace so far", () => {
    const going = run({ status: "running", created_at: ago(0), progress: { done: 0, total: 8 } });
    expect(runningText(going, NOW)).toBe("Running 8 tests… about 20 seconds");
    const later = run({ status: "running", created_at: ago(1), progress: { done: 4, total: 8 } });
    expect(runningText(later, NOW)).toBe("Running 8 tests… about 1 minute");
  });

  it("names the expected files and explains a miss (DM-77, OQ-16)", () => {
    expect(expectedLabel(CASE)).toBe("webhooks.md");
    const two = {
      ...CASE,
      expected_files: [
        ...CASE.expected_files,
        { document_id: "d2", filename: null, exists: false },
      ],
    };
    expect(expectedLabel(two)).toBe("webhooks.md +1");
    expect(expectedLabel({ ...CASE, expected_files: [] })).toBe("—");

    const miss = { case_id: "c1", hit: false, keyword_hit: false, top: [], error: null };
    expect(missHint(CASE, miss, run())).toBe("webhooks.md wasn’t in the top 8. Try “Both” search.");
    expect(missHint(CASE, miss, run({ retrieval_mode: "hybrid" }))).toBe(
      "webhooks.md wasn’t in the top 8.",
    );
    expect(missHint(CASE, { ...miss, hit: true }, run())).toBe("Try “Both” search.");
    expect(isMiss(miss)).toBe(true);
    expect(isMiss({ ...miss, hit: true, keyword_hit: null })).toBe(false);
    expect(isMiss(undefined)).toBe(false);
  });

  it("splits key words on commas", () => {
    expect(splitKeywords(" signature,  secret ,, ")).toEqual(["signature", "secret"]);
  });
});
