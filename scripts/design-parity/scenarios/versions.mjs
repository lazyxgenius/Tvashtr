// M5 — team versions (Team Setup › Ver-History, Ver-Draft, Ver-Changes, Ver-ChangesFields, Ver-Restore,
// Ver-RunTag, Ver-AgentHistory, Ver-AgentCompare, Ver-RunBar, Ver-HomeRuns). `kept-teamcanvas-*` capture
// the team canvas's kept-elements inventory with M5 on screen (the chip), website and Desktop. Each
// board renders as a website and a Desktop render (runs-live.mjs's `pair` convention): every Ver-*
// board but Ver-HomeRuns is drawn in Desktop (the 30px title strip), so the Desktop render is the
// comparison and the web render is framed 30px down; Ver-HomeRuns is a website board (Home), so the
// web render is the comparison and the Desktop render is framed 30px up. The sample data is the
// boards' (docs/superpowers/plans/api/versions.md's shapes): team "Indicator sprint team", v7.
import { homeRoutes, morning, recent, runsRoute } from "./home-fixtures.mjs";
import {
  ago,
  NODES,
  panelRoutes,
  TEAM_ID,
  TEAM_NAME,
} from "./panel-fixtures.mjs";
import { boardRoutes, RUN_ID } from "./runs-fixtures.mjs";
import { pair as runPair } from "./runs-live.mjs";

const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
const canvasReady = async (page) => {
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(300);
};
const underTitleStrip = (page) =>
  page.addStyleTag({
    content: "body { padding-top: 30px; box-sizing: border-box; }",
  });
const aboveTitleStrip = (page) =>
  page.addStyleTag({
    content: "html { height: calc(100% + 30px); margin-top: -30px; }",
  });

/** A board as a website render and a Desktop render (runs-live.mjs's `pair`). */
function pair(
  board,
  {
    desktopBoard = true,
    path,
    routes,
    desktopRoutes = routes,
    steps,
    init = "",
  },
) {
  const frame = (f) => async (p) => {
    await f(p);
    await steps?.(p);
  };
  return [
    {
      name: `${board}-web`,
      path,
      routes,
      init,
      steps: desktopBoard ? frame(underTitleStrip) : steps,
      settle: 600,
    },
    {
      name: `${board}-desktop`,
      path,
      routes: desktopRoutes,
      desktop: true,
      init: `${SEEN}${init}`,
      steps: desktopBoard ? steps : frame(aboveTitleStrip),
      settle: 600,
    },
  ];
}

// ---- The boards' canvas: Product manager → Spec approval → Engineer ⇄ Reviewer (3 rounds) → Ship ----
// The Reviewer's instructions are the boards' (Ver-AgentHistory's drawer, Ver-AgentCompare's diff).
const BOARD_PROMPT = [
  "You are the Reviewer on a software team. The engineer’s build is in your current working directory. Review it — do NOT improve it.",
  "",
  "Do these steps in order:",
  "1. Inspect the files the engineer changed.",
  "2. Run the repository’s tests: python -m pytest -q",
  "3. Compare the build with the spec, item by item.",
  "4. Fail the round if any new indicator is not registered on INDICATORS.",
  "5. Approve only when the tests pass and every spec item is met.",
].join("\n");
const V6_PROMPT = [
  ...BOARD_PROMPT.split("\n").slice(0, 6),
  "4. Approve when the tests pass.",
].join("\n");
const at = (key, x, y, extra = {}) => ({
  ...NODES[key],
  position: { x, y },
  ...extra,
});
const BOARD_NODES = [
  at("pm", 36, 60),
  at("prd", 250, 100, {
    config: { ...NODES.prd.config, title: "Spec approval" },
  }),
  at("eng", 424, 60),
  at("rev", 660, 60, { prompt: BOARD_PROMPT }),
  at("ship", 890, 92),
];
const edge = (id, s, t, conditions = null) => ({
  id,
  source_node_id: NODES[s].id,
  target_node_id: NODES[t].id,
  edge_type: "default",
  conditions,
});
const BOARD_EDGES = [
  edge("e-pm-prd", "pm", "prd"),
  edge("e-prd-eng", "prd", "eng", { when: "approved" }),
  edge("e-eng-rev", "eng", "rev"),
  edge("e-rev-eng", "rev", "eng", { loop_limit: 3 }),
  edge("e-rev-ship", "rev", "ship", { when: "approved" }),
];

