// M10 — Start a new run from this one (Runs › Next-Finished, -Carry, -CarryMerged, -Started,
// -CameAlong, -More, -Log). Every board is drawn in Desktop (the 30px title strip): the Desktop render
// is the comparison and the web render is framed 30px down (runs-live.mjs's `pair`). The sample data
// is the boards' (docs/superpowers/plans/api/start-from-run.md's shapes): run #12 "Add an RSI
// indicator" done in 22m 38s for $1.12 with pull request #42 (runs-fixtures.mjs's Live-Done, the clock
// at 11:04:00), and run #14 "Add a MACD indicator" started from it (the clock at 11:10:14). Every state
// is reached through the UI: hover "Start the next run from this" (its tip), click it (the dialog), type
// the task, Start run (a refusal), the run bar's ⋯ (its menu) › Download the run log, "See what came
// along". `kept-m10-*` capture the kept-elements inventories of the run-view screens M10 adds to (the
// Done run view; a running run's view; the Done run's Activity with every step shown), website and
// Desktop (brief §2.2).
import { EDGES, NODES, TEAM_ID } from "./panel-fixtures.mjs";
import {
  activityFor,
  boardNow,
  boardRoutes,
  clockAt,
  frozenAt,
  runPath,
  runRoutes,
  RUN_ID,
} from "./runs-fixtures.mjs";
import { activityReady, pair } from "./runs-live.mjs";

const DONE = "Live-Done";
const DONE_NOW = boardNow(DONE); // 11:04:00
const PR_URL = "https://github.com/lazyxgenius/trade_mcp/pull/42";

// ---- Run #12, done (Next-Finished / -Carry / -CarryMerged / -More / -Log) ----
/** Live-Done's Activity with the boards' Ship line (31 steps). */
function doneActivity() {
  const a = activityFor(DONE);
  return {
    ...a,
    number: 12,
    lines: [
      ...a.lines.map((l) =>
        l.kind === "pr" ? { ...l, text: "Opened pull request #42 from branch tvashtr/run-12" } : l,
      ),
      // The run's saved memories, as the server sends the line (Next-Finished's 11:03:30).
      {
        id: "run:memories",
        at: at("11:03:30"),
        node_id: null,
        label: "Run",
        iteration: null,
        kind: "memories",
        text: "Saved 3 new memories from this run · review them in Toolkit",
        tone: "neutral",
        refs: {},
        review_memories: true,
      },
    ].sort((x, y) => x.at.localeCompare(y.at)),
  };
}

const DECISIONS = [
  { title: "Spec approved", text: null },
  { title: "The reviewer’s rule", text: "every indicator is registered on INDICATORS" },
];
const MEMORIES = [
  { id: "m-reg", content: "Register every indicator on INDICATORS" },
  { id: "m-len", content: "Indicators take a length and default to 14" },
  { id: "m-test", content: "Run python -m pytest -q tests/test_indicators.py before you finish" },
];
const SUMMARIES = [
  { agent: "Product manager", text: "Wrote the RSI spec (v3) and its acceptance tests." },
  {
    agent: "Engineer",
    text: "Added RSI to core/indicators.py, registered it and made 41 tests pass in 3 rounds.",
  },
  { agent: "Reviewer", text: "Approved in round 3: RSI is registered, bounded 0–100 and tested." },
];

/** `GET /api/runs/r-12/next` (Next-Carry; `merged`: Next-CarryMerged — nothing decided). */
const nextInfo = (merged = false) => ({
  available: true,
  reason: null,
  run: { id: RUN_ID, number: 12, idea: "Add an RSI indicator" },
  spec: { version: 3 },
  decisions: merged ? [] : DECISIONS,
  memories: MEMORIES,
  pending_memories: 1,
  summaries: SUMMARIES,
  pr: { number: 42, branch: "tvashtr/run-12", merged },
  start_from: merged
    ? [{ value: "main", label: "main" }]
    : [
        { value: "pr", label: "tvashtr/run-12 (pull request #42)" },
        { value: "main", label: "main" },
      ],
  default_start: merged ? "main" : "pr",
  team: { id: TEAM_ID, version: 7 },
  entry_agent: "Product manager",
});

