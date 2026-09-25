// Home › Teams, New team, ⌘K, account menu and first time (slice F1b) — website and Desktop.
// Fixtures mirror the design's sample data (HmF-TeamTabs / TeamFind / TeamMenu / NewTeam / CmdK /
// Account / FirstTime artboards). The Home sections above Teams belong to slice F1a, so until they
// land the Teams section sits higher on the page than in the design; `alignTeams` pads it down so
// the "Teams" title lands where the design draws it (y=198 in the scrolled HmF-Team* artboards)
// and positions stay comparable.
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();

const node = (role, label, kind) => ({
  id: `${role}-${label}`,
  kind:
    kind ??
    (role === "gate"
      ? "gate"
      : role === "ship"
        ? "terminal"
        : role === "pm" || role === "architect"
          ? "thinker"
          : "worker"),
  role,
  label,
});
const PM = node("pm", "PM");
const ARCH = node("architect", "Architect");
const GATE = node("gate", "Approval");
const ENG = node("engineer", "Engineer");
const REV = node("reviewer", "Reviewer");
const SHIP = node("ship", "Ship");
const WRITER = node("worker", "Writer");

const team = (id, name, extra) => ({
  team_graph_id: id,
  name,
  created_at: ago(60 * 24 * 20),
  node_count: 5,
  last_run: null,
  spend_usd: 0,
  run_count: 0,
  active_run_count: 0,
  awaiting_run_count: 0,
  template_key: null,
  template_name: null,
  duplicated_from: null,
  ...extra,
});

const run = (id, status, idea, minAgo, extra = {}) => ({
  status,
  at: ago(minAgo + 5),
  run_id: id,
  idea,
  updated_at: ago(minAgo),
  pr_url: null,
  ...extra,
});

const TEAMS = [
  team("t-ind", "Indicator sprint team", {
    last_run: run(
      "r-rsi",
      "awaiting_human",
      "Add an RSI indicator with tests",
      26,
    ),
    last_active_at: ago(1),
    spend_usd: 4.82,
    run_count: 7,
    awaiting_run_count: 1,
    shape: {
      nodes: [PM, ARCH, GATE, ENG, REV, SHIP],
      loops: [{ from: 4, to: 3 }],
    },
  }),
  team("t-docs", "Docs team", {
    last_run: {
      ...run("r-docs", "running", "Write the API reference for /runs", 2),
      at: ago(11),
    },
    last_active_at: ago(2),
    spend_usd: 1.37,
    run_count: 3,
    active_run_count: 1,
    shape: { nodes: [PM, WRITER, SHIP], loops: [] },
  }),
  team("t-bug", "Bugfix squad", {
    last_run: run("r-flaky", "failed", "Fix the flaky login test", 11 * 60),
    last_active_at: ago(11 * 60),
    spend_usd: 0.64,
    run_count: 4,
    shape: { nodes: [PM, ENG, REV, SHIP], loops: [{ from: 2, to: 1 }] },
  }),
  team("t-full", "Full feature squad", {
    last_run: run(
      "r-csv",
      "completed",
      "Add CSV export to reports",
      2 * 24 * 60,
    ),
    last_active_at: ago(2 * 24 * 60),
    spend_usd: 9.1,
    run_count: 9,
    shape: {
      nodes: [PM, ARCH, GATE, ENG, REV, { ...GATE, id: "gate-2" }, SHIP],
      loops: [{ from: 4, to: 3 }],
    },
  }),
  team("t-land", "Landing page team", {
    created_at: ago(60 * 24),
    // The design lists it last; its "last active" is backdated so the sort agrees.
    last_active_at: ago(60 * 24 * 3),
    template_key: "two_node",
    template_name: "PM → Engineer",
    shape: { nodes: [PM, ENG, SHIP], loops: [] },
  }),
];

const COPY = team("t-ind-copy", "Indicator sprint team (copy)", {
  created_at: ago(0),
  last_active_at: ago(0),
  template_key: "plan_review",
  template_name: "PM → Architect → Engineer ⇄ Reviewer",
  duplicated_from: { team_graph_id: "t-ind", name: "Indicator sprint team" },
  shape: TEAMS[0].shape,
});

const TEMPLATES = {
  templates: [
    {
      template: "two_node",
      name: "PM → Engineer",
      description:
        "A PM writes the spec; an Engineer builds and ships it. No review step.",
      shape: { nodes: [PM, ENG, SHIP], loops: [] },
    },
    {
      template: "review_loop",
      name: "PM → Engineer ⇄ Reviewer",
      description:
        "Adds a Reviewer that runs the tests and loops back for fixes.",
      shape: { nodes: [PM, ENG, REV, SHIP], loops: [{ from: 2, to: 1 }] },
    },
    {
      template: "plan_review",
      name: "PM → Architect → Engineer ⇄ Reviewer",
      description:
        "Two thinkers plan it, then a build-and-review loop ships it.",
      shape: { nodes: [PM, ARCH, ENG, REV, SHIP], loops: [{ from: 3, to: 2 }] },
    },
    {
      template: "full_squad",
      name: "Full feature squad",
      description:
        "Plan, you approve, build and test in a loop, you approve the ship.",
      shape: {
        nodes: [PM, ARCH, GATE, ENG, REV, GATE, SHIP],
        loops: [{ from: 4, to: 3 }],
      },
    },
  ],
  blank: {
    template: "blank",
    name: "Blank",
    description:
      "An empty canvas: one thinker into Ship. Wire the rest yourself.",
    shape: { nodes: [PM, SHIP], loops: [] },
  },
};