// ---- Versions (Ver-History): v7 … v3 shown, v2 and v1 behind "Show 2 older versions" ----
const DAY = 1440;
const ROWS = [
  [7, 2, "Reviewer: stricter about the INDICATORS registry", 1],
  [6, DAY + 60, "Added the Spec approval gate", 3],
  [5, 3 * DAY + 60, "Engineer: model changed to Claude Sonnet 4", 2],
  [4, 5 * DAY + 60, "Engineer: added a backup model", 4],
  [3, 8 * DAY, "Imported from a team file", 0],
  [2, 9 * DAY, "Engineer: instructions changed", 0],
  [1, 10 * DAY, "First version", 0],
];
const versions = (changes) => ({
  current: 7,
  saved_at: ago(2),
  changes,
  next: 8,
  total: ROWS.length,
  versions: ROWS.map(([number, min, summary, runs]) => ({
    number,
    created_at: ago(min),
    author: "you",
    summary,
    note: null,
    runs,
    source: number === 1 ? "first" : "save",
    restored_from: null,
  })),
});

// ---- Ver-Changes: what changed in v7 (the Reviewer's instructions) ----
const REVIEWER_TEXT = {
  key: "node:n-rev:prompt",
  node_id: "n-rev",
  agent: "Reviewer",
  role: "reviewer",
  field: "Instructions",
  kind: "text",
  removed: 1,
  added: 2,
  lines: [
    {
      op: "context",
      text: "3. Compare the build with the spec, item by item.",
    },
    { op: "removed", text: "4. Approve when the tests pass." },
    {
      op: "added",
      text: "4. Fail the round if any new indicator is not registered on INDICATORS.",
    },
    {
      op: "added",
      text: "5. Approve only when the tests pass and every spec item is met.",
    },
  ],
};
const V7 = {
  number: 7,
  created_at: ago(2),
  author: "you",
  summary: ROWS[0][2],
  note: null,
  source: "save",
  restored_from: null,
  current: true,
  compared_with: 6,
  changes: [REVIEWER_TEXT],
  same: ["models", "routes", "gates", "budget"],
  runs: [
    {
      run_id: "r-12",
      number: 12,
      idea: "Add an RSI indicator",
      status: "completed",
    },
  ],
};
// ---- Ver-ChangesFields: what changed in v6 (a gate, the routes, a model, skills) ----
const route = (n, kind, text) => ({
  key: `route:${n}`,
  agent: null,
  field: "Routes",
  kind,
  text,
});
const V6 = {
  ...V7,
  number: 6,
  created_at: ago(DAY + 60),
  summary: ROWS[1][2],
  current: false,
  compared_with: 5,
  changes: [
    {
      key: "node:n-prd",
      node_id: "n-prd",
      agent: "Spec approval",
      role: "prd_approval",
      field: null,
      kind: "added",
      gate: true,
    },
    route(1, "added", "Product manager → Spec approval"),
    route(2, "added", "Spec approval → Engineer · when approved"),
    route(3, "removed", "Product manager → Engineer"),
    {
      key: "node:n-eng:model",
      node_id: "n-eng",
      agent: "Engineer",
      role: "engineer",
      field: "Model",
      kind: "value",
      before: "openai/gpt-4.1-mini",
      after: "anthropic/claude-sonnet-4",
    },
    {
      key: "node:n-eng:skills",
      node_id: "n-eng",
      agent: "Engineer",
      role: "engineer",
      field: "Skills",
      kind: "changed",
    },
  ],
  same: ["budget"],
  runs: [
    {
      run_id: "r-11",
      number: 11,
      idea: "Add a VWAP indicator",
      status: "failed",
    },
  ],
};
// ---- Ver-Restore: restoring v6 makes v8 ----
const RESTORE = {
  number: 6,
  makes: 8,
  current: 7,
  draft_saved_as: null,
  changes: [{ ...REVIEWER_TEXT, lines: [] }],
};
// ---- Ver-RunTag: the team's runs, each with its version ----
const run = (n, status, v, idea, minutes, spent, extra = {}) => ({
  run_id: `r-${n}`,
  number: n,
  status,
  team_version_number: v,
  idea,
  created_at: ago(60 * (13 - n) + minutes),
  updated_at: ago(60 * (13 - n)),
  cost_total_usd: spent,
  spent_usd: spent,
  pr_url: null,
  pr_number: null,
  resumed_as: null,
  ...extra,
});
const pr = (n) => ({
  pr_url: `https://github.com/lazyxgenius/trade_mcp/pull/${n}`,
  pr_number: n,
});
const RUNS = [
  run(12, "completed", 7, "Add an RSI indicator", 22, 1.12, pr(42)),
  run(11, "failed", 6, "Add a VWAP indicator", 18, 0.84, { resumed_as: 13 }),
  run(10, "completed", 6, "Add Bollinger bands", 25, 1.3, pr(39)),
  run(9, "cancelled", 6, "Add an ATR indicator", 6, 0.21),
  run(8, "completed", 5, "Fix the EMA warm-up", 14, 0.66, pr(35)),
  run(7, "completed", 5, "Add a stochastic oscillator", 27, 1.41, pr(33)),
];
// ---- Ver-AgentHistory: the Reviewer's instruction history ----
const HISTORY = {
  count: 3,
  entries: [
    {
      number: 7,
      created_at: ago(2),
      author: "you",
      current: true,
      first: false,
      text: BOARD_PROMPT,
      added: [
        "Fail the round if any new indicator is not registered on INDICATORS.",
      ],
      removed: ["Approve when the tests pass."],
    },
    {
      number: 6,
      created_at: ago(DAY + 60),
      author: "you",
      current: false,
      first: false,
      text: V6_PROMPT,
      added: ["Compare the build with the spec, item by item."],
      removed: [],
    },
    {
      number: 4,
      created_at: ago(5 * DAY + 60),
      author: "you",
      current: false,
      first: true,
      text: "You are the Reviewer.",
      added: [],
      removed: [],
      from_builtin: "Reviewer",
    },
  ],
};