// Next-CarryMerged: the hosted ceiling's 429 (routers.py's owner_concurrency_limit body).
const FULL = "you already have 3 run(s) in flight (limit 3) — wait for one to finish, or cancel it";

function doneRoutes({ merged = false, next = true } = {}) {
  const base = boardRoutes(DONE);
  const run = base[`GET /api/runs/${RUN_ID}`];
  return {
    ...base,
    [`GET /api/runs/${RUN_ID}`]: { ...run, run: { ...run.run, number: 12, pr_url: PR_URL } },
    [`GET /api/runs/${RUN_ID}/activity`]: doneActivity(),
    ...(next ? { [`GET /api/runs/${RUN_ID}/next`]: nextInfo(merged) } : {}),
    [`POST /api/runs/${RUN_ID}/next`]: () => ({
      status: 429,
      json: { detail: { code: "owner_concurrency_limit", message: FULL } },
    }),
  };
}

// The run log (Next-Log): its first lines, the middle (elided by the preview) and its last line,
// about 180 KB in all. Served as text by a page route (shoot-app answers JSON).
const LOG_HEAD = [
  "run #12 · Indicator sprint team · Add an RSI indicator · team setup v7",
  "10:41:02  run        started on lazyxgenius/trade_mcp (main)",
  "10:42:05  pm         wrote the spec (v2)",
  "10:43:10  gate       approved by you",
  "10:44:02  engineer   edited core/indicators.py (+48 −3)",
  "10:44:40  engineer   ran: python -m pytest -q tests/test_indicators.py → 3 failed",
  "                     env: GITHUB_TOKEN=••••  OPENAI_API_KEY=••••",
  "10:48:40  reviewer   changes requested: register RSI on INDICATORS; default length 14",
];
const LOG_TAIL = "11:03:22  ship       opened pull request #42";
function logText() {
  const filler = "                     tests/test_indicators.py::test_rsi_window PASSED [ 41%]";
  const body = [...LOG_HEAD];
  const target = 180 * 1024;
  let size = new TextEncoder().encode(`${body.join("\n")}\n${LOG_TAIL}\n`).length;
  const step = new TextEncoder().encode(`${filler}\n`).length;
  while (size + step <= target) {
    body.push(filler);
    size += step;
  }
  return `${body.join("\n")}\n${LOG_TAIL}\n`;
}

const still = async (page) => {
  await page.mouse.move(700, 880); // no hover state
  await page.waitForTimeout(200);
};
const startButton = (page) => page.getByRole("button", { name: "Start the next run from this" });
/** Hover the start button's lower edge (the ⋯ menu may cover its top): its tip shows. */
const hoverStart = async (page) => {
  const box = await startButton(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 3);
  await page.locator(".lv-done__tip").waitFor({ state: "visible" });
};
const openDialog = async (page) => {
  await activityReady(page);
  await startButton(page).click();
  const dialog = page.getByRole("dialog", { name: "Start a new run from run #12" });
  await dialog.waitFor();
  await dialog
    .getByLabel("What should the team do next?")
    .fill("Add a MACD indicator, registered on INDICATORS the same way as RSI, with tests.");
  await still(page);
  return dialog;
};
const openMenu = async (page) => {
  await activityReady(page);
  await page.getByRole("button", { name: "More for this run" }).click();
  await page.getByRole("menuitem", { name: "Download the run log" }).waitFor();
};

