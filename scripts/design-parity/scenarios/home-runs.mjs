// Home (slice F1a): greeting, Start a run, Needs you, Running now, Recent runs, Spend — website and
// Desktop, plus the HmF-* flow frames. Fixture data mirrors the design's sample data. The Teams
// section and New team dialog belong to slice F1b, so their items show as "not found" until then.
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();

const T = {
  indicator: "0f7c2d1e-0000-4000-8000-000000000001",
  docs: "0f7c2d1e-0000-4000-8000-000000000002",
  bugfix: "0f7c2d1e-0000-4000-8000-000000000003",
  full: "0f7c2d1e-0000-4000-8000-000000000004",
  landing: "0f7c2d1e-0000-4000-8000-000000000005",
};
const R = {
  rsi: "4c1d0000-0000-4000-8000-000000000001",
  docs: "4c1d0000-0000-4000-8000-000000000002",
  flaky: "4c1d0000-0000-4000-8000-000000000003",
  csv: "4c1d0000-0000-4000-8000-000000000004",
  macd: "4c1d0000-0000-4000-8000-000000000005",
};

const ready = { ready: true, missing_providers: [], missing_nodes: [] };
const readiness = (web, desktop = ready, routed = ["claude", "grok"]) => ({
  website: web,
  desktop: { ...desktop, routed_subscriptions: routed },
  subscriptions_connected: routed,
});
const shape = (labels) => ({
  nodes: labels.map((l, i) => ({
    id: `n${i}`,
    kind: "worker",
    role: l.toLowerCase(),
    label: l,
  })),
  loops: [],
});
const team = (id, name, nodes, extra) => ({
  team_graph_id: id,
  name,
  created_at: ago(60 * 24 * 5),
  node_count: nodes,
  last_run: null,
  spend_usd: 0,
  run_count: 0,
  shape: shape(["PM", "Engineer", "Ship"]),
  readiness: readiness(ready),
  ...extra,
});

const teams = [
  team(T.indicator, "Indicator sprint team", 6, {
    last_run: {
      status: "awaiting_human",
      at: ago(26),
      run_id: R.rsi,
      idea: "Add an RSI indicator with tests",
    },
    spend_usd: 4.82,
    run_count: 7,
    readiness: readiness({
      ready: false,
      missing_providers: ["anthropic", "xai"],
      missing_nodes: ["architect", "pm"],
    }),
  }),
  team(T.docs, "Docs team", 3, {
    last_run: {
      status: "running",
      at: ago(11),
      run_id: R.docs,
      idea: "Write the API reference for /runs",
    },
    spend_usd: 1.37,
    run_count: 3,
  }),
  team(T.bugfix, "Bugfix squad", 4, {
    last_run: {
      status: "failed",
      at: ago(11 * 60),
      run_id: R.flaky,
      idea: "Fix the flaky login test",
    },
    spend_usd: 0.64,
    run_count: 4,
    readiness: readiness({
      ready: false,
      missing_providers: ["xai"],
      missing_nodes: ["engineer"],
    }),
  }),
  team(T.full, "Full feature squad", 7, {
    last_run: {
      status: "completed",
      at: ago(2 * 24 * 60),
      run_id: R.csv,
      idea: "Add CSV export to reports",
    },
    spend_usd: 9.1,
    run_count: 9,
  }),
  team(T.landing, "Landing page team", 3, { created_at: ago(24 * 60) }),
];

const chip = (id, label, role, kind, state, loops_with = null) => ({
  node_id: id,
  origin_node_id: null,
  role_name: role,
  label,
  kind,
  state,
  loops_with,
});
const run = (
  id,
  teamId,
  teamName,
  idea,
  status,
  group,
  minAgo,
  extra = {},
) => ({
  run_id: id,
  idea,
  status,
  created_at: ago(minAgo),
  repo_path: null,
  status_group: group,
  updated_at: ago(minAgo),
  github_repo: "lazyxgenius/trade_mcp",
  base_ref: "main",
  subpath: null,
  target: {
    kind: "github",
    label: "lazyxgenius/trade_mcp",
    base_ref: "main",
    subpath: null,
  },
  pr_url: null,
  pr_number: null,
  ship_branch: `tvashtr/${id}`,
  budget_cap_usd: 5,
  desktop_target: false,
  library_team_id: teamId,
  retry_of_run_id: null,
  team: { id: teamId, name: teamName },
  spent_usd: 0,
  awaiting: null,
  failure: null,
  ...extra,
});

