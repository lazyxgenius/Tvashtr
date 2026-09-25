// Home › Teams, New team, ⌘K, account menu and first time (slice F1b) — website and Desktop.
// Fixtures (shared with home-runs.mjs) mirror the design's sample data (HmF-TeamTabs / TeamFind /
// TeamMenu / NewTeam / CmdK / Account / FirstTime artboards) and render the whole Home page, so the
// Teams section sits where the design draws it. The HmF-Team* artboards are the page scrolled by
// 800px (the design's `margin-top: -800px`); `teamSteps` scrolls the main column the same way.
import {
  COPY,
  TEAMS,
  TEMPLATES,
  ago,
  chip,
  homeRoutes,
  morning,
  recent,
  run,
  runsRoute,
  team,
} from "./home-fixtures.mjs";

// HmF-FirstTime-7's team and run: Landing page team shipped one run ($0.84, PR #1).
const PRICING_RUN = run(
  "r-pricing",
  "t-land",
  "Landing page team",
  "Add a pricing section to the landing page",
  "completed",
  "completed",
  60,
  {
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/1",
    pr_number: 1,
    spent_usd: 0.84,
  },
);
// HmF-FirstTime-5's run: Landing page team's first run, just started.
const LANDING_RUNNING = run(
  "r-pricing",
  "t-land",
  "Landing page team",
  "Add a pricing section to the landing page",
  "running",
  "running",
  0,
  {
    progress: [
      chip("p", "PM", "pm", "completion", "active"),
      chip("e", "Engineer", "engineer", "agent", "idle"),
      chip("s", "Ship", "ship", "terminal", "idle"),
    ],
  },
);
const LANDING_DONE = {
  ...TEAMS[4],
  last_run: {
    status: "completed",
    at: ago(65),
    run_id: "r-pricing",
    idea: "Add a pricing section to the landing page",
    updated_at: ago(60),
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/1",
  },
  run_count: 1,
  spend_usd: 0.84,
  last_active_at: ago(60),
};

function routesFor({
  hidden = true,
  teams = TEAMS,
  runs = recent,
  providers = [
    { provider: "anthropic", key_last4: "abcd", created_at: ago(9000) },
  ],
  templates = TEMPLATES,
  spendWeek = null,
  active,
} = {}) {
  const state = { teams: [...teams] };
  // The first-time frames: no Needs-you items, nothing running.
  const firstTime = runs.length <= 1 && teams.length <= 1;
  return homeRoutes({
    "GET /api/teams": () => ({ json: { teams: state.teams } }),
    "POST /api/teams/:id/duplicate": () => {
      state.teams = [...state.teams, COPY];
      return { status: 201, json: COPY };
    },
    "PATCH /api/teams/:id": (req) => {
      const id = new URL(req.url()).pathname.split("/").pop();
      const { name } = JSON.parse(req.postData() ?? "{}");
      state.teams = state.teams.map((t) =>
        t.team_graph_id === id ? { ...t, name } : t,
      );
      return { json: state.teams.find((t) => t.team_graph_id === id) };
    },
    "DELETE /api/teams/:id": (req) => {
      const id = new URL(req.url()).pathname.split("/").pop();
      state.teams = state.teams.filter((t) => t.team_graph_id !== id);
      return { json: { team_graph_id: id, deleted: true } };
    },
    "POST /api/teams": async () => {
      await new Promise((r) => setTimeout(r, 4000));
      return { json: team("t-new", "Payments squad", {}) };
    },
    "GET /api/templates": templates,
    "GET /api/account/preferences": { get_started_hidden: hidden },
    "PATCH /api/account/preferences": { get_started_hidden: true },
    "GET /api/runs": runsRoute({
      active: active ?? (firstTime ? [] : undefined),
      list: runs,
    }),
    "GET /api/providers": { providers },
    ...(firstTime ? { "GET /api/inbox": { count: 0, items: [] } } : {}),
    ...(spendWeek !== null
      ? {
          "GET /api/spend": {
            tz: "UTC",
            month: {
              label: "September",
              start: ago(30000),
              total_usd: spendWeek,
            },
            week: { start: ago(4000), total_usd: spendWeek },
            by_team: [
              {
                team_id: "t-land",
                name: "Landing page team",
                total_usd: spendWeek,
              },
            ],
            other_usd: 0,
            default_run_budget_usd: 5,
          },
        }
      : {}),
  });
}

/** The HmF-Team* artboards show the page shifted up by 800px — the design does it with
 *  `margin-top: -800px` on the main column (the page is shorter than 800px + the window, so a
 *  real scroll can't get there); do the same. */