/** The canvas page's API for the team, with its versions. */
function teamRoutes(desktop, changes = 0) {
  const base = desktop
    ? panelRoutes({ keys: [], subs: ["claude", "grok"] })
    : panelRoutes();
  return {
    ...base,
    "GET /api/teams": {
      teams: [
        {
          team_graph_id: TEAM_ID,
          name: TEAM_NAME,
          node_count: 5,
          last_run: null,
        },
      ],
    },
    [`GET /api/teams/${TEAM_ID}/graph`]: {
      team_graph_id: TEAM_ID,
      name: TEAM_NAME,
      nodes: BOARD_NODES,
      edges: BOARD_EDGES,
    },
    [`GET /api/teams/${TEAM_ID}/validate`]: {
      errors: [],
      warnings: [],
      runnable: true,
    },
    [`GET /api/teams/${TEAM_ID}/runs`]: { runs: RUNS },
    [`GET /api/teams/${TEAM_ID}/versions`]: versions(changes),
    [`GET /api/teams/${TEAM_ID}/versions/7`]: V7,
    [`GET /api/teams/${TEAM_ID}/versions/6`]: V6,
    [`GET /api/teams/${TEAM_ID}/versions/6/restore`]: RESTORE,
    [`GET /api/teams/${TEAM_ID}/nodes/n-rev/instruction-history`]: HISTORY,
    "GET /api/runs/r-12/documents": { documents: [] },
    "GET /api/account/preferences": {},
    "GET /api/node-templates": { templates: [] },
  };
}
const canvas = (changes = 0, extra = {}) => ({
  path: `/#/teams/${TEAM_ID}`,
  routes: teamRoutes(false, changes),
  desktopRoutes: teamRoutes(true, changes),
  ...extra,
});

/** The chip opens History; then `then` (a tab, a dialog). */
const history =
  (then = async () => {}) =>
  async (page) => {
    await canvasReady(page);
    await page.getByRole("button", { name: "Version history" }).click();
    await page.getByText("5 of 7 versions").waitFor();
    await then(page);
    await page.mouse.move(700, 880); // no hover state (the boards draw none)
    await page.waitForTimeout(250);
  };
const panel = (page) => page.getByRole("complementary", { name: "History" });

/** The Reviewer's drawer (Setup), with Instructions › History open. */
const reviewerHistory =
  (then = async () => {}) =>
  async (page) => {
    await canvasReady(page);
    const drawer = page.getByRole("complementary", {
      name: "Reviewer settings",
    });
    await drawer.getByRole("button", { name: "History" }).click();
    await drawer.getByText("3 versions").waitFor();
    await then(page, drawer);
    await page.mouse.move(700, 880); // no hover state (the boards draw none)
    await page.waitForTimeout(250);
  };

