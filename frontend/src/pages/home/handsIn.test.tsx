import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HAND_IN_HINT } from "../../canvas/runBlocked";
import type { TeamSummary } from "../../lib/api";
import { newestTeam } from "../desktop/readyCard";
import { defaultTeamId } from "./composerModel";
import { TEAMS, homeRoutes, mockApi, renderHome, resetHomeState } from "./homeTestUtils";
import { buildPaletteGroups } from "./paletteItems";
import { RunHistorySheet } from "./RunHistorySheet";

// M2 polish: a team that ends in Hand in can only be started from a model, so no picker that
// starts an ordinary run offers it. The Teams list and the team's own canvas still show it.
const BUILDER: TeamSummary = {
  ...TEAMS[1],
  team_graph_id: "t-ex",
  name: "Example builder",
  created_at: new Date().toISOString(),
  hands_in: true,
  last_run: { status: "completed", at: new Date().toISOString(), run_id: "r-ex" },
};

beforeEach(() => resetHomeState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetHomeState();
});

describe("teams that hand in are not offered for an ordinary run", () => {
  it("the composer never starts on one, even the last used or the newest", () => {
    localStorage.setItem("tvashtr.home.lastTeam", "t-ex");
    expect(defaultTeamId([...TEAMS, BUILDER])).toBe("t-docs");
    expect(defaultTeamId([BUILDER])).toBeNull();
  });

  it("the Desktop ready card launches the newest team that can run", () => {
    const older = { ...TEAMS[0], created_at: "2026-09-01T00:00:00Z" };
    expect(newestTeam([older, BUILDER])?.team_graph_id).toBe(older.team_graph_id);
    expect(newestTeam([BUILDER])).toBeNull();
  });

  it("Start a run's team list leaves it out while the Teams list still shows it", async () => {
    mockApi(homeRoutes({ "GET /api/teams": { teams: [...TEAMS, BUILDER] } }));
    renderHome();
    await screen.findByText("Ready on the website");
    const composer = screen.getByRole("region", { name: "Start a run" });
    await userEvent.click(within(composer).getByRole("button", { name: /Docs team/ }));
    const list = screen.getByRole("listbox", { name: "Your teams" });
    expect(within(list).getByRole("option", { name: /Bugfix squad/ })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /Example builder/ })).toBeNull();
    expect(document.querySelector('[data-team-id="t-ex"]')).toHaveTextContent("Example builder");
  });

  it("⌘K offers the team to open but not 'Start a run on' it", () => {
    const groups = buildPaletteGroups({
      query: "e",
      teams: [BUILDER, TEAMS[0]],
      runs: [],
      domains: [],
      inbox: [],
    });
    const labels = (name: string) =>
      groups.find((g) => g.label === name)?.options.map((o) => o.label);
    expect(labels("Teams")).toEqual(["Example builder", "Indicator sprint team"]);
    expect(labels("Actions")).toContain("Start a run on Indicator sprint team");
    expect(labels("Actions")).not.toContain("Start a run on Example builder");
  });

  it("an empty run history offers Start a run, except for a team that hands in", async () => {
    mockApi({ "GET /api/teams/:id/runs": { runs: [] } });
    const start = vi.fn();
    const { rerender } = render(
      <RunHistorySheet teamId="t-docs" teamName="Docs team" onClose={vi.fn()} onStartRun={start} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Start a run" }));
    expect(start).toHaveBeenCalledWith("t-docs");
    rerender(<RunHistorySheet teamId="t-ex" teamName="Example builder" onClose={vi.fn()} />);
    expect(await screen.findByText(HAND_IN_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a run" })).toBeNull();
  });
});
