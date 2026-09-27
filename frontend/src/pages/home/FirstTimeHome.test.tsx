import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import { __resetBackendStatusForTests } from "../../lib/backendStatus";
import { __resetGetStartedForTests } from "./getStarted";
import { HomePage } from "./HomePage";

// Counts mounts: a remount loses whatever the user typed into the composer.
let composerMounts = 0;
vi.mock("./Composer", async () => {
  const { useEffect } = await import("react");
  return {
    Composer: () => {
      useEffect(() => {
        composerMounts += 1;
      }, []);
      return <div>COMPOSER</div>;
    },
  };
});
vi.mock("./RunningNow", () => ({ RunningNow: () => <div>RUNNING NOW</div> }));

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

interface Fixture {
  hidden: boolean;
  teams: unknown[];
  runs: unknown[];
  providers: unknown[];
  subscriptions?: unknown[];
}
let fx: Fixture;
let patches: unknown[];

const TEAM = {
  team_graph_id: "t1",
  name: "Landing page team",
  created_at: ago(60),
  node_count: 3,
  last_run: null,
  spend_usd: 0,
  template_key: "two_node",
  template_name: "PM → Engineer",
};

beforeEach(() => {
  __resetGetStartedForTests();
  __resetBackendStatusForTests();
  fx = { hidden: false, teams: [], runs: [], providers: [] };
  patches = [];
  composerMounts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, "http://x").pathname;
      let body: unknown = {};
      if (path === "/api/account/preferences") {
        if (init?.method === "PATCH") {
          const patch = JSON.parse(init.body as string) as { get_started_hidden: boolean };
          patches.push(patch);
          fx.hidden = patch.get_started_hidden;
        }
        body = { get_started_hidden: fx.hidden };
      } else if (path === "/api/teams") body = { teams: fx.teams };
      else if (path === "/api/runs") body = { runs: fx.runs, next_cursor: null };
      else if (path === "/api/providers") body = { providers: fx.providers };
      else if (path === "/api/engines/subscriptions")
        body = { subscriptions: fx.subscriptions ?? [] };
      else if (path === "/api/auth/me")
        body = { id: "u", email: "lazyx@tvashtr.dev", display_name: "Lazyx" };
      else if (path === "/api/templates")
        body = {
          templates: [
            {
              template: "two_node",
              name: "PM → Engineer",
              description: "A PM writes the spec; an Engineer builds and ships it. No review step.",
              shape: { nodes: [], loops: [] },
            },
            {
              template: "full_squad",
              name: "Full feature squad",
              description: "Plan, you approve, build and test in a loop, you approve the ship.",
              shape: { nodes: [], loops: [] },
            },
          ],
          blank: null,
        };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  window.location.hash = "";
});

function renderHome() {
  return render(
    <ToastProvider>
      <HomePage />
    </ToastProvider>,
  );
}

describe("First-time Home", () => {
  it("shows the get-started checklist for a new account", async () => {
    renderHome();
    expect(await screen.findByText("Welcome to Tvashtr, Lazyx.")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Get started" });
    expect(card).toHaveTextContent("0 of 4 done");
    expect(within(card).getByRole("button", { name: "Open Engines" })).toHaveClass(
      "ds-btn--primary",
    );
    expect(within(card).getByRole("button", { name: "New team" })).toHaveClass("ds-btn--ghost");
    expect(await screen.findByText("Start from a template")).toBeInTheDocument();
    // the first-time copy is the shorter one
    expect(
      screen.getByText("A PM writes the spec; an Engineer builds and ships it."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Plan, you approve, build and test, you approve the ship."),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "How Tvashtr works" })).toHaveTextContent(
      "Run it on a repo",
    );
    expect(screen.queryByRole("region", { name: "Teams" })).toBeNull();

    await userEvent.click(within(card).getByRole("button", { name: "Open Engines" }));
    expect(window.location.hash).toBe("#/engines");
  });

  it("picks the layout once its data has loaded, so the composer isn't remounted", async () => {
    fx.providers = [{ provider: "anthropic", key_last4: "abcd", created_at: ago(9) }];
    fx.teams = [TEAM];
    renderHome();
    expect(await screen.findByRole("region", { name: "Get started" })).toBeInTheDocument();
    expect(screen.getByText("COMPOSER")).toBeInTheDocument();
    expect(composerMounts).toBe(1);
  });

  it("shows the main Home when the checklist preference can't be read", async () => {
    vi.mocked(fetch).mockImplementation((url) =>
      Promise.resolve(
        new URL(url as string, "http://x").pathname === "/api/account/preferences"
          ? new Response("{}", { status: 500 })
          : new Response(JSON.stringify({ teams: [TEAM], runs: [], providers: [] }), {
              status: 200,
            }),
      ),
    );
    renderHome();
    expect(await screen.findByText("RUNNING NOW")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Get started" })).toBeNull();
  });

  it("Use template opens New team with that template", async () => {
    renderHome();
    const buttons = await screen.findAllByRole("button", { name: "Use template" });
    await userEvent.click(buttons[1]);
    const dialog = await screen.findByRole("dialog", { name: "New team" });
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: /^Full feature squad/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("marks steps done: engine and team → the composer is next", async () => {
    fx.providers = [{ provider: "anthropic", key_last4: "abcd", created_at: ago(9) }];
    fx.teams = [TEAM];
    renderHome();
    const card = await screen.findByRole("region", { name: "Get started" });
    await waitFor(() => expect(card).toHaveTextContent("2 of 4 done"));
    expect(within(card).getAllByText("Done")).toHaveLength(2);
    expect(within(card).getByRole("button", { name: "Start a run" })).toHaveClass(
      "ds-btn--primary",
    );
    expect(screen.getByText("COMPOSER")).toBeInTheDocument();
  });

  it("all four done: the callout links the first pull request", async () => {
    window.localStorage.setItem("tv.home.getStarted.shown", "1");
    fx.subscriptions = [{ provider: "claude", connected: true }];
    fx.teams = [TEAM];
    fx.runs = [
      {
        run_id: "r1",
        idea: "Add CSV export",
        status: "completed",
        created_at: ago(90),
        pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/1",
        pr_number: 1,
        team: { id: "t1", name: "Landing page team" },
      },
    ];
    renderHome();
    expect(await screen.findByText("You’re all set")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #1" })).toHaveAttribute(
      "href",
      "https://github.com/lazyxgenius/trade_mcp/pull/1",
    );
  });

  it("Hide checklist saves the preference and returns to the normal Home", async () => {
    renderHome();
    await userEvent.click(await screen.findByRole("button", { name: "Hide checklist" }));
    await waitFor(() => expect(patches).toEqual([{ get_started_hidden: true }]));
    expect(await screen.findByRole("region", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checklist hidden. Bring it back from the account menu.",
    );
  });

  it("an account with runs, or a hidden checklist, gets the normal Home", async () => {
    fx.runs = [{ run_id: "r1", idea: "x", status: "completed", created_at: ago(5) }];
    fx.teams = [TEAM];
    const { unmount } = renderHome();
    expect(await screen.findByRole("region", { name: "Teams" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Welcome to Tvashtr/)).toBeNull();
    unmount();

    __resetGetStartedForTests();
    fx = { hidden: true, teams: [], runs: [], providers: [] };
    renderHome();
    expect(await screen.findByRole("region", { name: "Teams" })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Welcome to Tvashtr/)).toBeNull();
  });
});