const rsiRun = run(
  R.rsi,
  T.indicator,
  "Indicator sprint team",
  "Add an RSI indicator with tests",
  "awaiting_human",
  "needs_you",
  26,
  {
    spent_usd: 1.21,
    awaiting: {
      task_id: 812,
      kind: "prd_approval",
      title: "Approve the PRD before the Engineer builds",
      gate_node_id: "g",
      gate_role: "Approval",
      next_role: "Engineer",
      since: ago(26),
    },
    progress: [
      chip("p", "PM", "pm", "completion", "done"),
      chip("a", "Architect", "architect", "completion", "done"),
      chip("g", "Approval", "prd_gate", "gate", "waiting"),
      chip("e", "Engineer", "engineer", "agent", "idle"),
      chip("r", "Reviewer", "reviewer", "agent", "idle", "e"),
      chip("s", "Ship", "ship", "terminal", "idle"),
    ],
  },
);
const docsRun = run(
  R.docs,
  T.docs,
  "Docs team",
  "Write the API reference for /runs",
  "running",
  "running",
  11,
  {
    spent_usd: 0.42,
    progress: [
      chip("p2", "PM", "pm", "completion", "done"),
      chip("w2", "Writer", "writer", "agent", "active"),
      chip("s2", "Ship", "ship", "terminal", "idle"),
    ],
  },
);
const flakyRun = run(
  R.flaky,
  T.bugfix,
  "Bugfix squad",
  "Fix the flaky login test",
  "failed",
  "failed",
  11 * 60,
  {
    failure: {
      code: "missing_credential",
      message: "Engineer has no xai key on the website",
      node_id: null,
      origin_node_id: null,
      node_role: "Engineer",
      provider: "xai",
      target: "website",
    },
  },
);
const csvRun = run(
  R.csv,
  T.full,
  "Full feature squad",
  "Add CSV export to reports",
  "completed",
  "completed",
  2 * 24 * 60,
  {
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
    pr_number: 42,
  },
);
const macdRun = run(
  R.macd,
  T.indicator,
  "Indicator sprint team",
  "Add MACD to the registry",
  "completed",
  "completed",
  3 * 24 * 60,
  {
    pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/39",
    pr_number: 39,
  },
);
const recent = [rsiRun, docsRun, flakyRun, csvRun, macdRun];

const inboxItems = [
  {
    key: "gate:812",
    kind: "approval",
    since: ago(26),
    team: { id: T.indicator, name: "Indicator sprint team" },
    run: {
      id: R.rsi,
      idea: "Add an RSI indicator with tests",
      status: "awaiting_human",
      spent_usd: 1.21,
      budget_cap_usd: 5,
    },
    task: {
      id: 812,
      kind: "prd_approval",
      title: "Approve the PRD before the Engineer builds",
      blocking: true,
      gate_node_id: "g",
      gate_role: "Approval",
      next_role: "Engineer",
    },
    document_id: "d3e40000-0000-4000-8000-000000000001",
  },
  {
    key: `run_failed:${R.flaky}`,
    kind: "run_failed",
    since: ago(11 * 60),
    team: { id: T.bugfix, name: "Bugfix squad" },
    run: {
      id: R.flaky,
      idea: "Fix the flaky login test",
      status: "failed",
      created_at: ago(11 * 60 + 30),
      ended_at: ago(11 * 60),
      target: {
        kind: "github",
        label: "lazyxgenius/trade_mcp",
        base_ref: "main",
        subpath: null,
      },
      github_repo: "lazyxgenius/trade_mcp",
      base_ref: "main",
      subpath: null,
      budget_cap_usd: 5,
      desktop_target: false,
      library_team_id: T.bugfix,
    },
    failure: flakyRun.failure,
  },
  {
    key: `setup:${T.indicator}:website`,
    kind: "setup_gap",
    since: ago(2 * 24 * 60),
    team: { id: T.indicator, name: "Indicator sprint team" },
    target: "website",
    missing_providers: ["anthropic", "xai"],
    missing_nodes: ["Architect", "PM"],
    desktop_covers: ["claude", "grok"],
  },
  {
    key: "memories",
    kind: "memories",
    since: ago(3 * 24 * 60),
    count: 2,
    learned_by: ["Reviewer"],
    repos: ["lazyxgenius/trade_mcp"],
  },
];

