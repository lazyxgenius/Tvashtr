// F5 group G11 — the Runs and Docs tabs: Web-Runs, Panel-RunsEmpty, Flow-Runs-1..2, Flow-Docs-1..2,
// each as a website and a Desktop render.
import {
  NODES,
  TEAM_ID,
  ago,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";
import { aboveTitleStrip, at, pair } from "./panel-skills.mjs";

// The design's Reviewer rounds in "Add an RSI indicator" (newest first). Round 3's reasons run past
// the "Show all" cut right after the last `INDICATORS`.
const ROUND_3 =
  "No new indicator was added: `core/indicators.py` `INDICATORS`, `web/lib/strategies/indicators.ts` and " +
  "`TestRegistry.test_list_indicators_returns_twenty_eight` still list the same 28 names, and " +
  "`web/lib/engine-facts.ts` still sets `indicator_count` to 28. Specify the indicator name, formula, " +
  "parameters and outputs, then register the function on `INDICATORS` so the builder can list it.";
const round = (iteration, min, detail, tokens) => ({
  invocation_id: 800 + iteration,
  iteration,
  status: "done",
  outcome: "changes_requested",
  outcome_detail: detail,
  started_at: ago(min + 2),
  ended_at: ago(min),
  cost: tokens
    ? {
        prompt_tokens: tokens - 900,
        completion_tokens: 900,
        total_tokens: tokens,
        cost_usd: 0,
      }
    : null,
  model_used: "xai/grok-4.7",
  runs_on: { via: "api_key", provider: "xai" },
  given: null,
  produced: null,
});
const RSI = {
  run_id: "r-rsi",
  idea: "Add an RSI indicator",
  status: "completed",
  created_at: ago(60),
  live: false,
};
const past = (run_id, idea, day) => ({
  run_id,
  idea,
  status: "completed",
  created_at: `2026-09-${day}T10:00:00Z`,
  live: false,
  rounds_count: 1,
  last_outcome: "approved",
  last_status: "done",
  last_round_at: `2026-09-${day}T10:30:00Z`,
});
const HISTORY = {
  runs: [
    {
      ...RSI,
      rounds_count: 3,
      last_outcome: "changes_requested",
      last_status: "done",
      last_round_at: ago(31),
    },
    past("r-macd", "Fix the MACD label", "22"),
    past("r-first", "First team run", "20"),
  ],
  run: {
    ...RSI,
    rounds: [
      round(3, 31, ROUND_3, 18200),
      round(
        2,
        44,
        "The tests ran, but the new function is not registered on INDICATORS, so the builder can’t list it.",
        16900,
      ),
      round(1, 58, "No new indicator was added yet.", 15100),
    ],
  },
};

const agent = (id, label) => ({
  node_id: id,
  clone_node_id: `c-${id}`,
  role_name: id,
  label,
});
const PM = agent("n-pm", "Product manager");
const ENG = agent("n-eng", "Engineer");
const REV = agent("n-rev", "Reviewer");
const DOCS = {
  run_id: "r-rsi",
  run: RSI,
  documents: [
    {
      id: "d-spec",
      name: "spec",
      title: "PRD",
      doc_type: "prd",
      created_at: ago(58),
      updated_at: ago(31),
      is_shared_spec: true,
      version_count: 3,
      latest_version: {
        version_no: 3,
        created_at: ago(31),
        author: PM,
        note: "Revised in round 3",
      },
      written_by: [PM],
      read_by: [PM, ENG, REV],
    },
    {
      id: "d-notes",
      name: "build-notes",
      title: "build-notes",
      doc_type: "build-notes",
      created_at: ago(50),
      updated_at: ago(36),
      is_shared_spec: false,
      version_count: 2,
      latest_version: {
        version_no: 2,
        created_at: ago(36),
        author: ENG,
        note: "Revised in round 2",
      },
      written_by: [ENG],
      read_by: [REV],
    },
  ],
};

const FULL = panelRoutes({
  nodes: Object.values(NODES),
  over: {
    [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: HISTORY,
    "GET /api/runs/r-rsi/documents": DOCS,
  },
});
// Panel-RunsEmpty: a Reviewer that never ran and has no model yet ("Not run yet", "Needs a model").
const EMPTY = panelRoutes({
  nodes: Object.values({
    ...NODES,
    rev: {
      ...NODES.rev,
      model: "",
      last_run: null,
      skills: null,
      tool_config: null,
    },
  }),
  over: { "GET /api/memories": { memories: [] } },
});

const loaded = (page) =>
  page
    .getByText("Earlier rounds")
    .or(page.getByText("This agent hasn’t run yet"))
    .or(page.getByText("This agent reads"))
    .first()
    .waitFor();

/** The drawer alone, once the tab's data has loaded. */
const drawerAlone = (steps) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await loaded(page);
  await steps?.(page);
  await page.mouse.move(0, 0);
};

const runs = { width: 384, height: 800, path: at("runs") };
const docs = { width: 384, height: 800, path: at("docs") };

export default [
  ...pair(
    "Web-Runs",
    {
      path: at("runs"),
      steps: async (p) => {
        await drawerReady(p);
        await loaded(p);
      },
    },
    FULL,
    aboveTitleStrip,
  ),
  ...pair(
    "Panel-RunsEmpty",
    { ...runs, height: 760, steps: drawerAlone() },
    EMPTY,
  ),
  ...pair("Flow-Runs-1", { ...runs, steps: drawerAlone() }, FULL),
  ...pair(
    "Flow-Runs-2",
    {
      ...runs,
      steps: drawerAlone(async (p) => {
        await p.getByRole("button", { name: /^Round 2/ }).click();
        await p.getByText("16.9k tokens").waitFor();
      }),
    },
    FULL,
  ),
  ...pair("Flow-Docs-1", { ...docs, steps: drawerAlone() }, FULL),
  ...pair(
    "Flow-Docs-2",
    {
      ...docs,
      steps: drawerAlone(async (p) => {
        await p.getByRole("button", { name: "Change", exact: true }).click();
        await p.getByRole("menu", { name: "Choose a run" }).waitFor();
        await p.waitForTimeout(250);
      }),
    },
    FULL,
  ),
];
