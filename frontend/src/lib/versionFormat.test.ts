import { describe, expect, it } from "vitest";

import type { VersionChange } from "./api/versions";
import { diffPill, restoreTitles, runLook, runMeta, runsPill, versionAge } from "./versionFormat";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("versionFormat (M5's words, as the Ver-* boards print them)", () => {
  it("versionAge: 2m ago, yesterday, 3 days ago, 1 week ago", () => {
    expect(versionAge(ago(0.5), NOW)).toBe("just now");
    expect(versionAge(ago(2), NOW)).toBe("2m ago");
    expect(versionAge(ago(5 * 60), NOW)).toBe("5h ago");
    expect(versionAge(ago(30 * 60), NOW)).toBe("yesterday");
    expect(versionAge(ago(3 * 1440), NOW)).toBe("3 days ago");
    expect(versionAge(ago(8 * 1440), NOW)).toBe("1 week ago");
    expect(versionAge(ago(20 * 1440), NOW)).toBe("2 weeks ago");
    expect(versionAge("nope", NOW)).toBe("");
    // In a sentence: "saved 2 minutes ago", "saved yesterday".
    expect(versionAge(ago(2), NOW, true)).toBe("2 minutes ago");
    expect(versionAge(ago(1), NOW, true)).toBe("1 minute ago");
    expect(versionAge(ago(60), NOW, true)).toBe("1 hour ago");
    expect(versionAge(ago(30 * 60), NOW, true)).toBe("yesterday");
  });

  it("runsPill / diffPill", () => {
    expect([0, 1, 3].map(runsPill)).toEqual(["no runs", "1 run", "3 runs"]);
    expect(diffPill(1, 2)).toBe("1 removed, 2 added");
    expect(diffPill(0, 2)).toBe("2 added");
    expect(diffPill(3, 0)).toBe("3 removed");
  });

  it("restoreTitles: one line per change, every route in one (Ver-RestoreDraft)", () => {
    const row = (over: Partial<VersionChange>): VersionChange => ({
      key: "k",
      agent: "Engineer",
      field: null,
      kind: "changed",
      ...over,
    });
    expect(
      restoreTitles(
        [
          row({ key: "t", agent: "Reviewer", field: "Instructions", kind: "text" }),
          row({
            key: "m",
            field: "Model",
            kind: "value",
            before: "a",
            after: "openai/gpt-4.1-mini",
          }),
          row({ key: "b", field: "Backup model", kind: "value", before: "x", after: null }),
          row({
            key: "team:budget_usd",
            agent: null,
            field: "Budget",
            kind: "value",
            after: "$5.00",
          }),
          row({ key: "s", field: "Skills", kind: "changed" }),
          row({ key: "g", agent: "Spec approval", kind: "added", gate: true }),
          row({ key: "a", agent: "Architect", kind: "added" }),
          row({ key: "route:1", agent: null, field: "Routes", kind: "added", text: "A → B" }),
          row({ key: "g2", agent: "Escalation", kind: "removed", gate: true }),
          row({ key: "route:2", agent: null, field: "Routes", kind: "removed", text: "B → C" }),
          row({ key: "r", agent: "Tester", kind: "removed" }),
        ],
        6,
      ),
    ).toEqual([
      "Reviewer › Instructions go back to the v6 text",
      "Engineer › Model goes back to openai/gpt-4.1-mini",
      "Engineer › Backup model is cleared",
      "Budget goes back to $5.00",
      "Engineer › Skills go back to v6’s",
      "The Spec approval gate comes back",
      "The Architect comes back",
      "Routes go back to how they were in v6",
      "The Escalation gate is removed",
      "The Tester is removed",
    ]);
  });

  it("runLook: the plain state words", () => {
    expect(runLook("completed")).toEqual({ label: "Done", variant: "success" });
    expect(runLook("failed")).toEqual({ label: "Failed", variant: "danger" });
    expect(runLook("cancelled")).toEqual({ label: "Stopped", variant: "neutral" });
    expect(runLook("running")).toEqual({ label: "Working", variant: "info" });
    expect(runLook("awaiting_human")).toEqual({ label: "Needs you", variant: "warning" });
  });

  it("runMeta: duration · spend · pull request / resumed as / stopped by you", () => {
    const run = {
      run_id: "r",
      status: "completed",
      idea: "x",
      created_at: ago(30),
      updated_at: ago(8),
      cost_total_usd: 0,
      spent_usd: 1.12,
    };
    expect(runMeta({ ...run, pr_number: 42, pr_url: "https://x/pull/42" })).toBe(
      "22m · $1.12 · pull request #42",
    );
    expect(runMeta({ ...run, status: "failed", resumed_as: 13 })).toBe(
      "22m · $1.12 · resumed as #13",
    );
    expect(runMeta({ ...run, status: "cancelled" })).toBe("22m · $1.12 · stopped by you");
    expect(runMeta({ ...run, spent_usd: undefined, cost_total_usd: 0.5 })).toBe("22m · $0.50");
  });
});