async function scrollToTeams(page, y = 800) {
  await page.waitForSelector(".hm-teams__title");
  await page.waitForSelector(".hm-spend__total");
  await page.evaluate((top) => {
    document.querySelector(".sh-main").scrollTop = 0;
    document.querySelector(".sh-main__inner").style.marginTop = `-${top}px`;
  }, y);
  await page.waitForTimeout(150);
}

const moreFor = (page, name) =>
  page.getByRole("button", { name: `More actions for ${name}` });

const teamSteps = (extra) => async (page) => {
  await scrollToTeams(page);
  if (extra) await extra(page);
};

const base = (name, steps, opts = {}) => [
  {
    name: `${name}-web`,
    path: "/#/home",
    routes: routesFor(opts.routes),
    steps,
    init: opts.init ? `${morning}\n(${opts.init})();` : morning,
  },
  ...(opts.desktop
    ? [
        {
          name: `${name}-desktop`,
          path: "/#/home",
          routes: routesFor(opts.routes),
          steps,
          desktop: true,
          init: opts.init ? `${morning}\n(${opts.init})();` : morning,
        },
      ]
    : []),
];

export default [
  // HmF-TeamTabs-1 (All) and -2 (Needs you)
  ...base("tabs-all", teamSteps(), { desktop: true }),
  ...base(
    "tabs-needs",
    teamSteps((page) => page.getByRole("tab", { name: /Needs you/ }).click()),
  ),
  // HmF-TeamTabs-3 (Running) and -4 (Not run yet)
  ...base(
    "tabs-running",
    teamSteps((page) => page.getByRole("tab", { name: /Running/ }).click()),
  ),
  ...base(
    "tabs-notrun",
    teamSteps((page) => page.getByRole("tab", { name: /Not run yet/ }).click()),
  ),
  // HmF-TeamFind-1 (no match), -2 (sort open), -4 (list)
  ...base(
    "find-nomatch",
    teamSteps((page) =>
      page.getByRole("textbox", { name: "Search teams" }).fill("payments"),
    ),
  ),
  ...base(
    "find-sort",
    teamSteps((page) => page.getByRole("button", { name: /Sort:/ }).click()),
  ),
  ...base(
    "find-spend",
    teamSteps(async (page) => {
      await page.getByRole("button", { name: /Sort:/ }).click();
      await page.getByRole("option", { name: "Spend" }).click();
    }),
  ),
  ...base(
    "find-list",
    teamSteps((page) => page.getByRole("tab", { name: "List" }).click()),
  ),
  // HmF-TeamMenu-1 (menu), -3 (rename), -4 (blank name), -6 (duplicated), -7 (delete dialog), -8 (deleted)
  ...base(
    "menu-open",
    teamSteps((page) => moreFor(page, "Indicator sprint team").click()),
    { desktop: true },
  ),
  ...base(
    "menu-rename",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
    }),
  ),
  ...base(
    "menu-rename-blank",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page.getByLabel("Team name").fill("");
      await page.getByRole("button", { name: "Save name" }).click();
    }),
  ),
  ...base(
    "menu-duplicate",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Duplicate" }).click();
      await page.waitForSelector('[data-team-id="t-ind-copy"]');
      await page.waitForTimeout(900); // let the scroll-to-the-copy finish
      await scrollToTeams(page);
    }),
  ),
  ...base(
    "menu-delete",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Delete team" }).click();
    }),
  ),
  ...base(
    "menu-deleted",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Delete team" }).click();
      await page.getByRole("button", { name: "Delete team" }).click();
      await page.waitForSelector('[data-team-id="t-ind"]', {
        state: "detached",
      });
    }),
  ),
  // HmF-TeamMenu-2 is Home back at the top with the team picked in the composer.
  ...base(
    "menu-run",
    teamSteps(async (page) => {
      await page
        .locator('[data-team-id="t-ind"]')
        .getByRole("button", { name: "Run" })
        .click();
      await page.evaluate(() => {
        document.querySelector(".sh-main__inner").style.marginTop = "";
        document.querySelector(".sh-main").scrollTop = 0;
      });
      await page.waitForTimeout(300);
    }),
  ),
  // HmF-TeamMenu-5 (renamed)
  ...base(
    "menu-renamed",
    teamSteps(async (page) => {
      await moreFor(page, "Indicator sprint team").click();
      await page.getByRole("menuitem", { name: "Rename" }).click();
      await page.getByLabel("Team name").fill("Indicators squad");
      await page.getByRole("button", { name: "Save name" }).click();
      await page.waitForSelector('text="Indicators squad"');
    }),
  ),
  // HmF-NewTeam-1 (open), -2 (blank name), -3 (filled + review loop), -4 (creating), -6 (templates failed)
  ...base(
    "newteam-open",
    async (page) => {
      await page.keyboard.press("t");
      await page.waitForSelector('[role="dialog"][aria-label="New team"]');
      await page.waitForTimeout(200);
    },
    { desktop: true },
  ),
  ...base("newteam-blank", async (page) => {
    await page.keyboard.press("t");
    await page.getByRole("button", { name: "Create team" }).click();
  }),
  ...base("newteam-filled", async (page) => {
    await page.keyboard.press("t");
    await page.getByLabel("Name", { exact: true }).fill("Payments squad");
    await page
      .getByRole("button", { name: /PM → Engineer ⇄ Reviewer/ })
      .click();
  }),
  ...base("newteam-creating", async (page) => {
    await page.keyboard.press("t");
    await page.getByLabel("Name", { exact: true }).fill("Payments squad");
    await page
      .getByRole("button", { name: /PM → Engineer ⇄ Reviewer/ })
      .click();
    await page.getByRole("button", { name: "Create team" }).click();
  }),
  ...base(
    "newteam-failed",
    async (page) => {
      await page.keyboard.press("t");
      await page.waitForSelector('[role="alert"]');
    },
    {
      routes: { templates: () => ({ status: 500, json: { detail: "boom" } }) },
    },
  ),
  // HmF-CmdK-1 (empty), -2 ("ind"), -3 ("zzz")
  ...base(
    "cmdk-empty",
    async (page) => {
      await page.keyboard.press("Control+k");
      await page.waitForSelector(".hm-cmdk__opt");
      await page.waitForTimeout(300);
    },
    { desktop: true },
  ),
  ...base("cmdk-ind", async (page) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("ind");
    await page.waitForTimeout(500);
  }),
  ...base("cmdk-none", async (page) => {
    await page.keyboard.press("Control+k");
    await page.keyboard.type("zzz");
    await page.waitForTimeout(500);
  }),
  // HmF-Account-1 (menu), -2 (shortcuts)
  // (the checklist isn't hidden here, so the menu has no "Show get-started checklist" row)
  ...base(
    "account-menu",
    (page) => page.getByRole("button", { name: "Account" }).click(),
    {
      routes: { hidden: false },
      desktop: true,
    },
  ),
  ...base(
    "account-keys",
    async (page) => {
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("menuitem", { name: /Keyboard shortcuts/ }).click();
    },
    { routes: { hidden: false } },
  ),
  // Home-FirstTime / HmF-FirstTime-1 (0 of 4), -3 (1 of 4), -6 (4 of 4), -7 (hidden, one team)
  ...base("first-0", (page) => page.waitForSelector(".hm-gs__title"), {
    routes: { hidden: false, teams: [], runs: [], providers: [] },
    desktop: true,
  }),
  ...base("first-1", (page) => page.waitForSelector(".hm-gs__title"), {
    routes: { hidden: false, teams: [], runs: [] },
  }),
  ...base("first-2", (page) => page.waitForSelector(".hm-gs__title"), {
    routes: { hidden: false, teams: [TEAMS[4]], runs: [] },
  }),
  ...base("first-3", (page) => page.waitForSelector(".hm-gs__title"), {
    routes: {
      hidden: false,
      teams: [TEAMS[4]],
      runs: [LANDING_RUNNING],
      active: [LANDING_RUNNING],
    },
    init: () => window.localStorage.setItem("tv.home.getStarted.shown", "1"),
  }),
  ...base("first-4", (page) => page.waitForSelector(".hm-gs__ok"), {
    routes: {
      hidden: false,
      teams: [TEAMS[4]],
      runs: [
        {
          ...recent[3],
          pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/1",
          pr_number: 1,
        },
      ],
    },
    init: () => window.localStorage.setItem("tv.home.getStarted.shown", "1"),
  }),
  // HmF-FirstTime-7: all four steps done → Hide checklist → the normal Home with the one team,
  // its one shipped run and nothing running.
  ...base(
    "first-hidden",
    async (page) => {
      await page.waitForSelector(".hm-gs__title");
      await page
        .getByRole("button", { name: "Hide checklist" })
        .first()
        .click();
      await page.waitForSelector(".hm-teams__title");
      await page.waitForTimeout(300);
    },
    {
      routes: {
        hidden: false,
        teams: [LANDING_DONE],
        runs: [PRICING_RUN],
        spendWeek: 0.84,
      },
      init: () => window.localStorage.setItem("tv.home.getStarted.shown", "1"),
    },
  ),
];