const spec = `# Add an RSI indicator

Traders want a momentum signal in the strategy builder. Add the Relative Strength Index as a first-class indicator.

## Goals
- Compute RSI over a configurable period (default 14) on candle closes.
- Register it on \`INDICATORS\` so the builder, the tests and the TypeScript mirror all list it.
- Show it in the indicator picker with its parameters and outputs.

## Acceptance
- \`TestRegistry\` lists 29 indicators, including \`rsi\`.
- \`web/lib/engine-facts.ts\` sets \`indicator_count\` to 29.
- A unit test checks RSI against a known series.

## Out of scope
- Alerts on RSI crossovers.
`;

function runsRoute({ active = [rsiRun, docsRun], list = recent } = {}) {
  return (req) => {
    const u = new URL(req.url());
    const status = u.searchParams.get("status") ?? "all";
    if (status === "active")
      return { json: { runs: active, next_cursor: null } };
    const filtered =
      status === "all"
        ? list
        : list.filter(
            (r) =>
              r.status_group === status ||
              (status === "running" && r.status_group === "running"),
          );
    const limit = Number(u.searchParams.get("limit") ?? 50);
    return {
      json: {
        runs: filtered.slice(0, limit),
        next_cursor: filtered.length >= limit ? "next" : null,
      },
    };
  };
}

const baseRoutes = (over = {}) => ({
  "GET /api/teams": { teams },
  "GET /api/config": {
    hosted_mode: true,
    github_install_url: "https://github.com/apps/tvashtr/installations/new",
    github_manage_url: "https://github.com/apps/tvashtr/installations/new",
    provider_catalogue: [],
    provider_directory: [
      {
        provider: "anthropic",
        monogram: "A",
        name: "Anthropic",
        label: "Claude models",
        example_model: "anthropic/claude-sonnet-5",
        subscription: "claude",
        embeddings: false,
        hint: null,
      },
      {
        provider: "xai",
        monogram: "X",
        name: "xAI",
        label: "Grok models",
        example_model: "xai/grok-4",
        subscription: "grok",
        embeddings: false,
        hint: null,
      },
    ],
    default_run_budget_usd: 5,
  },
  "GET /api/inbox": { count: inboxItems.length, items: inboxItems },
  "GET /api/runs": runsRoute(),
  "GET /api/spend": {
    tz: "UTC",
    month: { label: "September", start: ago(24 * 60 * 24), total_usd: 15.93 },
    week: { start: ago(24 * 60 * 3), total_usd: 6.19 },
    by_team: [
      { team_id: T.full, name: "Full feature squad", total_usd: 9.1 },
      { team_id: T.indicator, name: "Indicator sprint team", total_usd: 4.82 },
      { team_id: T.docs, name: "Docs team", total_usd: 1.37 },
      { team_id: T.bugfix, name: "Bugfix squad", total_usd: 0.64 },
    ],
    other_usd: 0,
    default_run_budget_usd: 5,
  },
  "GET /api/github/repos": {
    repos: [
      {
        name: "trade_mcp",
        full_name: "lazyxgenius/trade_mcp",
        private: false,
        default_branch: "main",
        html_url: "",
      },
      {
        name: "cryptoground-mcp",
        full_name: "lazyxgenius/cryptoground-mcp",
        private: false,
        default_branch: "main",
        html_url: "",
      },
    ],
    installation_count: 1,
  },
  "GET /api/github/repos/:o/:r/branches": {
    default_branch: "main",
    branches: ["main", "dev"],
    truncated: false,
  },
  "GET /api/github/repos/:o/:r/subpaths": {
    ref: "main",
    subpaths: [
      { path: "packages/indicators", file_count: 42 },
      { path: "web", file_count: 17 },
    ],
    truncated: false,
  },
  "GET /api/documents/:id": {
    id: "d3e4",
    title: "Spec",
    doc_type: "prd",
    created_at: ago(40),
    updated_at: ago(26),
    versions: [
      {
        id: "v1",
        version_no: 1,
        content: spec,
        created_by: "agent:entry",
        created_at: ago(40),
      },
      {
        id: "v2",
        version_no: 2,
        content: spec,
        created_by: "agent:entry",
        created_at: ago(26),
      },
    ],
  },
  "GET /api/runs/:id/graph": {
    run_id: R.rsi,
    team_graph_id: "c",
    nodes: [{ id: "p", role_name: "pm", kind: "completion", config: null }],
    edges: [],
  },
  "GET /api/teams/:id/runs": {
    runs: [
      {
        run_id: R.rsi,
        status: "awaiting_human",
        idea: "Add an RSI indicator with tests",
        created_at: "2026-09-25T08:00:00Z",
        cost_total_usd: 0,
        spent_usd: 1.21,
        pr_url: null,
        pr_number: null,
      },
      {
        run_id: R.macd,
        status: "completed",
        idea: "Add MACD to the registry",
        created_at: "2026-09-23T08:00:00Z",
        cost_total_usd: 2.4,
        spent_usd: 2.4,
        pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/39",
        pr_number: 39,
      },
      {
        run_id: "b1",
        status: "failed",
        idea: "Bollinger bands",
        created_at: "2026-09-20T08:00:00Z",
        cost_total_usd: 1.21,
        spent_usd: 1.21,
        pr_url: null,
        pr_number: null,
      },
      {
        run_id: "b2",
        status: "completed",
        idea: "Add EMA crossover",
        created_at: "2026-09-18T08:00:00Z",
        cost_total_usd: 0.88,
        spent_usd: 0.88,
        pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/31",
        pr_number: 31,
      },
      {
        run_id: "b3",
        status: "cancelled",
        idea: "Rename the indicators module",
        created_at: "2026-09-17T08:00:00Z",
        cost_total_usd: 0.12,
        spent_usd: 0.12,
        pr_url: null,
        pr_number: null,
      },
    ],
  },
  ...over,
});