const HOME_VERSIONS = [7, 3, 5, 2, 6, null];
const homeRecent = recent.map((r, i) => ({
  ...r,
  team_version_number: HOME_VERSIONS[i],
}));

// Ver-RunBar: the done run #12 (Live-Done's), on v7.
const RUN_BAR = boardRoutes("Live-Done");
const runKey = `GET /api/runs/${RUN_ID}`;
RUN_BAR[runKey] = {
  ...RUN_BAR[runKey],
  run: { ...RUN_BAR[runKey].run, number: 12, team_version_number: 7 },
};

export default [
  {
    name: "kept-teamcanvas-web",
    path: `/#/teams/${TEAM_ID}`,
    routes: teamRoutes(false),
    steps: canvasReady,
    settle: 600,
  },
  {
    name: "kept-teamcanvas-desktop",
    path: `/#/teams/${TEAM_ID}`,
    routes: teamRoutes(true),
    desktop: true,
    init: SEEN,
    steps: canvasReady,
    settle: 600,
  },
  ...pair("Ver-History", { ...canvas(), steps: history() }),
  ...pair("Ver-Draft", { ...canvas(2), steps: history() }),
  ...pair("Ver-Changes", {
    ...canvas(),
    steps: history(async (page) => {
      await panel(page)
        .getByRole("button", { name: "What changed" })
        .first()
        .click();
      await page
        .getByText("Compared with v6 · saved 2 minutes ago by you")
        .waitFor();
    }),
  }),
  ...pair("Ver-ChangesFields", {
    ...canvas(),
    steps: history(async (page) => {
      await panel(page)
        .getByRole("button", { name: "What changed" })
        .nth(1)
        .click();
      await page
        .getByText("Compared with v5 · saved yesterday by you")
        .waitFor();
    }),
  }),
  ...pair("Ver-Restore", {
    ...canvas(),
    steps: history(async (page) => {
      await panel(page)
        .getByRole("button", { name: "Restore" })
        .first()
        .click();
      await page.getByText("Runs that are going keep their version").waitFor();
    }),
  }),
  ...pair("Ver-RunTag", {
    ...canvas(),
    steps: history(async (page) => {
      await panel(page).getByRole("button", { name: "Runs" }).click();
      await page.getByText("Add a stochastic oscillator").waitFor();
    }),
  }),
  ...pair("Ver-AgentHistory", {
    ...canvas(0, { path: `/#/teams/${TEAM_ID}?node=n-rev` }),
    steps: reviewerHistory(),
  }),
  // The same, the drawer scrolled to the instruction history: the app's collapsed editor is 196px
  // (the board draws 118px), so the list starts below the fold until it is scrolled to.
  ...pair("Ver-AgentHistory", {
    ...canvas(0, { path: `/#/teams/${TEAM_ID}?node=n-rev` }),
    steps: reviewerHistory(async (page, drawer) => {
      await drawer
        .getByRole("region", { name: "Instruction history" })
        .evaluate((el) => el.scrollIntoView({ block: "start" }));
    }),
  }).map((s) => ({
    ...s,
    name: s.name.replace("Ver-AgentHistory", "Ver-AgentHistory-list"),
  })),
  ...pair("Ver-AgentCompare", {
    ...canvas(0, { path: `/#/teams/${TEAM_ID}?node=n-rev` }),
    steps: reviewerHistory(async (page, drawer) => {
      await drawer.getByRole("button", { name: "Compare" }).first().click();
      await page
        .getByRole("dialog", { name: "Compare v6 with the text now" })
        .waitFor();
      // The board draws the drawer unscrolled under the dialog.
      await page.evaluate(() =>
        document.querySelector(".nd-body")?.scrollTo(0, 0),
      );
    }),
  }),
  ...runPair("Ver-RunBar", {
    routes: RUN_BAR,
    now: "11:04:00",
    steps: async (page) => {
      await page.getByRole("region", { name: "Activity" }).waitFor();
      await page.waitForTimeout(300);
    },
  }),
  ...pair("Ver-HomeRuns", {
    desktopBoard: false,
    path: "/#/home",
    init: morning,
    routes: homeRoutes({ "GET /api/runs": runsRoute({ list: homeRecent }) }),
    steps: async (page) => {
      await page
        .getByRole("region", { name: "Recent runs" })
        .getByText("v7")
        .waitFor();
      await page.waitForTimeout(200);
    },
  }),
];
