import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reportFetchFailed, reportFetchOk } from "../../lib/backendStatus";
import {
  type Call,
  DOCS_RUN,
  RSI_RUN,
  TEAMS,
  homeRoutes,
  jsonError,
  mockApi,
  renderHome,
  resetHomeState,
  runRow,
} from "./homeTestUtils";

beforeEach(() => resetHomeState());
afterEach(() => {
  vi.unstubAllGlobals();
  resetHomeState();
});

const posts = (calls: Call[], path: string) =>
  calls.filter((c) => c.method === "POST" && c.path.startsWith(path));

async function ideaBox() {
  return screen.findByRole("textbox", { name: "What should the team build?" });
}

describe("Home greeting", () => {
  it("greets by name and links the three counts", async () => {
    mockApi(homeRoutes());
    renderHome();
    expect(
      await screen.findByRole("heading", { name: /^Good (morning|afternoon|evening), Lazyx\.$/ }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "4 things need you" })).toBeInTheDocument();
    // awaiting_human runs count under "need you", not "in progress" (HOME-8).
    expect(screen.getByRole("link", { name: "1 run in progress" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "$6.19 spent this week" })).toBeInTheDocument();
  });

  it("says Nothing needs you and shows the all-caught-up state when the inbox is empty", async () => {
    mockApi(
      homeRoutes({
        "GET /api/inbox": { count: 0, items: [] },
        "GET /api/runs": { runs: [], next_cursor: null },
      }),
    );
    renderHome();
    expect(await screen.findByText("Nothing needs you")).toBeInTheDocument();
    expect(screen.getByText("nothing running")).toBeInTheDocument();
    expect(
      screen.getByText(
        /You’re all caught up\. Approvals, failed runs and setup gaps show up here\./,
      ),
    ).toBeInTheDocument();
    // Running now shows its empty state (HmF-FirstTime-7).
    expect(
      within(screen.getByRole("region", { name: "Running now" })).getByText(
        "Nothing is running. Start a run above, or open a team.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Backend unreachable", () => {
  it("keeps the sections and says so when the backend comes back", async () => {
    mockApi(homeRoutes());
    renderHome();
    expect(await screen.findByRole("link", { name: "4 things need you" })).toBeInTheDocument();
    act(() => reportFetchFailed());
    // Stale data stays on screen while offline.
    expect(screen.getByRole("link", { name: "4 things need you" })).toBeInTheDocument();
    act(() => reportFetchOk());
    expect(await screen.findByText("Reconnected. Everything is up to date.")).toBeInTheDocument();
  });
});

describe("Start a run", () => {
  it("refuses an empty idea without sending anything", async () => {
    const calls = mockApi(homeRoutes());
    renderHome();
    await ideaBox();
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Describe what the team should build.",
    );
    expect(posts(calls, "/api/runs")).toHaveLength(0);
  });

  it("launches on the chosen repo with the budget, stays on Home and clears the idea", async () => {
    const calls = mockApi(homeRoutes({ "POST /api/runs": { run_id: "r-new" } }));
    renderHome();
    // Default team = the one with the most recent run (Docs team, ready on the website).
    await screen.findByText("Ready on the website");
    await screen.findByText("lazyxgenius/trade_mcp");
    await userEvent.type(await ideaBox(), "Add a Stochastic RSI indicator with tests");
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(posts(calls, "/api/runs")).toHaveLength(1));
    expect(posts(calls, "/api/runs")[0].body).toEqual({
      team_graph_id: "t-docs",
      idea: "Add a Stochastic RSI indicator with tests",
      github_repo: "lazyxgenius/trade_mcp",
      base_ref: "main",
      budget_cap_usd: 5,
    });
    expect(await screen.findByText("Run started on Docs team.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open run" })).toBeInTheDocument();
    expect(await ideaBox()).toHaveValue("");
  });

  it("a typed local path fills Base branch with the inspected repo's current branch", async () => {
    // Self-hosted website (Q15): the repo picker takes a path on the server's disk. The old launch
    // panel filled the branch from the inspect answer; the composer must too, and must launch on it.
    const routes = homeRoutes({
      "POST /api/repo/inspect": {
        is_git: true,
        current_branch: "trunk",
        branches: ["dev", "trunk"],
        subpaths: [],
        tracked_file_count: 3,
      },
      "POST /api/runs": { run_id: "r-local" },
    });
    routes["GET /api/config"] = {
      ...(routes["GET /api/config"] as Record<string, unknown>),
      hosted_mode: false,
    };
    const calls = mockApi(routes);
    renderHome();
    await screen.findByText("Ready on the website");
    await userEvent.click(await screen.findByRole("button", { name: /No repo · fresh app/ }));
    const picker = await screen.findByRole("dialog", { name: "Pick a repo" });
    await userEvent.type(
      within(picker).getByLabelText("Repository path"),
      "/srv/repos/demo{enter}",
    );
    await waitFor(() => expect(posts(calls, "/api/repo/inspect")).toHaveLength(1));

    await userEvent.click(screen.getByRole("button", { name: "Options" }));
    const options = await screen.findByRole("dialog", { name: "Run options" });
    await waitFor(() => expect(within(options).getByLabelText("Base branch")).toHaveValue("trunk"));
    await userEvent.click(screen.getByRole("button", { name: "Options" }));

    await userEvent.type(await ideaBox(), "Add a Stochastic RSI indicator with tests");
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(posts(calls, "/api/runs")).toHaveLength(1));
    expect(posts(calls, "/api/runs")[0].body).toMatchObject({
      repo_path: "/srv/repos/demo",
      base_ref: "trunk",
    });
  });

  it("stops a launch with missing keys and walks through the Add-an-API-key sheets", async () => {
    localStorage.setItem("tvashtr.home.lastTeam", "t-ind");
    const calls = mockApi(
      homeRoutes({ "POST /api/providers": { provider: "x", key_last4: "wQ3f" } }),
    );
    renderHome();
    await screen.findByText("Website needs 2 keys");
    await userEvent.type(await ideaBox(), "Add a Stochastic RSI indicator with tests");
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Can’t run on the website yet.");
    expect(alert).toHaveTextContent(
      "Indicator sprint team uses anthropic and xai models, and there’s no API key for them.",
    );
    expect(posts(calls, "/api/runs")).toHaveLength(0);

    await userEvent.click(within(alert).getByRole("button", { name: "Add keys" }));
    const sheet = await screen.findByRole("dialog", { name: "Add an API key" });
    expect(within(sheet).getByText("Key 1 of 2 · then xai")).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("API key"), "sk-ant-1");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save key" }));
    expect(await within(sheet).findByText("Key 2 of 2")).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("API key"), "xai-2");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save key" }));
    expect(
      await screen.findByText("Keys saved. Indicator sprint team can run on the website."),
    ).toBeInTheDocument();
    expect(posts(calls, "/api/providers").map((c) => c.body)).toEqual([
      { provider: "anthropic", api_key: "sk-ant-1" },
      { provider: "xai", api_key: "xai-2" },
    ]);
  });

  it("shows the server's branch refusal in plain words", async () => {
    mockApi(
      homeRoutes({
        "POST /api/runs": jsonError(422, {
          code: "unknown_base_ref",
          message: "base_ref is not a branch",
          base_ref: "nope",
          branches: ["main"],
        }),
      }),
    );
    renderHome();
    await screen.findByText("lazyxgenius/trade_mcp");
    await userEvent.type(await ideaBox(), "Something");
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No branch named nope in lazyxgenius/trade_mcp.",
    );
  });

  it("marks a Desktop launch with desktop_target", async () => {
    document.documentElement.dataset.tvashtrDesktop = "true";
    const calls = mockApi(homeRoutes({ "POST /api/runs": { run_id: "r-new" } }));
    renderHome();
    await screen.findByText("Ready on this computer");
    await screen.findByText("lazyxgenius/trade_mcp");
    await userEvent.type(await ideaBox(), "Docs for /spend");
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(posts(calls, "/api/runs")).toHaveLength(1));
    expect(posts(calls, "/api/runs")[0].body).toMatchObject({ desktop_target: true });
    expect(calls.some((c) => c.path === "/api/inbox?surface=desktop")).toBe(true);
  });

  it("lists teams with their readiness in the team picker", async () => {
    mockApi(homeRoutes());
    renderHome();
    await screen.findByText("Ready on the website");
    // Scoped to the composer: the Teams section below lists the same team names.
    const composer = screen.getByRole("region", { name: "Start a run" });
    await userEvent.click(within(composer).getByRole("button", { name: /Docs team/ }));
    const list = screen.getByRole("listbox", { name: "Your teams" });
    expect(within(list).getByRole("option", { name: /Indicator sprint team/ })).toHaveTextContent(
      "Website: needs 2 keys",
    );
    expect(within(list).getByRole("option", { name: /Bugfix squad/ })).toHaveTextContent(
      "Website: needs xai key",
    );
    expect(within(list).getByRole("option", { name: /Docs team/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(within(list).getByRole("option", { name: /Bugfix squad/ }));
    expect(await screen.findByText("Website needs xai key")).toBeInTheDocument();
  });
});

describe("Needs you", () => {
  it("lists every item with its action", async () => {
    mockApi(homeRoutes());
    renderHome();
    const section = await screen.findByRole("region", { name: "Needs you" });
    await within(section).findByText("Approve the spec");
    expect(
      within(section).getByText(
        "Indicator sprint team · “Add an RSI indicator with tests” · waiting 26m",
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText(/Engineer has no xai key on the website/)).toBeInTheDocument();
    expect(
      within(section).getByText("Indicator sprint team can’t run on the website"),
    ).toBeInTheDocument();
    expect(
      within(section).getByText(
        "No API keys for anthropic and xai. Desktop runs still work with your Claude and Grok plans.",
      ),
    ).toBeInTheDocument();
    expect(within(section).getByText("2 new memories to review")).toBeInTheDocument();
    expect(
      within(section).getByText("Learned by Reviewer on lazyxgenius/trade_mcp"),
    ).toBeInTheDocument();
  });

  it("dismisses an item with Undo", async () => {
    const calls = mockApi(
      homeRoutes({
        "POST /api/inbox/dismissals": { key: "memories", action: "dismiss", until: null },
        "DELETE /api/inbox/dismissals/:key": new Response(null, { status: 204 }),
      }),
    );
    renderHome();
    await userEvent.click(
      await screen.findByRole("button", { name: "More for 2 new memories to review" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Dismiss" }));
    expect(screen.queryByText("2 new memories to review")).toBeNull();
    expect(
      await screen.findByText("Dismissed. The memories still wait in Toolkit › Memory."),
    ).toBeInTheDocument();
    expect(posts(calls, "/api/inbox/dismissals")[0].body).toEqual({
      key: "memories",
      action: "dismiss",
      surface: "website",
    });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("2 new memories to review")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "DELETE" && c.path === "/api/inbox/dismissals/memories"),
      ).toBe(true),
    );
  });

  it("approves the spec from the sheet", async () => {
    const calls = mockApi(
      homeRoutes({
        "GET /api/documents/:id": {
          id: "doc-1",
          title: "Spec",
          doc_type: "prd",
          created_at: "",
          updated_at: "",
          versions: [
            {
              id: "v2",
              version_no: 2,
              content: "# Add an RSI indicator\n\n## Goals\n- Compute `rsi`.",
              created_by: "agent:entry",
              created_at: "",
            },
          ],
        },
        "GET /api/runs/:id/graph": {
          run_id: "r-rsi",
          team_graph_id: "c",
          nodes: [{ id: "p", role_name: "pm", kind: "completion", config: null }],
          edges: [],
        },
        "POST /api/runs/:id/tasks/:task/resolve": { run_id: "r-rsi", task_id: 812 },
      }),
    );
    renderHome();
    await userEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]);
    const sheet = await screen.findByRole("dialog", { name: "Approve the spec" });
    expect(await within(sheet).findByText("Written by Product manager")).toBeInTheDocument();
    expect(within(sheet).getByText("Version 2")).toBeInTheDocument();
    expect(
      within(sheet).getByRole("heading", { name: "Add an RSI indicator" }),
    ).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve and continue" }));
    expect(await screen.findByText("Approved. The Engineer is building.")).toBeInTheDocument();
    expect(posts(calls, "/api/runs/r-rsi/tasks/812/resolve")[0].body).toEqual({
      decision: "approve",
      note: null,
    });
    expect(screen.queryByRole("dialog", { name: "Approve the spec" })).toBeNull();
  });

  it("rejects with a note", async () => {
    const calls = mockApi(
      homeRoutes({
        "GET /api/documents/:id": jsonError(404, "not found"),
        "GET /api/runs/:id/graph": jsonError(404, "not found"),
        "POST /api/runs/:id/tasks/:task/resolve": { run_id: "r-rsi", task_id: 812 },
      }),
    );
    renderHome();
    await userEvent.click((await screen.findAllByRole("button", { name: "Review" }))[0]);
    await userEvent.click(await screen.findByRole("button", { name: "Reject…" }));
    const confirm = screen.getByRole("alertdialog", { name: "Reject the spec?" });
    await userEvent.type(
      within(confirm).getByLabelText(/What should change next time\?/),
      "Cover the 14 default",
    );
    await userEvent.click(within(confirm).getByRole("button", { name: "Reject and stop run" }));
    expect(
      await screen.findByText("Run stopped. Your note is saved with the run."),
    ).toBeInTheDocument();
    expect(posts(calls, "/api/runs/r-rsi/tasks/812/resolve")[0].body).toEqual({
      decision: "reject",
      note: "Cover the 14 default",
    });
    expect(screen.getByRole("button", { name: "Start again" })).toBeInTheDocument();
  });

  it("retries a failed run through the composer, linked to the old run", async () => {
    // The xai key has been added since, so Bugfix squad is ready now.
    const teams = TEAMS.map((t) =>
      t.team_graph_id === "t-bug" && t.readiness
        ? {
            ...t,
            readiness: {
              ...t.readiness,
              website: { ready: true, missing_providers: [], missing_nodes: [] },
            },
          }
        : t,
    );
    const calls = mockApi(
      homeRoutes({ "GET /api/teams": { teams }, "POST /api/runs": { run_id: "r-retry" } }),
    );
    renderHome();
    await screen.findByText("lazyxgenius/trade_mcp");
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(
      await screen.findByText("Retrying the failed run with the same idea and repo."),
    ).toBeInTheDocument();
    expect(await ideaBox()).toHaveValue("Fix the flaky login test");
    expect(
      within(screen.getByRole("region", { name: "Start a run" })).getByRole("button", {
        name: /Bugfix squad/,
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(posts(calls, "/api/runs")).toHaveLength(1));
    expect(posts(calls, "/api/runs")[0].body).toMatchObject({
      team_graph_id: "t-bug",
      idea: "Fix the flaky login test",
      github_repo: "lazyxgenius/trade_mcp",
      base_ref: "main",
      budget_cap_usd: 5,
      retry_of_run_id: "r-flaky",
    });
    expect(
      await screen.findByText("Run started on Bugfix squad. The failed run stays in its history."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Retrying the failed run with the same idea and repo.")).toBeNull();
  });
});

describe("Running now", () => {
  it("shows progress and budget, and stops a run after confirming", async () => {
    const calls = mockApi(
      homeRoutes({
        "POST /api/runs/:id/cancel": { run_id: "r-docs", status: "cancelled" },
        "GET /api/runs/:id": { run_id: "r-docs", run: { id: "r-docs", status: "cancelled" } },
      }),
    );
    renderHome();
    const section = await screen.findByRole("region", { name: "Running now" });
    expect(within(section).getByText("Waiting for you at Approval")).toBeInTheDocument();
    expect(within(section).getByText("$1.21 of $5.00")).toBeInTheDocument();
    const docs = within(section).getByRole("article", {
      name: "Docs team: Write the API reference for /runs",
    });
    await userEvent.click(within(docs).getByRole("button", { name: "Stop" }));
    const dialog = screen.getByRole("alertdialog", { name: "Stop this run?" });
    expect(dialog).toHaveTextContent(
      "Docs team stops now and the run is marked Stopped. Anything already pushed stays on its branch. You can’t resume a stopped run.",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Stop run" }));
    expect(await screen.findByText("Run stopped.")).toBeInTheDocument();
    expect(posts(calls, "/api/runs/r-docs/cancel")).toHaveLength(1);
    const card = within(screen.getByRole("region", { name: "Running now" })).getByRole("article", {
      name: "Docs team: Write the API reference for /runs",
    });
    expect(within(card).getByText("Stopped")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Stop" })).toBeNull();
  });
});

describe("Recent runs and Spend", () => {
  it("filters, pages and links pull requests", async () => {
    const shipped = runRow({
      run_id: "r-csv",
      idea: "Add CSV export to reports",
      status: "completed",
      status_group: "completed",
      pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
      pr_number: 42,
      team: { id: "t-full", name: "Full feature squad" },
    });
    const calls = mockApi(
      homeRoutes({
        "GET /api/runs": (url: URL) => {
          const status = url.searchParams.get("status");
          if (status === "active") return { runs: [RSI_RUN, DOCS_RUN], next_cursor: null };
          if (status === "stopped") return { runs: [], next_cursor: null };
          if (url.searchParams.get("cursor")) return { runs: [shipped], next_cursor: null };
          return { runs: [RSI_RUN, DOCS_RUN], next_cursor: "c2" };
        },
      }),
    );
    renderHome();
    const recent = await screen.findByRole("region", { name: "Recent runs" });
    await within(recent).findByRole("button", { name: "Write the API reference for /runs" });
    await userEvent.click(within(recent).getByRole("link", { name: "Show more" }));
    const pr = await within(recent).findByRole("link", { name: /PR #42/ });
    expect(pr).toHaveAttribute("href", "https://github.com/lazyxgenius/trade_mcp/pull/42");
    expect(calls.some((c) => c.path === "/api/runs?limit=5&cursor=c2")).toBe(true);

    await userEvent.click(within(recent).getByRole("button", { name: "All runs" }));
    await userEvent.click(screen.getByRole("option", { name: "Stopped" }));
    expect(await within(recent).findByText("No runs match this filter.")).toBeInTheDocument();
    expect(calls.some((c) => c.path === "/api/runs?status=stopped&limit=5")).toBe(true);
  });

  it("shows the month, the week and each team's bar", async () => {
    mockApi(homeRoutes());
    renderHome();
    const spend = await screen.findByRole("region", { name: "Spend" });
    expect(await within(spend).findByText("$15.93")).toBeInTheDocument();
    expect(within(spend).getByText("September")).toBeInTheDocument();
    expect(within(spend).getByText("$6.19 this week")).toBeInTheDocument();
    expect(within(spend).getByText("Full feature squad")).toBeInTheDocument();
    expect(within(spend).getByText("$4.82")).toBeInTheDocument();
    expect(
      within(spend).getByText(
        "Each run stops at $5.00 unless you change its budget. Subscription runs on Desktop count against your plan, not here.",
      ),
    ).toBeInTheDocument();
  });
});