// The design says "Good morning" and has "Indicator sprint team" in the composer.
const morning = () => {
  Date.prototype.getHours = function getHours() {
    return 9;
  };
  try {
    localStorage.setItem(
      "tvashtr.home.lastTeam",
      "0f7c2d1e-0000-4000-8000-000000000001",
    );
  } catch {
    /* ignore */
  }
};
// Desktop: the planned repos bridge with the design's two recent folders.
const desktopRepos = () => {
  Date.prototype.getHours = function getHours() {
    return 9;
  };
  try {
    localStorage.setItem(
      "tvashtr.home.lastTeam",
      "0f7c2d1e-0000-4000-8000-000000000001",
    );
  } catch {
    /* ignore */
  }
  const folders = [
    {
      path: "/Users/lazyx/code/trade_mcp",
      displayPath: "~/code/trade_mcp",
      branch: "main",
      available: true,
    },
    {
      path: "/Users/lazyx/code/cryptoground-mcp",
      displayPath: "~/code/cryptoground-mcp",
      branch: "main",
      available: true,
    },
  ];
  const attach = () => {
    if (!window.tvashtrDesktop || typeof window.tvashtrDesktop !== "object")
      return false;
    window.tvashtrDesktop.repos = {
      pickFolder: async () => null,
      inspect: async () => ({
        is_git: true,
        current_branch: "main",
        branches: ["main", "dev"],
        tracked_file_count: 120,
        subpaths: [
          { path: "packages/indicators", file_count: 42 },
          { path: "web", file_count: 17 },
        ],
      }),
      recent: {
        list: async () => folders,
        add: async () => undefined,
        remove: async () => undefined,
      },
      prepareRun: async () => ({ snapshot_id: "snap" }),
    };
    return true;
  };
  if (!attach()) document.addEventListener("DOMContentLoaded", attach);
};

