import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommandPalette } from "./CommandPalette";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const TEAMS = [
  {
    team_graph_id: "t-ind",
    name: "Indicator sprint team",
    created_at: ago(9000),
    node_count: 5,
    last_run: { status: "awaiting_human", at: ago(30), run_id: "r1" },
    spend_usd: 4.82,
    run_count: 7,
  },
  {
    team_graph_id: "t-docs",
    name: "Docs team",
    created_at: ago(9000),
    node_count: 3,
    last_run: null,
    spend_usd: 0,
    run_count: 0,
  },
];

const RUNS = [
  {
    run_id: "r1",
    idea: "Add an RSI indicator with tests",
    status: "awaiting_human",
    created_at: ago(40),
    updated_at: ago(26),
    team: { id: "t-ind", name: "Indicator sprint team" },
  },
];

const INBOX = {
  items: [
    { key: "memories", kind: "memories", count: 2 },
    {
      key: "run_failed:r9",
      kind: "run_failed",
      team: { id: "t-bug", name: "Bugfix squad" },
      run: { id: "r9" },
    },
    {
      key: "gate:1",
      kind: "approval",
      team: { id: "t-ind", name: "Indicator sprint team" },
      run: { id: "r1" },
      task: { id: 1, kind: "prd_approval", title: "Approve the PRD" },
    },
  ],
};

const DOMAINS = { domains: [{ domain_id: "d1", name: "Indicators" }] };

let runQueries: string[];

beforeEach(() => {
  runQueries = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = new URL(url, "http://x");
      const body =
        u.pathname === "/api/teams"
          ? { teams: TEAMS }
          : u.pathname === "/api/inbox"
            ? INBOX
            : u.pathname === "/api/domains"
              ? DOMAINS
              : u.pathname === "/api/runs"
                ? (runQueries.push(u.searchParams.get("q") ?? ""), { runs: RUNS })
                : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const options = () => screen.getAllByRole("option").map((o) => o.textContent);

describe("CommandPalette", () => {
  it("shows Needs you and the actions for an empty query", async () => {
    render(<CommandPalette open onClose={vi.fn()} />);
    const input = screen.getByRole("combobox", { name: "Search teams, runs and actions" });
    expect(input).toHaveFocus();
    await screen.findByRole("group", { name: "Needs you" });
    expect(options()).toEqual([
      "Approve the specIndicator sprint team",
      "Run failedBugfix squad",
      "Start a runN",
      "New teamT",
      "Add an API keyEngines",
      "Open Toolkit",
    ]);
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("↑↓ move")).toBeInTheDocument();
  });

  it("groups teams, runs and actions for a query", async () => {
    render(<CommandPalette open onClose={vi.fn()} />);
    await screen.findByRole("group", { name: "Needs you" });
    await userEvent.type(screen.getByRole("combobox"), "ind");
    await screen.findByRole("group", { name: "Runs" });
    expect(runQueries).toContain("ind");
    expect(
      within(screen.getByRole("group", { name: "Teams" })).getByRole("option"),
    ).toHaveTextContent("Indicator sprint team7 runs · Awaiting you");
    expect(
      within(screen.getByRole("group", { name: "Runs" })).getByRole("option"),
    ).toHaveTextContent("Add an RSI indicator with testsIndicator sprint team · 26m ago");
    expect(
      within(screen.getByRole("group", { name: "Actions" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Start a run on Indicator sprint team", "Open the Indicators domainDomains"]);
  });

  it("says when nothing matches", async () => {
    render(<CommandPalette open onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole("combobox"), "zzz");
    expect(
      await screen.findByText(
        "Nothing matches “zzz”. Try a team name, a run, or an action like “new team”.",
      ),
    ).toBeInTheDocument();
  });

  it("moves with the arrow keys and opens with Enter", async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    await screen.findByRole("group", { name: "Needs you" });
    const input = screen.getByRole("combobox");
    await userEvent.keyboard("{ArrowDown}");
    const second = screen.getAllByRole("option")[1];
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", second.id);
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(screen.getAllByRole("option").at(-1)).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onClose).toHaveBeenCalled();
    expect(window.location.hash).toBe("#/teams/t-ind/runs/r1");
  });

  it("hovering moves the selection; clicking an action navigates", async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    const key = await screen.findByRole("option", { name: /Add an API key/ });
    await userEvent.hover(key);
    expect(key).toHaveAttribute("aria-selected", "true");
    await userEvent.click(key);
    expect(window.location.hash).toBe("#/engines/keys");
  });

  it("Escape and ⌘K close it", async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
