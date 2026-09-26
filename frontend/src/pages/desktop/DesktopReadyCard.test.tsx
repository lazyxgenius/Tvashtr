import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../../design-system/components";
import type { AuthUser } from "../../lib/api";
import { loadDesktopSetup, saveDesktopSetup } from "../../lib/desktopSetup";
import { __resetGetStartedForTests } from "../home/getStarted";
import { requestComposerPrefill } from "../home/homeData";
import { HomePage } from "../home/HomePage";
import { homeRoutes, jsonError, mockApi, resetHomeState } from "../home/homeTestUtils";
import { installDesktopBridge, plan, uninstallDesktopBridge } from "./desktopTestUtils";

vi.mock("../home/Composer", () => ({ Composer: () => <div>COMPOSER</div> }));
vi.mock("../home/homeData", async (orig) => ({
  ...(await orig<typeof import("../home/homeData")>()),
  requestComposerPrefill: vi.fn(),
}));

const USER: AuthUser = {
  id: "u1",
  email: "l@tvashtr.dev",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};
const REFUND = {
  team_graph_id: "t-refund",
  name: "Refund feature team",
  created_at: "2026-09-26T10:00:00Z",
  node_count: 3,
  last_run: null,
  spend_usd: 0,
};
const TRADE = { path: "/Users/lazyx/code/trade_mcp", displayPath: "~/code/trade_mcp" };
const GIT = {
  is_git: true as const,
  current_branch: "feature/refunds",
  branches: ["main", "feature/refunds"],
  tracked_file_count: 42,
  subpaths: [],
  remote_url: null,
};

interface Fixture {
  workspace?: TvashtrDesktopSetup["workspace"];
  runs?: unknown[];
  teams?: unknown[];
  checklistHidden?: boolean;
  finishedNow?: boolean;
  launch?: unknown;
}

async function setUp({
  workspace = { kind: "folder", ...TRADE },
  runs = [],
  teams = [REFUND],
  checklistHidden = true,
  finishedNow = false,
  launch = { run_id: "r-new" },
}: Fixture = {}) {
  const bridge = installDesktopBridge({
    plans: [plan("claude", "connected"), plan("grok", "needs_login")],
    setup: { step: "team", finishedAt: finishedNow ? null : "2026-09-20T10:00:00Z", workspace },
    repos: { inspect: { [TRADE.path]: GIT } },
  });
  const calls = mockApi(
    homeRoutes({
      "GET /api/teams": { teams },
      "GET /api/runs": { runs, next_cursor: null },
      "GET /api/providers": { providers: [] },
      "GET /api/account/preferences": { get_started_hidden: checklistHidden },
      "POST /api/runs": launch,
    }),
  );
  await loadDesktopSetup(USER.id);
  if (finishedNow) await saveDesktopSetup({ finishedAt: "2026-09-26T10:00:00Z" });
  render(
    <ToastProvider>
      <HomePage user={USER} />
    </ToastProvider>,
  );
  return { bridge, calls };
}

/** The card, once its engine chip (read from the bridge after the first paint) is in. */
async function card() {
  const region = await screen.findByRole("region", { name: /What’s next|You’re set up/ });
  await within(region).findByText("Claude plan connected");
  return region;
}
const ideaBox = () =>
  screen.getByRole("textbox", { name: "What should Refund feature team build?" });

beforeEach(() => {
  resetHomeState();
  __resetGetStartedForTests();
  window.location.hash = "#/home";
});

afterEach(() => {
  uninstallDesktopBridge();
  vi.unstubAllGlobals();
  vi.mocked(requestComposerPrefill).mockClear();
});