// Click like a person: at the element's centre, without Playwright's scroll-into-view (which
// scrolls the dashboard's main column for elements inside the unclipped Home cards).
const tap = async (page, loc) => {
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

const scrollMain = (y) => async (page) => {
  await page.evaluate(
    (dy) => document.querySelector(".sh-main")?.scrollBy(0, dy),
    y,
  );
  await page.waitForTimeout(150);
};

const desktopTeams = teams.map((t) =>
  t.team_graph_id === T.indicator
    ? {
        ...t,
        readiness: readiness(t.readiness.website, ready, ["claude", "grok"]),
      }
    : t,
);

const typeIdea = async (page) => {
  await page
    .getByRole("textbox", { name: "What should the team build?" })
    .fill("Add a Stochastic RSI indicator with tests");
};

export default [
  { name: "home-web", path: "/#/home", routes: baseRoutes(), init: morning },
  {
    name: "home-desktop",
    path: "/#/home",
    desktop: true,
    routes: baseRoutes({ "GET /api/teams": { teams: desktopTeams } }),
    init: desktopRepos,
  },
  {
    name: "home-1024",
    path: "/#/home",
    width: 1024,
    height: 768,
    routes: baseRoutes(),
    init: morning,
  },
  {
    name: "home-full",
    path: "/#/home",
    height: 1560,
    routes: baseRoutes(),
    init: morning,
  },
  {
    name: "home-loading",
    path: "/#/home",
    routes: baseRoutes(),
    init: () => {
      const real = window.fetch;
      window.fetch = (input, opts) => {
        const url = String(input instanceof Request ? input.url : input);
        if (/\/api\/(teams|inbox|runs|spend)/.test(url))
          return new Promise(() => {});
        return real(input, opts);
      };
    },
  },
  {
    name: "home-allcaughtup",
    path: "/#/home",
    init: morning,
    routes: baseRoutes({
      "GET /api/inbox": { count: 0, items: [] },
      "GET /api/runs": runsRoute({ active: [docsRun] }),
    }),
  },
  // ---- flows ----
  {
    name: "pickteam-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.locator(".hm-picker--team"));
    },
  },
  {
    name: "pickteam-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.locator(".hm-picker--team"));
      await tap(page, page.getByRole("option", { name: /Docs team/ }));
      await page.mouse.click(700, 120);
    },
  },
  {
    name: "idea-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await page
        .getByRole("textbox", { name: "What should the team build?" })
        .focus();
    },
  },
  {
    name: "idea-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: typeIdea,
  },
  {
    name: "pickrepo-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
    },
  },
  {
    name: "pickrepo-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
      await tap(
        page,
        page.getByRole("option", { name: /No repo · build a fresh app/ }),
      );
    },
  },
  {
    name: "pickfolder-1",
    path: "/#/home",
    desktop: true,
    init: desktopRepos,
    routes: baseRoutes({ "GET /api/teams": { teams: desktopTeams } }),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
    },
  },
  {
    name: "pickfolder-2",
    path: "/#/home",
    desktop: true,
    init: desktopRepos,
    routes: baseRoutes({ "GET /api/teams": { teams: desktopTeams } }),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.locator(".hm-picker--repo"));
      await tap(
        page,
        page.getByRole("option", { name: /~\/code\/cryptoground-mcp/ }),
      );
    },
  },
  {
    name: "options-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Options" }));
    },
  },
  {
    name: "launch-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "launch-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
    },
  },
  {
    name: "launch-3",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await typeIdea(page);
      await tap(page, page.getByRole("button", { name: "Launch" }));
      await tap(page, page.getByRole("button", { name: "Add keys" }));
    },
  },
  {
    name: "approve-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Review" }).first());
    },
  },
  {
    name: "reject-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Review" }).first());
      await tap(page, page.getByRole("button", { name: "Reject…" }));
    },
  },
  {
    name: "dismiss-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(
        page,
        page.getByRole("button", { name: "More for 2 new memories to review" }),
      );
    },
  },
  {
    name: "retry-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "Retry" }));
      await page.evaluate(() =>
        document.querySelector(".sh-main")?.scrollTo(0, 0),
      );
    },
  },
  {
    name: "stop-2",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await scrollMain(330)(page);
      await tap(page, page.getByRole("button", { name: "Stop" }).nth(1));
    },
  },
  {
    name: "runsfilter-1",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "All runs" }));
    },
  },
  {
    name: "runsfilter-3",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await tap(page, page.getByRole("button", { name: "All runs" }));
      await tap(page, page.getByRole("option", { name: "Stopped" }));
    },
  },
  {
    name: "runsfilter-4",
    path: "/#/home",
    init: morning,
    routes: baseRoutes(),
    steps: async (page) => {
      await page.getByRole("link", { name: /PR #42/ }).hover();
    },
  },
];
