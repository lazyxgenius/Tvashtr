import { afterEach, describe, expect, it } from "vitest";

import { ApiDetailError } from "../../lib/api/runs";
import type { TeamGraphNode } from "../../lib/api";
import {
  budgetError,
  defaultTeamId,
  largeRepoNote,
  launchProblem,
  missingKeysSentence,
  parseBudget,
  pickerPhrase,
  readinessHint,
  readinessOf,
} from "./composerModel";
import { TEAMS } from "./homeTestUtils";

afterEach(() => localStorage.clear());

describe("composer rules", () => {
  it("starts on the last team used, else the most recent run, else the first team", () => {
    expect(defaultTeamId(TEAMS)).toBe("t-docs");
    localStorage.setItem("tvashtr.home.lastTeam", "t-bug");
    expect(defaultTeamId(TEAMS)).toBe("t-bug");
    localStorage.setItem("tvashtr.home.lastTeam", "gone");
    expect(defaultTeamId(TEAMS.map((t) => ({ ...t, last_run: null })))).toBe("t-ind");
    expect(defaultTeamId([])).toBeNull();
  });

  it("words readiness per target", () => {
    const [ind, docs, bug] = TEAMS;
    expect(pickerPhrase(ind, false)).toBe("Website: needs 2 keys");
    expect(pickerPhrase(bug, false)).toBe("Website: needs xai key");
    expect(pickerPhrase(docs, false)).toBe("Ready");
    expect(pickerPhrase({ ...docs, run_count: 0, last_run: null }, false)).toBe(
      "Ready · never run",
    );
    expect(readinessHint(readinessOf(ind, false), false)).toEqual({
      tone: "gap",
      text: "Website needs 2 keys",
    });
    expect(readinessHint(readinessOf(ind, true), true)).toEqual({
      tone: "ready",
      text: "Ready on this computer · Claude, Grok",
    });
    expect(readinessHint(readinessOf(docs, false), false)?.text).toBe("Ready on the website");
    expect(readinessHint(readinessOf({ ...docs, readiness: undefined }, false), false)).toBeNull();
  });

  it("checks the budget", () => {
    expect(parseBudget("$5.00")).toBe(5);
    expect(parseBudget("")).toBeUndefined();
    expect(budgetError("$0")).toBe("Enter an amount above $0.");
    expect(budgetError("abc")).toBe("Enter an amount above $0.");
    expect(budgetError("600")).toBe("Budget can’t be more than $500.");
    expect(budgetError("12.50")).toBeNull();
  });

  it("turns launch refusals into composer copy", () => {
    const keys = new ApiDetailError(422, "missing", {
      message: "missing",
      missing_providers: ["xai"],
      missing_nodes: ["engineer"],
    });
    expect(launchProblem(keys, { repo: null, baseRef: null })).toEqual({
      kind: "keys",
      providers: ["xai"],
    });
    const graph = new ApiDetailError(422, "team graph is not runnable", {
      message: "team graph is not runnable",
      errors: [{ message: "Ship is unreachable" }],
    });
    expect(launchProblem(graph, { repo: null, baseRef: null })).toEqual({
      kind: "message",
      message: "This team can’t run yet: Ship is unreachable",
      openTeam: true,
    });
    const busy = new ApiDetailError(429, "You already have 2 runs going.", {
      code: "owner_concurrency_limit",
      message: "You already have 2 runs going.",
    });
    expect(launchProblem(busy, { repo: null, baseRef: null }).message).toBe(
      "You already have 2 runs going.",
    );
    expect(
      launchProblem(new TypeError("fetch failed"), { repo: null, baseRef: null }).message,
    ).toBe("Couldn’t reach the server. Try again in a moment.");
    expect(missingKeysSentence("Bugfix squad", ["xai"])).toBe(
      "Bugfix squad uses xai models, and there’s no API key for it.",
    );
  });

  it("notes a large whole-repo run (the old launch panel's advisory)", () => {
    const node = (over: Partial<TeamGraphNode>): TeamGraphNode => ({
      id: "n",
      role_name: "reviewer",
      kind: "agent",
      model: null,
      engine: null,
      prompt: null,
      position: { x: 0, y: 0 },
      config: null,
      ...over,
    });
    const nodes = [node({ role_name: "reviewer" }), node({ role_name: "engineer" })];
    expect(largeRepoNote(120, false, true, nodes)).toBeNull();
    expect(largeRepoNote(900, true, true, nodes)).toBeNull();
    expect(largeRepoNote(900, false, true, nodes)).toBe(
      "Large repo (~900 files). Working on existing code this size is harder — scope the run to a package in Options, or use a bigger-context model on your worker node(s): reviewer, engineer.",
    );
  });
});