// ---- Run #14, started from run #12 (Next-Started / -CameAlong) ----
const NEXT_ID = "r-14";
const STARTED_NOW = "11:10:14";
const NEXT_PATH = `/#/teams/${TEAM_ID}/runs/${NEXT_ID}`;
const at = (hms) => clockAt(hms);
let seq = 0;
const line = (hms, label, kind, text, refs = {}, extra = {}) => ({
  id: `n14:${++seq}`,
  at: at(hms),
  node_id: { Run: null, "Product manager": "n-pm" }[label],
  label,
  iteration: label === "Run" ? null : 1,
  kind,
  text,
  tone: "neutral",
  refs,
  ...extra,
});
const AGENTS = [
  ["n-pm", "Product manager", "completion", null],
  ["n-prd", "Approval gate", "gate", null],
  ["n-stop", "Stop", "stop", null],
  ["n-eng", "Engineer", "agent", 3],
  ["n-rev", "Reviewer", "agent", 3],
  ["n-esc", "Escalation gate", "gate", null],
  ["n-ship", "Ship", "ship", null],
];
const pmLive = {
  live_state: "working",
  last_event_at: at("11:10:12"),
  activity: "Updating spec v3 for MACD",
  activity_started_at: at("11:10:12"),
  retry: null,
  backup_model: null,
};
const waiting = {
  live_state: "waiting",
  last_event_at: null,
  activity: null,
  activity_started_at: null,
  retry: null,
  backup_model: null,
};
const STARTED_FROM = {
  run_id: RUN_ID,
  number: 12,
  summary: "brought spec v3, 2 decisions and 3 memories",
};
const CARRY = {
  from: { run_id: RUN_ID, number: 12 },
  spec: { version: 3 },
  decisions: DECISIONS,
  memories: MEMORIES,
  summaries: SUMMARIES,
};

function startedRoutes() {
  seq = 0;
  const lines = [
    line(
      "11:10:02",
      "Run",
      "started",
      "Started from run #12 · brought spec v3, 2 decisions and 3 memories",
      {},
      { came_along: true },
    ),
    line("11:10:03", "Run", "started", "Working on branch tvashtr/run-14, from pull request #42"),
    line("11:10:05", "Product manager", "read", "Read the spec from run #12 (v3)"),
    line(
      "11:10:09",
      "Product manager",
      "read",
      "Read 3 memories, including “register every indicator on INDICATORS”",
    ),
    // The PM's open step (the board's "live · 2 s").
    line("11:10:12", "Product manager", "command", "Updating the spec for MACD", {
      running: true,
      started_at: at("11:10:12"),
      output_tail: [],
    }),
  ];
  const n = (key, status, iteration, live, invocations = []) => ({
    ...NODES[key],
    origin_node_id: NODES[key].id,
    status,
    iteration,
    invocations,
    live,
  });
  const graph = {
    run_id: NEXT_ID,
    team_graph_id: `${TEAM_ID}-run14`,
    nodes: [
      n("pm", "running", 1, pmLive, [
        {
          invocation_id: 141,
          iteration: 1,
          status: "running",
          outcome: null,
          outcome_detail: null,
          context_manifest: null,
          cost: null,
          connectors: null,
          started_at: at("11:10:04"),
          ended_at: null,
        },
      ]),
      n("prd", "idle", 0, waiting),
      n("stop", "idle", 0, waiting),
      n("eng", "idle", 0, waiting),
      n("rev", "idle", 0, waiting),
      n("esc", "idle", 0, waiting),
      n("ship", "idle", 0, waiting),
    ],
    edges: EDGES,
    resolution_warnings: [],
    live_state: "working",
  };
  const activity = {
    run_id: NEXT_ID,
    status: "running",
    live_state: "working",
    cursor: `${at(STARTED_NOW)}|n14:${lines.length}`,
    total: lines.length,
    number: 14,
    agents: AGENTS.map(([id, label, kind, rounds_limit]) => ({
      node_id: id,
      origin_node_id: id,
      label,
      kind,
      iteration: id === "n-pm" ? 1 : 0,
      rounds_limit,
      ...(id === "n-pm" ? pmLive : waiting),
      model: Object.values(NODES).find((x) => x.id === id)?.model ?? null,
    })),
    lines,
    pinned: null,
    summary: null,
  };
  const base = runRoutes("working");
  const row = {
    ...base[`GET /api/runs/${RUN_ID}`].run,
    id: NEXT_ID,
    team_graph_id: `${TEAM_ID}-run14`,
    idea: "Add a MACD indicator",
    status: "running",
    status_group: "running",
    created_at: at("11:10:02"),
    updated_at: at(STARTED_NOW),
    base_ref: "tvashtr/run-12",
    cost_total_usd: 0.01,
    spent_usd: 0.01,
    live_state: "working",
    number: 14,
    started_from: STARTED_FROM,
  };
  return {
    ...base,
    [`GET /api/runs/${NEXT_ID}`]: {
      run_id: NEXT_ID,
      workflow_status: "PENDING",
      run: row,
      costs: [],
    },
    [`GET /api/runs/${NEXT_ID}/graph`]: graph,
    [`GET /api/runs/${NEXT_ID}/tasks`]: { run_id: NEXT_ID, tasks: [] },
    [`GET /api/runs/${NEXT_ID}/activity`]: activity,
    [`GET /api/runs/${NEXT_ID}/documents`]: { documents: [] },
    [`GET /api/runs/${NEXT_ID}/carry`]: CARRY,
    [`GET /api/spike/run-events/${NEXT_ID}`]: { run_id: NEXT_ID, events: [] },
    "GET /api/account/preferences": {
      notify_asked: true,
      notify_needs_you: true,
      notify_stalls_fails: true,
      notify_finishes: true,
    },
    "GET /api/inbox": { count: 0, items: [] },
    "GET /api/runs": { runs: [], next_cursor: null },
  };
}