describe("Desktop Home's ready card (DT-38–41)", () => {
  it("shows while the account has no runs, with chips computed from this Mac (OQ-24)", async () => {
    await setUp();
    const region = await card();
    expect(
      within(region).getByRole("heading", { name: "Welcome back. What’s next?" }),
    ).toBeInTheDocument();
    const chips = await within(region).findAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual([
      "Signed in as lazyxgenius",
      "Claude plan connected",
      "~/code/trade_mcp",
      "Refund feature team",
    ]);
    expect(ideaBox()).toHaveAttribute("placeholder", "Describe what to build");
    expect(within(region).getByRole("button", { name: "Launch" })).toBeDisabled();
    expect(screen.queryByText("COMPOSER")).not.toBeInTheDocument();
  });

  it("says “You’re set up…” in the session that finished setup", async () => {
    await setUp({ finishedNow: true });
    expect(
      await screen.findByRole("heading", { name: "You’re set up. Give your team its first job." }),
    ).toBeInTheDocument();
  });

  it("is the normal Home once the account has a run", async () => {
    await setUp({ runs: [{ run_id: "r1", status: "completed", status_group: "done" }] });
    expect(await screen.findByText("COMPOSER")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /What’s next/ })).not.toBeInTheDocument();
  });

  it("with no team at all (an older Desktop, no setup) the get-started checklist leads", async () => {
    await setUp({ teams: [], checklistHidden: false });
    expect(await screen.findByRole("heading", { name: "Get started" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /What’s next/ })).not.toBeInTheDocument();
  });

  it("Launch on a folder: snapshot at its current branch, run on Desktop, open the run", async () => {
    const { bridge, calls } = await setUp();
    await card();
    fireEvent.change(ideaBox(), { target: { value: "Add a self-serve refund button" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t-refund/runs/r-new"));
    expect(bridge.repos.prepareRun).toHaveBeenCalledWith({
      path: TRADE.path,
      baseRef: "feature/refunds",
      label: "~/code/trade_mcp",
    });
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/runs")?.body).toEqual({
      team_graph_id: "t-refund",
      idea: "Add a self-serve refund button",
      local_repo: { snapshot_id: "snap-1", label: "~/code/trade_mcp", base_ref: "feature/refunds" },
      desktop_target: true,
    });
  });

  it("Launch on a GitHub repo sends github_repo", async () => {
    const { calls } = await setUp({ workspace: { kind: "github", repo: "lazyxgenius/trade_mcp" } });
    await card();
    fireEvent.change(ideaBox(), { target: { value: "Fix the flaky test" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await waitFor(() => expect(window.location.hash).toBe("#/teams/t-refund/runs/r-new"));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/runs")?.body).toEqual({
      team_graph_id: "t-refund",
      idea: "Fix the flaky test",
      github_repo: "lazyxgenius/trade_mcp",
      desktop_target: true,
    });
  });

  it("Decide at launch hands the idea to the full composer", async () => {
    await setUp({ workspace: { kind: "ask" } });
    const region = await card();
    expect(within(region).queryByText("~/code/trade_mcp")).not.toBeInTheDocument();
    fireEvent.change(ideaBox(), { target: { value: "Add dark mode" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(await screen.findByText("COMPOSER")).toBeInTheDocument();
    expect(requestComposerPrefill).toHaveBeenCalledWith({
      teamId: "t-refund",
      idea: "Add dark mode",
    });
  });

  it("a refused launch shows the composer's message under the field", async () => {
    await setUp({ launch: jsonError(422, { missing_providers: ["xai"] }) });
    await card();
    fireEvent.change(ideaBox(), { target: { value: "Add a refund button" } });
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(await screen.findByText(/there’s no API key for it/)).toBeInTheDocument();
    expect(window.location.hash).toBe("#/home");
  });

  it("Open the canvas first and the When-you're-ready cards go where they say", async () => {
    await setUp();
    const region = await card();
    fireEvent.click(within(region).getByRole("button", { name: "Open the canvas first" }));
    expect(window.location.hash).toBe("#/teams/t-refund");
    fireEvent.click(screen.getByRole("button", { name: /Add tools/ }));
    expect(window.location.hash).toBe("#/toolkit/tools/browse");
    fireEvent.click(screen.getByRole("button", { name: /Add a domain/ }));
    expect(window.location.hash).toBe("#/domains");
    fireEvent.click(screen.getByRole("button", { name: /Try another template/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
