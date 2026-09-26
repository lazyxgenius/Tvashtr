import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Memory } from "../../lib/api/memory";
import {
  FORCE_FILTER_OPTIONS,
  FORCE_OPTIONS,
  FORCE_VARIANT,
  NO_FILTERS,
  activeMeta,
  draftOf,
  editPatch,
  isFiltered,
  keptMessage,
  matchesFilters,
  provenance,
  repoFilterOptions,
  scopeChip,
  scopeChoices,
  shortDate,
  sortActive,
  sortNewestFirst,
  whenLabel,
} from "./memoryModel";
import {
  ACTIVE,
  ACT_CONTEXT,
  ACT_MAY,
  ACT_MUST,
  ACT_SHOULD,
  MEM_MUST_NOT,
  MEM_SHOULD,
  NOW,
  memory,
} from "./memoryTestUtils";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("force", () => {
  it("maps each force to the design's badge variant, strongest first", () => {
    expect(FORCE_OPTIONS.map((o) => `${o.label}:${FORCE_VARIANT[o.value]}`)).toEqual([
      "MUST:danger",
      "SHOULD:warning",
      "MAY:info",
      "CONTEXT:neutral",
      "SHOULD NOT:warning",
      "MUST NOT:danger",
    ]);
  });
});

describe("dates", () => {
  it("reads like the design", () => {
    expect(shortDate("2026-09-23T12:00:00Z")).toBe("Sep 23");
    expect(whenLabel(new Date(NOW - 31 * 60_000).toISOString())).toBe("31m ago");
    expect(whenLabel(new Date(NOW - 10_000).toISOString())).toBe("just now");
    expect(whenLabel("2026-09-01T12:00:00Z")).toBe("Sep 1");
    expect(whenLabel("nope")).toBe("");
  });
});

describe("scopeChip", () => {
  it("names the agent and its team, the repo, or the account", () => {
    expect(scopeChip(MEM_SHOULD)).toEqual({
      kind: "agent",
      label: "Reviewer · Indicator sprint team",
    });
    expect(scopeChip(MEM_MUST_NOT)).toEqual({ kind: "repo", label: "lazyxgenius/trade_mcp" });
    expect(scopeChip(memory({ tier: "account", repo_key: null, repo_label: null }))).toEqual({
      kind: "account",
      label: "Account · all repos",
    });
  });

  it("uses the agent's own title, and says when the agent is gone", () => {
    const titled = memory({
      ...MEM_SHOULD,
      agent: { ...MEM_SHOULD.agent!, title: "Riya" },
    });
    expect(scopeChip(titled).label).toBe("Riya · Indicator sprint team");
    const removed = memory({
      ...MEM_SHOULD,
      agent: { node_id: "n1", role_name: null, title: null, team_id: null, team_name: null },
    });
    expect(scopeChip(removed).label).toBe("Removed agent");
  });
});

describe("provenance", () => {
  it("names the run, the round and when", () => {
    expect(provenance(MEM_SHOULD)).toBe("From run “Add an RSI indicator” · round 3 · 31m ago");
  });

  it("calls a failed run's warning a caution", () => {
    expect(provenance(MEM_MUST_NOT)).toBe("From a failed run · Sep 23 · a caution");
  });

  it("a failed run's positive fact is still just a run's", () => {
    const m = memory({ ...MEM_MUST_NOT, polarity: "require" });
    expect(provenance(m)).toBe("From run “Wire the indicator page” · round 2 · 2d ago");
  });

  it("copes with a deleted run and a memory a person added", () => {
    const gone = memory({
      source: { ...MEM_SHOULD.source, run_title: null, round: null },
      created_at: new Date(NOW - 5_000).toISOString(),
    });
    expect(provenance(gone)).toBe("From a run · just now");
    const manual = memory({
      source: { ...MEM_SHOULD.source, kind: "manual" },
      created_at: "2026-09-10T12:00:00Z",
    });
    expect(provenance(manual)).toBe("Added by you · Sep 10");
  });
});

describe("keptMessage", () => {
  it("names the agent only for an agent memory", () => {
    expect(keptMessage(MEM_SHOULD, { action: "promote" })).toBe(
      "Kept. Reviewer uses it from the next run.",
    );
    expect(keptMessage(MEM_MUST_NOT, { action: "promote" })).toBe(
      "Kept. Agents use it from the next run.",
    );
  });

  it("says what a merge or a supersede did", () => {
    expect(keptMessage(MEM_SHOULD, { action: "promote_merged" })).toBe(
      "Already known. Confirmed the existing memory.",
    );
    expect(keptMessage(MEM_SHOULD, { action: "promote_supersede" })).toBe(
      "Kept. It replaces an older memory that said the opposite.",
    );
  });
});

describe("the inline editor", () => {
  it("offers Agent only with a known agent and Repo only with a repo", () => {
    const enabled = (m: Memory) =>
      scopeChoices(m)
        .filter((c) => !c.disabled)
        .map((c) => c.label);
    expect(enabled(MEM_SHOULD)).toEqual(["Account", "Repo", "Agent"]);
    expect(enabled(MEM_MUST_NOT)).toEqual(["Account", "Repo", "Agent"]);
    // An agent "remember" capture: no learner on record.
    expect(enabled(memory({ ...MEM_MUST_NOT, source_node_id: null }))).toEqual(["Account", "Repo"]);
    const manualAccount = memory({
      tier: "account",
      repo_key: null,
      node_id: null,
      source_node_id: null,
      source: { ...MEM_SHOULD.source, kind: "manual" },
    });
    expect(enabled(manualAccount)).toEqual(["Account"]);
  });

  it("patches only what changed", () => {
    const d = draftOf(MEM_MUST_NOT);
    expect(d).toEqual({ content: MEM_MUST_NOT.content, polarity: "forbid", scope: "repo" });
    expect(editPatch(MEM_MUST_NOT, d)).toBeNull();
    expect(editPatch(MEM_MUST_NOT, { ...d, content: `  ${d.content}  ` })).toBeNull();
    expect(editPatch(MEM_MUST_NOT, { ...d, content: " New text ", polarity: "avoid" })).toEqual({
      content: "New text",
      polarity: "avoid",
    });
    expect(editPatch(MEM_SHOULD, { ...draftOf(MEM_SHOULD), scope: "repo" })).toEqual({
      scope: "repo",
    });
  });
});