const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
/** A screen's kept-elements inventory, website and Desktop (run with INVENTORY=1), unframed. */
const kept = (name, { path, routes, now, steps }) => [
  { name: `kept-m10-${name}-web`, path, routes, init: frozenAt(now), steps, settle: 900 },
  {
    name: `kept-m10-${name}-desktop`,
    path,
    routes,
    desktop: true,
    init: frozenAt(now, SEEN),
    steps,
    settle: 900,
  },
];

export default [
  ...pair("Next-Finished", {
    now: DONE_NOW,
    routes: doneRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await hoverStart(page);
    },
  }),
  ...pair("Next-Carry", { now: DONE_NOW, routes: doneRoutes(), steps: openDialog }),
  ...pair("Next-CarryMerged", {
    now: DONE_NOW,
    routes: doneRoutes({ merged: true }),
    steps: async (page) => {
      const dialog = await openDialog(page);
      await dialog.getByRole("button", { name: "Start run" }).click();
      await dialog.getByRole("alert").waitFor();
      await still(page);
    },
  }),
  ...pair("Next-Started", {
    path: NEXT_PATH,
    now: STARTED_NOW,
    routes: startedRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await still(page);
    },
  }),
  ...pair("Next-CameAlong", {
    path: NEXT_PATH,
    now: STARTED_NOW,
    routes: startedRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await page.getByRole("button", { name: "See what came along" }).click();
      await page.getByRole("dialog", { name: "What came along from run #12" }).waitFor();
      await still(page);
    },
  }),
  ...pair("Next-More", {
    now: DONE_NOW,
    routes: doneRoutes(),
    steps: async (page) => {
      await openMenu(page);
      await hoverStart(page);
    },
  }),
  ...pair("Next-Log", {
    now: DONE_NOW,
    routes: doneRoutes(),
    steps: async (page) => {
      const text = logText();
      await page.route(/\/api\/runs\/r-12\/log\?format=/, (route) =>
        route.fulfill({ status: 200, body: text, contentType: "text/plain; charset=utf-8" }),
      );
      await openMenu(page);
      await page.getByRole("menuitem", { name: "Download the run log" }).click();
      const dialog = page.getByRole("dialog", { name: "Download the run log" });
      await dialog.getByLabel("Preview").waitFor();
      await still(page);
    },
  }),
  // Kept elements: the same fixtures, no hover, no dialog.
  ...kept("done", {
    path: runPath(),
    now: DONE_NOW,
    routes: doneRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await still(page);
    },
  }),
  ...kept("running", {
    path: NEXT_PATH,
    now: STARTED_NOW,
    routes: startedRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await still(page);
    },
  }),
  ...kept("activity", {
    path: runPath(),
    now: DONE_NOW,
    routes: doneRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await page.getByRole("button", { name: /^Show \d+ earlier steps$/ }).click();
      await still(page);
    },
  }),
];
