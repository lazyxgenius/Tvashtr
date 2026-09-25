import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { TeamSummary } from "../../lib/api";
import { HomeContext, type HomeContextValue } from "./homeContext";
import { TeamsSection } from "./TeamsSection";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const SHAPE = {
  nodes: [
    { id: "1", kind: "thinker" as const, role: "pm", label: "PM" },
    { id: "2", kind: "worker" as const, role: "engineer", label: "Engineer" },
    { id: "3", kind: "worker" as const, role: "reviewer", label: "Reviewer" },
    { id: "4", kind: "terminal" as const, role: "ship", label: "Ship" },
  ],
  loops: [{ from: 2, to: 1 }],
};

function team(id: string, name: string, extra: Partial<TeamSummary> = {}): TeamSummary {
  return {
    team_graph_id: id,
    name,
    created_at: ago(60 * 24 * 5),
    node_count: 4,
    last_run: null,
    spend_usd: 0,
    run_count: 0,
    active_run_count: 0,
    awaiting_run_count: 0,
    shape: SHAPE,
    ...extra,
  };
}

const lastRun = (status: string, idea: string, min: number) => ({
  status,
  at: ago(min + 5),
  run_id: `r-${idea}`,
  idea,
  updated_at: ago(min),
});

const TEAMS = [
  team("t1", "Indicator sprint team", {
    last_run: lastRun("awaiting_human", "Add an RSI indicator with tests", 26),
    last_active_at: ago(1),
    spend_usd: 4.82,
    run_count: 7,
    awaiting_run_count: 1,
  }),
  team("t2", "Docs team", {
    last_run: lastRun("running", "Write the API reference", 2),
    last_active_at: ago(2),
    spend_usd: 1.37,
    run_count: 3,
    active_run_count: 1,
  }),
  team("t3", "Full feature squad", {
    last_run: lastRun("completed", "Add CSV export", 2880),
    last_active_at: ago(2880),
    spend_usd: 9.1,
    run_count: 9,
  }),
  team("t4", "Landing page team", { last_active_at: ago(5000), template_name: "PM → Engineer" }),
];

function renderSection(over: Partial<HomeContextValue> = {}) {
  const ctx: HomeContextValue = {
    teams: TEAMS,
    teamsLoading: false,
    teamsError: false,
    reloadTeams: vi.fn(() => Promise.resolve()),
    composerTeamId: null,
    pickTeamForRun: vi.fn(),
    focusComposer: vi.fn(),
    registerComposerFocus: vi.fn(),
    openNewTeam: vi.fn(),
    openRunHistory: vi.fn(),
    historyTeamId: null,
    setHistoryTeamId: vi.fn(),
    ...over,
  };
  render(
    <ToastProvider>
      <HomeContext.Provider value={ctx}>
        <TeamsSection />
      </HomeContext.Provider>
    </ToastProvider>,
  );
  return ctx;
}

