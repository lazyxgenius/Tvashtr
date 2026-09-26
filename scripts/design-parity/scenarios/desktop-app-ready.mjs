// Tvashtr Desktop app screens (desktop-app.md), group G6: Desktop Home's ready card (DT-Ready,
// DtF-Run-8, DtF-Launch-2) and the Shell's update card (DT-Update, DtF-Upd-1). Desktop-only
// boards: every scenario is `desktop: true` with the v6 fake bridge from desktop-app.mjs.
//
// DT-Ready says "You’re set up…", which only the session that finished setup says (DT-38): the
// scenario lands on setup's Project step (a team exists already, DT-37), clicks Continue and so
// finishes setup. Launch-2 opens with setup already finished ("Welcome back").
//
// DESIGN INCONSISTENCY (reported): DT-Update shows the ready card (no runs yet) and "1 run is
// going." together, which can't both be true. The fixture answers `status=running` with one
// Desktop run and the unfiltered list with none, to measure both cards as drawn.
import { desktopBridge } from "./desktop-app.mjs";
import { ago, homeRoutes, team } from "./home-fixtures.mjs";

const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};
const TRADE = {
  path: "/Users/lazyx/code/trade_mcp",
  displayPath: "~/code/trade_mcp",
};
const REFUND = team("t-refund", "Refund feature team", {
  created_at: ago(5),
  last_run: null,
  run_count: 0,
  spend_usd: 0,
});
const GOING = {
  run_id: "r-going",
  status: "running",
  status_group: "running",
  desktop_target: true,
  idea: "Add a self-serve refund button to Billing",
  team: { id: "t-refund", name: "Refund feature team" },
  created_at: ago(3),
};

const routes = (runningNow = []) =>
  homeRoutes({
    "GET /api/auth/me": ME,
    "GET /api/teams": { teams: [REFUND] },
    "GET /api/providers": { providers: [] },
    "GET /api/account/preferences": { get_started_hidden: true },
    "GET /api/inbox": { count: 0, items: [] },
    "GET /api/runs": (req) => {
      const status = new URL(req.url()).searchParams.get("status");
      return {
        json: {
          runs: status === "running" ? runningNow : [],
          next_cursor: null,
        },
      };
    },
  });

const repos = {
  inspect: {
    [TRADE.path]: {
      is_git: true,
      current_branch: "main",
      branches: ["main"],
      tracked_file_count: 42,
      subpaths: [],
      remote_url: "https://github.com/lazyxgenius/trade_mcp.git",
    },
  },
};
const WORKSPACE = { kind: "folder", ...TRADE };

/** The idea the boards show typed in, blurred (the field is drawn at rest). */
async function typeIdea(page) {
  const box = page.getByRole("textbox", {
    name: "What should Refund feature team build?",
  });
  await box.fill("Add a self-serve refund button to Billing");
  await box.blur();
}

// DT-Ready / DtF-Run-8: setup just finished in this session.
const ready = {
  path: "/#/home",
  desktop: true,
  routes: routes(),
  init: desktopBridge({
    repos,
    setup: { step: "project", workspace: WORKSPACE },
  }),
  steps: async (page) => {
    await page
      .getByRole("heading", { name: "Where should your teams work?" })
      .waitFor();
    await page
      .getByRole("button", { name: "Continue" })
      .and(page.locator(":enabled"))
      .click();
    await page
      .getByRole("heading", {
        name: "You’re set up. Give your team its first job.",
      })
      .waitFor();
    await page.getByText("Claude and Grok plans connected").waitFor();
    await typeIdea(page);
  },
};

// DtF-Launch-2: a later launch, still no runs.
const welcomeBack = {
  path: "/#/home",
  desktop: true,
  routes: routes(),
  init: desktopBridge({
    repos,
    setup: { step: "team", finishedAt: ago(60), workspace: WORKSPACE },
  }),
  steps: async (page) => {
    await page
      .getByRole("heading", { name: "Welcome back. What’s next?" })
      .waitFor();
    await page.getByText("Claude and Grok plans connected").waitFor();
    await typeIdea(page);
  },
};

// DT-Update / DtF-Upd-1: DT-Ready with an update staged and one Desktop run going.
const update = {
  ...ready,
  routes: routes([GOING]),
  init: desktopBridge({
    repos,
    setup: { step: "project", workspace: WORKSPACE },
    update: { state: "ready", version: "[version]" },
  }),
  steps: async (page) => {
    await ready.steps(page);
    await page.getByText("1 run is going.", { exact: false }).waitFor();
  },
};

export default [
  { name: "DT-Ready", ...ready },
  { name: "DtF-Run-8", ...ready },
  { name: "DtF-Launch-2", ...welcomeBack },
  { name: "DT-Update", ...update },
  { name: "DtF-Upd-1", ...update },
];
