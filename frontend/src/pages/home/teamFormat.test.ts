import { describe, expect, it } from "vitest";

import type { TeamSummary } from "../../lib/api";
import {
  cardCounts,
  dayRelative,
  deleteImpact,
  lastRunLine,
  rowCounts,
  sortTeams,
  tabCounts,
  teamBadge,
  teamTabOf,
} from "./teamFormat";

const MIN = 60_000;
const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString();

function team(name: string, extra: Partial<TeamSummary> = {}): TeamSummary {
  return {
    team_graph_id: name,
    name,
    created_at: ago(60 * 24 * 10),
    node_count: 3,
    last_run: null,
    spend_usd: 0,
    ...extra,
  };
}

const run = (status: string, minAgo: number, idea = "Add an RSI indicator with tests") => ({
  status,
  at: ago(minAgo + 5),
  run_id: `r-${status}`,
  idea,
  updated_at: ago(minAgo),
});

describe("teamFormat", () => {
  it("maps the latest run to the card's badge", () => {
    expect(teamBadge(team("a"))).toEqual({ variant: "neutral", label: "Not run yet" });
    expect(teamBadge(team("a", { last_run: run("awaiting_human", 1) }))).toEqual({
      variant: "warning",
      label: "Awaiting you",
    });
    expect(teamBadge(team("a", { last_run: run("pending", 1) })).label).toBe("Running");
    expect(teamBadge(team("a", { last_run: run("failed", 1) })).variant).toBe("danger");
    expect(teamBadge(team("a", { last_run: run("completed", 1) })).variant).toBe("success");
    expect(teamBadge(team("a", { last_run: run("cancelled", 1) })).label).toBe("Stopped");
    expect(teamBadge(team("a", { last_run: run("over_budget", 1) })).label).toBe("Over budget");
  });

  it("puts awaiting and failed teams under Needs you, pending/running under Running", () => {
    const teams = [
      team("a", { last_run: run("awaiting_human", 1) }),
      team("b", { last_run: run("failed", 1) }),
      team("c", { last_run: run("running", 1) }),
      team("d"),
      team("e", { last_run: run("completed", 1) }),
    ];
    expect(teams.map(teamTabOf)).toEqual(["needs_you", "needs_you", "running", "not_run", null]);
    expect(tabCounts(teams)).toEqual({ all: 5, needs_you: 2, running: 1, not_run: 1 });
  });

  it("sorts by last active, name, spend and created", () => {
    const a = team("Alpha", { last_active_at: ago(5), spend_usd: 1, created_at: ago(100) });
    const b = team("Bravo", { last_active_at: ago(1), spend_usd: 9.1, created_at: ago(300) });
    const c = team("Charlie", { last_active_at: ago(50), spend_usd: 4, created_at: ago(10) });
    const names = (list: TeamSummary[]) => list.map((t) => t.name);
    expect(names(sortTeams([a, b, c], "last_active"))).toEqual(["Bravo", "Alpha", "Charlie"]);
    expect(names(sortTeams([c, b, a], "name"))).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(names(sortTeams([a, b, c], "spend"))).toEqual(["Bravo", "Charlie", "Alpha"]);
    expect(names(sortTeams([a, b, c], "created"))).toEqual(["Charlie", "Alpha", "Bravo"]);
  });

  it("falls back to the last run and creation time when last_active_at is missing", () => {
    const old = team("Old", { created_at: ago(500) });
    const ran = team("Ran", { created_at: ago(900), last_run: run("completed", 2) });
    expect(sortTeams([old, ran], "last_active").map((t) => t.name)).toEqual(["Ran", "Old"]);
  });

  it("writes the counts and the last-run line", () => {
    expect(
      cardCounts(team("a", { run_count: 7, spend_usd: 4.82, last_run: run("completed", 1) })),
    ).toBe("7 runs · $4.82");
    expect(
      cardCounts(team("a", { run_count: 1, spend_usd: 0.5, last_run: run("completed", 1) })),
    ).toBe("1 run · $0.50");
    expect(cardCounts(team("a", { run_count: 0 }))).toBe("No runs yet");
    expect(rowCounts(team("a", { run_count: 0 }))).toBe("0 · $0.00");

    expect(lastRunLine(team("a", { last_run: run("awaiting_human", 26) }))).toBe(
      "Add an RSI indicator with tests · 26m ago",
    );
    expect(lastRunLine(team("a", { last_run: { ...run("running", 2), at: ago(11) } }))).toBe(
      "Add an RSI indicator with tests · started 11m ago",
    );
  });

  it("says where a never-run team came from", () => {
    const now = new Date(2026, 8, 25, 12, 0);
    const yesterday = new Date(2026, 8, 24, 9, 0).toISOString();
    expect(dayRelative(yesterday, now)).toBe("yesterday");
    expect(dayRelative(new Date(2026, 8, 25, 1, 0).toISOString(), now)).toBe("today");
    expect(
      lastRunLine(team("a", { created_at: yesterday, template_name: "PM → Engineer" }), now),
    ).toBe("Created yesterday from PM → Engineer");
    expect(lastRunLine(team("a", { created_at: yesterday }), now)).toBe("Created yesterday");
    expect(
      lastRunLine(
        team("a", {
          created_at: new Date().toISOString(),
          duplicated_from: { team_graph_id: "x", name: "X" },
        }),
      ),
    ).toBe("Copied just now");
  });

  it("states the impact of deleting a team", () => {
    expect(
      deleteImpact(team("a", { run_count: 7, awaiting_run_count: 1, active_run_count: 0 })),
    ).toEqual({
      body: "This deletes the team and its 7 runs, including their history. You can’t undo this.",
      warning: "A run is waiting for your approval. Deleting stops it.",
    });
    expect(
      deleteImpact(team("a", { run_count: 1, active_run_count: 1, awaiting_run_count: 0 })),
    ).toEqual({
      body: "This deletes the team and its 1 run, including their history. You can’t undo this.",
      warning: "A run is in progress. Deleting stops it.",
    });
    expect(deleteImpact(team("a", { run_count: 0 }))).toEqual({
      body: "This deletes the team. You can’t undo this.",
      warning: null,
    });
  });
});