const RUNS = [
  {
    run_id: "r-rsi",
    idea: "Add an RSI indicator with tests",
    status: "awaiting_human",
    created_at: ago(40),
    updated_at: ago(26),
    team: { id: "t-ind", name: "Indicator sprint team" },
  },
  {
    run_id: "r-docs",
    idea: "Write the API reference for /runs",
    status: "running",
    created_at: ago(11),
    updated_at: ago(2),
    team: { id: "t-docs", name: "Docs team" },
  },
  {
    run_id: "r-flaky",
    idea: "Fix the flaky login test",
    status: "failed",
    created_at: ago(700),
    updated_at: ago(660),
    team: { id: "t-bug", name: "Bugfix squad" },
  },
  {
    run_id: "r-csv",
    idea: "Add CSV export to reports",
    status: "completed",
    created_at: ago(2900),
    updated_at: ago(2880),
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
    pr_number: 42,
    team: { id: "t-full", name: "Full feature squad" },
  },
  {
    run_id: "r-macd",
    idea: "Add MACD to the registry",
    status: "completed",
    created_at: ago(4400),
    updated_at: ago(4320),
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/39",
    pr_number: 39,
    team: { id: "t-ind", name: "Indicator sprint team" },
  },
];

const INBOX = {
  count: 4,
  items: [
    { key: "memories", kind: "memories", since: ago(4000), count: 2 },
    {
      key: "setup:t-ind:website",
      kind: "setup_gap",
      since: ago(3000),
      team: { id: "t-ind", name: "Indicator sprint team" },
      target: "website",
    },
    {
      key: "run_failed:r-flaky",
      kind: "run_failed",
      since: ago(660),
      team: { id: "t-bug", name: "Bugfix squad" },
      run: {
        id: "r-flaky",
        idea: "Fix the flaky login test",
        status: "failed",
      },
    },
    {
      key: "gate:812",
      kind: "approval",
      since: ago(26),
      team: { id: "t-ind", name: "Indicator sprint team" },
      run: {
        id: "r-rsi",
        idea: "Add an RSI indicator with tests",
        status: "awaiting_human",
      },
      task: { id: 812, kind: "prd_approval", title: "Approve the PRD" },
    },
  ],
};

function routesFor({
  hidden = true,
  teams = TEAMS,
  runs = RUNS,
  providers = [
    { provider: "anthropic", key_last4: "abcd", created_at: ago(9000) },
  ],
  templates = TEMPLATES,
} = {}) {
  const state = { teams: [...teams] };
  return {
    "GET /api/teams": () => ({ json: { teams: state.teams } }),
    "POST /api/teams/:id/duplicate": () => {
      state.teams = [...state.teams, COPY];
      return { status: 201, json: COPY };
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
    "GET /api/runs": (req) => {
      const q = (new URL(req.url()).searchParams.get("q") ?? "").toLowerCase();
      const list = q
        ? runs.filter((r) =>
            `${r.idea} ${r.team?.name}`.toLowerCase().includes(q),
          )
        : runs;
      return { json: { runs: list, next_cursor: null } };
    },
    "GET /api/providers": { providers },
    "GET /api/engines/subscriptions": { subscriptions: [] },
    "GET /api/inbox": INBOX,
    "GET /api/domains": {
      domains: [
        {
          domain_id: "d-ind",
          name: "Indicators",
          template: "x",
          config: {},
          status: "ready",
          doc_count: 3,
          created_at: ago(9000),
          updated_at: ago(9000),
        },
      ],
    },
  };
}

/** Pad (or scroll) the Teams section so its title sits at the design's y. */
async function alignTeams(page, y = 198) {
  await page.waitForSelector(".hm-teams__title");
  await page.evaluate((target) => {
    const title = document.querySelector(".hm-teams__title");
    const section = document.querySelector(".hm-teams");
    const main = document.querySelector(".sh-main");
    main.scrollTop = 0;
    section.style.marginTop = "";
    const dy = target - title.getBoundingClientRect().top;
    if (dy >= 0) section.style.marginTop = `${dy}px`;
    else main.scrollTop = -dy;
  }, y);
}

const moreFor = (page, name) =>
  page.getByRole("button", { name: `More actions for ${name}` });

const teamSteps = (extra) => async (page) => {
  await alignTeams(page);
  if (extra) await extra(page);
};

const base = (name, steps, opts = {}) => [
  {
    name: `${name}-web`,
    path: "/#/home",
    routes: routesFor(opts.routes),
    steps,
    init: opts.init,
  },
  ...(opts.desktop
    ? [
        {
          name: `${name}-desktop`,
          path: "/#/home",
          routes: routesFor(opts.routes),
          steps,
          desktop: true,
          init: opts.init,
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
      await alignTeams(page);
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
  ...base(
    "menu-run",
    teamSteps((page) =>
      page
        .locator('[data-team-id="t-ind"]')
        .getByRole("button", { name: "Run" })
        .click(),
    ),
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
      runs: [{ ...RUNS[0], team: { id: "t-land", name: "Landing page team" } }],
    },
    init: () => window.localStorage.setItem("tv.home.getStarted.shown", "1"),
  }),
  ...base("first-4", (page) => page.waitForSelector(".hm-gs__ok"), {
    routes: {
      hidden: false,
      teams: [TEAMS[4]],
      runs: [
        {
          ...RUNS[3],
          pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/1",
          pr_number: 1,
        },
      ],
    },
    init: () => window.localStorage.setItem("tv.home.getStarted.shown", "1"),
  }),
  ...base("first-hidden", (page) => alignTeams(page, 635), {
    routes: { hidden: true, teams: [TEAMS[3]] },
  }),
];