describe("sortNewestFirst", () => {
  it("puts the newest memory on top", () => {
    expect(sortNewestFirst([MEM_MUST_NOT, MEM_SHOULD]).map((m) => m.id)).toEqual([
      MEM_SHOULD.id,
      MEM_MUST_NOT.id,
    ]);
  });
});

describe("Active meta (MEM-18)", () => {
  it("says where it came from, then pinned or when", () => {
    expect(ACTIVE.map(activeMeta)).toEqual([
      "Confirmed 3× · pinned",
      "Confirmed 1× · Sep 24",
      "Added by you · Sep 20",
      "Confirmed 2× · Sep 18",
    ]);
  });

  it("an edit wins, and a fresh one reads just now", () => {
    const now = new Date(NOW).toISOString();
    expect(activeMeta({ ...ACT_SHOULD, edited_at: now })).toBe("Edited by you · just now");
    expect(activeMeta({ ...ACT_MUST, edited_at: now })).toBe("Edited by you · pinned");
    expect(
      activeMeta({ ...ACT_CONTEXT, created_at: new Date(NOW - 3 * 3600_000).toISOString() }),
    ).toBe("Added by you · 3h ago");
  });
});

describe("sortActive (MEM-19)", () => {
  it("puts pinned first, then newest", () => {
    const pinnedOld = { ...ACT_MAY, pinned: true };
    expect(sortActive([ACT_CONTEXT, ACT_MAY, ACT_SHOULD, ACT_MUST]).map((m) => m.id)).toEqual(
      ACTIVE.map((m) => m.id),
    );
    expect(sortActive([ACT_SHOULD, pinnedOld, ACT_MUST]).map((m) => m.id)).toEqual([
      ACT_MUST.id,
      ACT_MAY.id,
      ACT_SHOULD.id,
    ]);
  });
});

describe("filters (MEM-16)", () => {
  const ids = (f: Partial<typeof NO_FILTERS>) =>
    ACTIVE.filter((m) => matchesFilters(m, { ...NO_FILTERS, ...f })).map((m) => m.id);

  it("no filter keeps everything", () => {
    expect(isFiltered(NO_FILTERS)).toBe(false);
    expect(isFiltered({ ...NO_FILTERS, q: "  " })).toBe(false);
    expect(ids({})).toHaveLength(4);
  });

  it("filters by force, scope and words (text, repo or agent)", () => {
    expect(ids({ force: "prefer" })).toEqual([ACT_SHOULD.id]);
    expect(ids({ scope: "account" })).toEqual([ACT_CONTEXT.id, ACT_MAY.id]);
    expect(ids({ scope: "agent" })).toEqual([ACT_SHOULD.id]);
    expect(ids({ q: "FLY.IO" })).toEqual([ACT_CONTEXT.id]);
    expect(ids({ q: "reviewer" })).toEqual([ACT_SHOULD.id]);
    expect(ids({ q: "docker" })).toEqual([]);
  });

  it("a repo keeps its memories and the account-wide ones (Q9)", () => {
    expect(ids({ repo: "lazyxgenius/trade_mcp" })).toEqual(ACTIVE.map((m) => m.id));
    expect(ids({ repo: "lazyxgenius/cryptoground-mcp" })).toEqual([ACT_CONTEXT.id, ACT_MAY.id]);
  });

  it("combines with AND", () => {
    expect(isFiltered({ ...NO_FILTERS, force: "allow" })).toBe(true);
    expect(ids({ scope: "account", force: "allow" })).toEqual([ACT_MAY.id]);
    expect(ids({ scope: "repo", q: "uvx" })).toEqual([]);
  });

  it("offers every force after Any force", () => {
    expect(FORCE_FILTER_OPTIONS.map((o) => o.label)).toEqual([
      "Any force",
      "MUST",
      "SHOULD",
      "MAY",
      "CONTEXT",
      "SHOULD NOT",
      "MUST NOT",
    ]);
  });
});

describe("repoFilterOptions", () => {
  const repo = (key: string, n: number) => ({
    repo_key: key,
    label: key,
    memory_count: n,
    pending_count: 0,
    last_run_at: null,
  });

  it("lists repos with memories first, then the rest in the server's order", () => {
    const repos = [repo("lazyxgenius/cryptoground-mcp", 0), repo("lazyxgenius/trade_mcp", 9)];
    expect(repoFilterOptions(repos, ACTIVE).map((o) => o.label)).toEqual([
      "All repos",
      "lazyxgenius/trade_mcp",
      "lazyxgenius/cryptoground-mcp",
    ]);
  });

  it("still names the memories' repos when the repo list failed", () => {
    expect(repoFilterOptions(null, ACTIVE)).toEqual([
      { value: "", label: "All repos" },
      { value: "lazyxgenius/trade_mcp", label: "lazyxgenius/trade_mcp" },
    ]);
    expect(repoFilterOptions(null, [])).toEqual([{ value: "", label: "All repos" }]);
  });
});
