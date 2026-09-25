// Shared Home fixtures for the parity scenarios (home-runs.mjs = slice F1a's sections and flows,
// home-teams.mjs = slice F1b's Teams / New team / ⌘K / account / first time). Not a scenario file
// itself. The data mirrors the design's sample data, so every Home artboard renders the full page.
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();

export const T = {
  indicator: "t-ind",
  docs: "t-docs",
  bugfix: "t-bug",
  full: "t-full",
  landing: "t-land",
};
export const R = {
  rsi: "r-rsi",
  docs: "r-docs",
  flaky: "r-flaky",
  csv: "r-csv",
  macd: "r-macd",
};

// ---- Teams (shapes as the design draws them; readiness for the composer and picker) ----

const ready = { ready: true, missing_providers: [], missing_nodes: [] };
export const readiness = (
  web,
  desktop = ready,
  routed = ["claude", "grok"],
) => ({
  website: web,
  desktop: { ...desktop, routed_subscriptions: routed },
  subscriptions_connected: routed,
});

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

export const team = (id, name, extra) => ({
  team_graph_id: id,
  name,
  created_at: ago(60 * 24 * 20),
  last_run: null,
  spend_usd: 0,
  run_count: 0,
  active_run_count: 0,
  awaiting_run_count: 0,
  template_key: null,
  template_name: null,
  duplicated_from: null,
  readiness: readiness(ready, ready, []),
  // Agents as the design's team picker counts them.
  node_count:
    { "t-ind": 6, "t-docs": 3, "t-bug": 4, "t-full": 7, "t-land": 3 }[id] ?? 5,
  ...extra,
});

const lastRun = (id, status, idea, minAgo, extra = {}) => ({
  status,
  at: ago(minAgo + 5),
  run_id: id,
  idea,
  updated_at: ago(minAgo),
  pr_url: null,
  ...extra,
});

export const TEAMS = [
  team("t-ind", "Indicator sprint team", {
    readiness: readiness({
      ready: false,
      missing_providers: ["anthropic", "xai"],
      missing_nodes: ["architect", "pm"],
    }),
    last_run: lastRun(
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
      ...lastRun("r-docs", "running", "Write the API reference for /runs", 2),
      at: ago(11),
    },
    last_active_at: ago(2),
    spend_usd: 1.37,
    run_count: 3,
    active_run_count: 1,
    shape: { nodes: [PM, WRITER, SHIP], loops: [] },
  }),
  team("t-bug", "Bugfix squad", {
    readiness: readiness(
      { ready: false, missing_providers: ["xai"], missing_nodes: ["engineer"] },
      ready,
      ["grok"],
    ),
    last_run: lastRun("r-flaky", "failed", "Fix the flaky login test", 11 * 60),
    last_active_at: ago(11 * 60),
    spend_usd: 0.64,
    run_count: 4,
    shape: { nodes: [PM, ENG, REV, SHIP], loops: [{ from: 2, to: 1 }] },
  }),
  team("t-full", "Full feature squad", {
    last_run: lastRun(
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

export const COPY = team("t-ind-copy", "Indicator sprint team (copy)", {
  created_at: ago(0),
  last_active_at: ago(0),
  template_key: "plan_review",
  template_name: "PM → Architect → Engineer ⇄ Reviewer",
  duplicated_from: { team_graph_id: "t-ind", name: "Indicator sprint team" },
  shape: TEAMS[0].shape,
});

export const TEMPLATES = {
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

// ---- Runs, Needs you, spend (slice F1a) ----

export const chip = (id, label, role, kind, state, loops_with = null) => ({
  node_id: id,
  origin_node_id: null,
  role_name: role,
  label,
  kind,
  state,
  loops_with,
});
export const run = (
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

export const rsiRun = run(
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
export const docsRun = run(
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
export const flakyRun = run(
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
// An older run past the first page, so Recent runs has "Show more" as the design draws it.
const guideRun = run(
  "r-guide",
  T.docs,
  "Docs team",
  "Write the webhook guide",
  "completed",
  "completed",
  5 * 24 * 60,
);
export const recent = [rsiRun, docsRun, flakyRun, csvRun, macdRun, guideRun];

export const inboxItems = [
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

/** GET /api/runs: `status=active` → the active runs; `q` → ⌘K search; else newest first, paged. */
export function runsRoute({ active = [rsiRun, docsRun], list = recent } = {}) {
  return (req) => {
    const u = new URL(req.url());
    const status = u.searchParams.get("status") ?? "all";
    if (status === "active")
      return { json: { runs: active, next_cursor: null } };
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    let filtered =
      status === "all" ? list : list.filter((r) => r.status_group === status);
    if (q)
      filtered = filtered.filter((r) =>
        `${r.idea} ${r.team?.name}`.toLowerCase().includes(q),
      );
    const limit = Number(u.searchParams.get("limit") ?? 50);
    return {
      json: {
        runs: filtered.slice(0, limit),
        next_cursor: filtered.length > limit ? "next" : null,
      },
    };
  };
}

/** Every endpoint the full Home page reads, answered with the design's sample data. */
export const homeRoutes = (over = {}) => ({
  "GET /api/teams": { teams: TEAMS },
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
  "GET /api/teams/:id/graph": { team_graph_id: "t", nodes: [], edges: [] },
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
  "GET /api/templates": TEMPLATES,
  "GET /api/account/preferences": { get_started_hidden: true },
  "GET /api/providers": {
    providers: [
      { provider: "openai", key_last4: "abcd", created_at: ago(9000) },
    ],
  },
  "GET /api/engines/subscriptions": { subscriptions: [] },
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
  ...over,
});

// The design says "Good morning" and has "Indicator sprint team" in the composer.
// The page's clock is frozen at the moment these fixtures were built (so "26m" stays "26m" however
// long a sweep takes), reads 9am ("Good morning"), and the composer starts on Indicator sprint team.
// Init scripts are serialized, so this is a string with the fixture time inlined.
export const morning = `(() => {
  const offset = ${now} - Date.now();
  const realNow = Date.now.bind(Date);
  Date.now = () => realNow() + offset;
  Date.prototype.getHours = function getHours() {
    return 9;
  };
  try {
    localStorage.setItem("tvashtr.home.lastTeam", "t-ind");
  } catch {
    /* ignore */
  }
})();`;
// Desktop: the planned repos bridge with the design's two recent folders.
export const desktopRepos = `${morning}
(() => {
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
})();`;

// Click like a person: at the element's centre, without Playwright's scroll-into-view (which
// scrolls the dashboard's main column for elements inside the unclipped Home cards).
export const tap = async (page, loc) => {
  const b = await loc.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};

export const scrollMain = (y) => async (page) => {
  await page.evaluate(
    (dy) => document.querySelector(".sh-main")?.scrollBy(0, dy),
    y,
  );
  await page.waitForTimeout(150);
};

export const typeIdea = async (page) => {
  await page
    .getByRole("textbox", { name: "What should the team build?" })
    .fill("Add a Stochastic RSI indicator with tests");
};