const cardNames = () =>
  Array.from(document.querySelectorAll(".hm-team__name")).map((n) => n.textContent);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("TeamsSection", () => {
  it("lists cards by last activity with strip, last run and counts", () => {
    renderSection();
    expect(cardNames()).toEqual([
      "Indicator sprint team",
      "Docs team",
      "Full feature squad",
      "Landing page team",
    ]);
    const card = document.querySelector('[data-team-id="t1"]') as HTMLElement;
    expect(card).toHaveTextContent("Awaiting you");
    expect(card).toHaveTextContent("Add an RSI indicator with tests · 26m ago");
    expect(card).toHaveTextContent("7 runs · $4.82");
    expect(within(card).getByRole("img", { name: "Reviewer" })).toBeInTheDocument();
    expect(card.querySelector(".hm-strip__loop")).toHaveTextContent("⇄");
    expect(document.querySelector('[data-team-id="t4"]')).toHaveTextContent("No runs yet");
  });

  it("counts and filters by status tab", async () => {
    renderSection();
    expect(screen.getByRole("tab", { name: /^All\s*4$/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: /^Needs you\s*1$/ }));
    expect(cardNames()).toEqual(["Indicator sprint team"]);
    await userEvent.click(screen.getByRole("tab", { name: /^Running\s*1$/ }));
    expect(cardNames()).toEqual(["Docs team"]);
    await userEvent.click(screen.getByRole("tab", { name: /^Not run yet\s*1$/ }));
    expect(cardNames()).toEqual(["Landing page team"]);
  });

  it("hides the status tabs with fewer than two teams", () => {
    renderSection({ teams: [TEAMS[0]] });
    expect(screen.queryByRole("tab", { name: /Needs you/ })).toBeNull();
    expect(screen.getByRole("tab", { name: "Grid" })).toBeInTheDocument();
  });

  it("searches by name and shows the no-match state", async () => {
    const ctx = renderSection();
    const search = screen.getByRole("textbox", { name: "Search teams" });
    await userEvent.type(search, "DOCS");
    expect(cardNames()).toEqual(["Docs team"]);
    await userEvent.clear(search);
    await userEvent.type(search, "payments");
    expect(screen.getByText("No teams match “payments”")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New team" }));
    expect(ctx.openNewTeam).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(cardNames()).toHaveLength(4);
  });

  it("sorts from the listbox and remembers the choice", async () => {
    renderSection();
    const sort = screen.getByRole("button", { name: "Sort: Last active" });
    expect(sort).toHaveAttribute("aria-haspopup", "listbox");
    await userEvent.click(sort);
    const list = screen.getByRole("listbox", { name: "Sort teams" });
    expect(within(list).getByRole("option", { name: "Last active" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(within(list).getByRole("option", { name: "Spend" }));
    expect(cardNames()[0]).toBe("Full feature squad");
    expect(screen.getByRole("button", { name: "Sort: Spend" })).toBeInTheDocument();
    expect(window.localStorage.getItem("tv.home.teams.sort")).toBe("spend");
  });

  it("shows a table in list view", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("tab", { name: "List" }));
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual(["Team", "Status", "Last run", "Runs · spend", "Actions"]);
    expect(table).toHaveTextContent("0 · $0.00");
    expect(within(table).queryByRole("button", { name: "Run" })).toBeNull();
    expect(window.localStorage.getItem("tv.home.teams.view")).toBe("list");
  });

  it("Run picks the team for the composer", async () => {
    const ctx = renderSection();
    const card = document.querySelector('[data-team-id="t2"]') as HTMLElement;
    await userEvent.click(within(card).getByRole("button", { name: "Run" }));
    expect(ctx.pickTeamForRun).toHaveBeenCalledWith("t2", { toast: true });
  });

  it("opens the canvas from the card body and the menu", async () => {
    renderSection();
    await userEvent.click(screen.getByText("Add an RSI indicator with tests · 26m ago"));
    expect(window.location.hash).toBe("#/teams/t1");
    window.location.hash = "";
    await userEvent.click(screen.getByRole("button", { name: "More actions for Docs team" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Open canvas" }));
    expect(window.location.hash).toBe("#/teams/t2");
  });

  it("menu offers run history", async () => {
    const ctx = renderSection();
    await userEvent.click(screen.getByRole("button", { name: "More actions for Docs team" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "Open canvas",
      "Start a run",
      "Run history",
      "Rename",
      "Duplicate",
      "Delete team",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Run history" }));
    expect(ctx.openRunHistory).toHaveBeenCalledWith("t2");
  });

  it("rename: a blank name shows the error and sends nothing; a good one saves", async () => {
    const ctx = renderSection();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ...TEAMS[0], name: "Indicators squad" }), { status: 200 }),
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More actions for Indicator sprint team" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Team name" });
    expect(input).toHaveValue("Indicator sprint team");
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.getByText("Give this team a name so you can tell it apart.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.type(input, "Indicators squad{Enter}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Team name" })).toBeNull());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/t1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Indicators squad" });
    expect(screen.getByText("Indicators squad")).toBeInTheDocument();
    expect(ctx.reloadTeams).toHaveBeenCalled();
  });

  it("rename: Escape cancels", async () => {
    renderSection();
    await userEvent.click(screen.getByRole("button", { name: "More actions for Docs team" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Team name" })).toBeNull();
    expect(screen.getByText("Docs team")).toBeInTheDocument();
  });

  it("duplicates a team and reloads the list", async () => {
    const ctx = renderSection();
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(team("t9", "Docs team (copy)")), { status: 201 }),
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "More actions for Docs team" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    await waitFor(() => expect(ctx.reloadTeams).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/t2/duplicate");
    expect(init.method).toBe("POST");
  });

  it("delete: states the impact, deletes and says so", async () => {
    const ctx = renderSection();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ deleted: true }), { status: 200 })),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "More actions for Indicator sprint team" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete team" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Indicator sprint team?" });
    expect(dialog).toHaveTextContent(
      "This deletes the team and its 7 runs, including their history. You can’t undo this.",
    );
    expect(dialog).toHaveTextContent("A run is waiting for your approval. Deleting stops it.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete team" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Indicator sprint team deleted.");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/teams/t1");
    expect(init.method).toBe("DELETE");
    expect(ctx.reloadTeams).toHaveBeenCalled();
  });

  it("delete: a failure keeps the dialog open with the reason", async () => {
    renderSection();
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    await userEvent.click(screen.getByRole("button", { name: "More actions for Docs team" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete team" }));
    const dialog = screen.getByRole("alertdialog", { name: "Delete Docs team?" });
    expect(dialog).toHaveTextContent("A run is in progress. Deleting stops it.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete team" }));
    expect(
      await within(dialog).findByText("Couldn’t delete the team — is the backend running?"),
    ).toBeInTheDocument();
  });

  it("shows skeleton cards while loading and a retry when the list fails", async () => {
    const { unmount } = render(
      <HomeContext.Provider
        value={{ ...renderlessCtx(), teams: [], teamsLoading: true } as HomeContextValue}
      >
        <TeamsSection />
      </HomeContext.Provider>,
    );
    expect(screen.getByLabelText("Loading teams")).toBeInTheDocument();
    unmount();
    const ctx = renderSection({ teams: [], teamsError: true });
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(ctx.reloadTeams).toHaveBeenCalled();
  });
});

function renderlessCtx(): Partial<HomeContextValue> {
  return {
    teamsError: false,
    reloadTeams: vi.fn(() => Promise.resolve()),
    composerTeamId: null,
    pickTeamForRun: vi.fn(),
    focusComposer: vi.fn(),
    registerComposerFocus: vi.fn(),
    openNewTeam: vi.fn(),
    openRunHistory: vi.fn(),
    historyTeamId: null,
    setHistoryTeamId: vi.fn(),
  };
}
