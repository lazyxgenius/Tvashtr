// M9 — Task sets and a check before saving (Quality › Set-List, -Edit, -Results, -SaveCheck, -Checked,
// -Empty, -StartSet, -Running, -AddRecent, -RowMenu, -DeleteConfirm, -CheckedWorse) and the M8 boards
// that gain M9 content (Cmp-Start: the "One task | A task set" switch and the Task sets tab's count;
// Cmp-Results: "One task is a small sample · Compare on Indicators"). Every board is drawn in Desktop
// (the 30px title strip): the Desktop render is the comparison and the web render is framed 30px down
// (versions.mjs's / runs-live.mjs's `pair`), the clock standing still at the boards' moment (compare.mjs's
// 10:34:26). The sample data is the boards' (docs/superpowers/plans/api/task-sets.md's shapes): team
// "Indicator sprint team", the sets Indicators (5 tasks) and Bugfixes (3 tasks), v6 / v7 / v8.
// `kept-m9-*` capture the kept-elements inventories of the screens M9 adds to (the Compare tab's start
// form and a one-task results page, History, the Save-as dialog), website and Desktop (brief §2.2).
import compare from "./compare.mjs";
import { TEAM_ID, TEAM_NAME } from "./panel-fixtures.mjs";
import { clockAt, frozenAt } from "./runs-fixtures.mjs";
import { canvasReady, pair, teamRoutes } from "./versions.mjs";

const NOW = "10:34:26";
const T = Date.parse(clockAt(NOW));
const before = (min) => new Date(T - min * 60_000).toISOString();
const DAY = 1440;
const INIT = frozenAt(NOW);
const page = `/#/teams/${TEAM_ID}/compare`;
const still = async (p) => {
  await p.mouse.move(700, 880); // no hover state (the boards draw none)
  await p.waitForTimeout(250);
};

// ---- The team's task sets (Set-List, Set-Edit) ----
const item = (i, task, hidden_check) => ({
  id: `ti-${i}`,
  position: i,
  task,
  starts_from: "main",
  hidden_check,
});
const INDICATORS = {
  id: "ts-ind",
  name: "Indicators",
  items: [
    item(1, "Add an RSI indicator", "pytest -q tests/test_indicators.py -k rsi"),
    item(2, "Add a MACD indicator", "pytest -q -k macd"),
    item(3, "Add Bollinger bands", "pytest -q -k bollinger"),
    item(4, "Add an ATR indicator", "pytest -q -k atr"),
    item(5, "Fix the EMA warm-up", "pytest -q -k ema_warmup"),
  ],
  last_used: { compare_id: "cmp-0", a: 6, b: 7, at: before(2 * DAY + 60), summary: "v7 better on 4 of 5" },
  estimate: { cost_usd: 5.6, minutes: 40 },
};
// Bugfixes' checks and estimate are not drawn.
const BUGFIXES = {
  id: "ts-bug",
  name: "Bugfixes",
  items: [
    item(1, "Fix the flaky login test", "pytest -q -k login"),
    item(2, "Stop double-counting fees", "pytest -q -k fees"),
    item(3, "Handle an empty price list", "pytest -q -k empty_prices"),
  ],
  last_used: null,
  estimate: null,
};
const SETS = [INDICATORS, BUGFIXES];
const refOf = (s) => ({ id: s.id, name: s.name, count: s.items.length });

// ---- The Compare tab's API: compare.mjs's boards' (Cmp-Start, Cmp-Results), with the sets ----
const m8 = (name) => compare.find((s) => s.name === name);
const START_KEY = `GET /api/teams/${TEAM_ID}/compare`;
const SETS_KEY = `GET /api/teams/${TEAM_ID}/task-sets`;
const CMP_KEY = (id) => `GET /api/compares/${id}`;
/** compare.mjs's routes with the team's sets (the tab's count, the switch) and `over`. */
const withSets = (routes, sets = SETS, over = {}) => ({
  ...routes,
  [START_KEY]: { ...routes[START_KEY], task_sets: sets.map(refOf) },
  [SETS_KEY]: { sets },
  ...over,
});
const START_ROUTES = m8("Cmp-Start-desktop").routes;
const RESULTS_ROUTES = m8("Cmp-Results-desktop").routes;
// Cmp-Results: a one-task compare whose team has a set ("One task is a small sample").
const ONE_TASK = RESULTS_ROUTES[CMP_KEY("cmp-1")];
const SAMPLE = {
  ...ONE_TASK,
  results: { ...ONE_TASK.results, sample: { set_id: INDICATORS.id, name: "Indicators", count: 5 } },
};

// Set-AddRecent: this team's recent tasks, newest first (two are in the set).
const recent = (task, min) => ({
  task,
  team: { id: TEAM_ID, name: TEAM_NAME },
  status: "completed",
  status_group: "done",
  run_id: `r-${Math.round(min)}`,
  number: null,
  created_at: before(min),
});
const RECENT = {
  tasks: [
    recent("Add a stochastic oscillator", 2 * DAY + 60),
    recent("Add an RSI indicator", 2 * DAY + 120),
    recent("Add VWAP to the indicators list", 2 * DAY + 180),
    recent("Fix the EMA warm-up", 3 * DAY),
    recent("Retry the price feed on a timeout", 5 * DAY + 60),
  ],
};

// ---- A compare on Indicators: running (Set-Running), its results (Set-Results) ----
const SET_CMP = "cmp-set";
let runSeq = 30;
const cell = (status, over = {}) => ({
  run_id: status === "waiting" ? null : `r-${++runSeq}`,
  status,
  now: null,
  check: null,
  rounds: 0,
  cost_usd: 0,
  note: null,
  ...over,
});
const work = (now) => cell("running", { now });
const done = (check, rounds, cost_usd, note = null) => cell("finished", { check, rounds, cost_usd, note });
const wait = () => cell("waiting");
const row = (task, a, b, badge = null) => ({ task, a, b, badge });
const side = (label, version, status, cost_usd) => ({
  label,
  version,
  run_id: null,
  number: null,
  status,
  elapsed_s: 0,
  cost_usd,
  strip: [],
  current: null,
  lines: [],
  gate_task_id: null,
});
const setCompare = (status, elapsed_s, cost_usd, items, over = {}) => ({
  id: SET_CMP,
  team_id: TEAM_ID,
  task: "Indicators",
  auto_approve: true,
  status,
  elapsed_s,
  cost_usd,
  created_at: new Date(T - elapsed_s * 1000).toISOString(),
  ended_at: null,
  waiting: null,
  sides: [side("A", 6, status, 0), side("B", 7, status, 0)],
  results: null,
  set: refOf(INDICATORS),
  started: 10,
  runs_waiting: 0,
  items,
  ...over,
});
const SET_RUNNING = setCompare(
  "running",
  725,
  3.1,
  [
    row("Add an RSI indicator", work("Engineer · round 2"), done("passed", 2, 0.92)),
    row(
      "Add a MACD indicator",
      done("failed", 3, 1.21, "signal line missing"),
      work("Engineer · round 2"),
    ),
    row("Add Bollinger bands", work("Reviewer · round 1"), work("Engineer · round 1")),
    row("Add an ATR indicator", wait(), wait()),
    row("Fix the EMA warm-up", wait(), wait()),
  ],
  { started: 6, runs_waiting: 4 },
);
const card = (key, label, a, b, note, tone = "good") => ({ key, label, a, b, note, tone });
const SET_RESULTS = setCompare(
  "finished",
  2340,
  11.3,
  [
    row("Add an RSI indicator", done("passed", 4, 1.48), done("passed", 2, 0.92), "v7 better"),
    row(
      "Add a MACD indicator",
      done("failed", 3, 1.21, "signal line missing"),
      done("passed", 2, 1.02),
      "v7 better",
    ),
    row("Add Bollinger bands", done("passed", 3, 1.1), done("passed", 2, 0.98), "v7 better"),
    row(
      "Add an ATR indicator",
      done("failed", 4, 1.39, "stalled, then resumed"),
      done("passed", 3, 1.2),
      "v7 better",
    ),
    row("Fix the EMA warm-up", done("passed", 3, 0.92), done("passed", 2, 1.08), "v7 costs more"),
  ],
  {
    ended_at: before(6.2),
    results: {
      headline: "v7 did better on Indicators",
      rows: [],
      current_version: 7,
      restore: 6,
      cards: [
        card("checks", "Hidden checks passed", "3 of 5", "5 of 5", "2 more tasks really work"),
        card("rounds", "Rounds per task", "3.4", "2.2", "about 1 fewer round"),
        card("cost", "Cost", "$6.10", "$5.20", "$0.90 less in all"),
        card("retries", "Retries and stalls", "3", "0", "steadier runs"),
      ],
      sample: null,
    },
  },
);

// ---- The compare page's boards ----
/** A compare-page board: the Desktop render compared, the web render framed 30px down. */
const cmpBoard = (board, routes, steps, path = page) =>
  pair(board, { path, routes, init: INIT, steps });
const PAGE_ROUTES = withSets(START_ROUTES, SETS, { "GET /api/recent-tasks": RECENT });
/** The Task sets tab, picked from the Compare tab. */
const setsTab =
  (then = async () => {}) =>
  async (p) => {
    await p.getByRole("tab", { name: /^Task sets/ }).click();
    await p.getByRole("heading", { name: "Task sets", exact: true }).waitFor();
    await p.waitForTimeout(200);
    await then(p);
    await still(p);
  };
const card0 = (p) => p.getByRole("article", { name: "Indicators" });
const editIndicators = async (p) => {
  await card0(p).getByRole("button", { name: "Edit" }).click();
  await p.getByRole("dialog", { name: "Edit task set" }).waitFor();
  await p.evaluate(() => document.activeElement?.blur());
};
const openMenu = async (p) => {
  await p.getByRole("button", { name: "More for Indicators" }).click();
  await p.getByRole("menu").waitFor();
};
const startReady = async (p) => {
  await p.waitForFunction(() =>
    [...document.querySelectorAll("input")].some((i) => i.value === "Add an RSI indicator"),
  );
  await still(p);
};
const resultsReady = (label) => async (p) => {
  await p.getByRole("table", { name: label }).waitFor();
  await still(p);
};

// ---- The canvas boards (Set-SaveCheck, Set-Checked, Set-CheckedWorse) ----
const VERSIONS_KEY = `GET /api/teams/${TEAM_ID}/versions`;
// Set-SaveCheck: two changes since v7; the Reviewer has 6 tests; the team has Indicators.
const NUDGE = {
  count: 6,
  agents: [{ node_id: "n-rev", name: "Reviewer", count: 6 }],
  sub: "You changed the Reviewer’s instructions and the Engineer’s model.",
  option: "Run the Reviewer’s 6 tests",
  estimate: { cost_usd: 0.4, minutes: 4 },
};
const CHECK_SETS = [{ ...refOf(INDICATORS), estimate: INDICATORS.estimate }];
const saveRoutes = (desktop) => {
  const base = teamRoutes(desktop, 2);
  return {
    ...base,
    [VERSIONS_KEY]: { ...base[VERSIONS_KEY], tests: NUDGE, check_sets: CHECK_SETS },
  };
};
// Set-Checked / -CheckedWorse: v8 saved 8 minutes ago (v1 … v8); its check on Indicators finished.
const check = (passed, against, against_passed, cost_delta_usd, worse = false) => ({
  compare_id: `cmp-chk-${against + 1}`,
  set: "Indicators",
  passed,
  total: 5,
  against,
  against_passed,
  cost_delta_usd,
  status: "finished",
  worse,
});
const ver = (number, min, summary, runs, extra = {}) => ({
  number,
  created_at: before(min),
  author: "you",
  summary,
  note: null,
  runs,
  source: number === 1 ? "first" : "save",
  restored_from: null,
  tests: null,
  check: null,
  ...extra,
});
const tests = (passed) => ({ passed, total: 6, running: false });
const checkedVersions = (v8check) => {
  const versions = [
    ver(8, 8, "Engineer: model changed to openai/gpt-4.1", 0, {
      note: "Engineer on GPT-4.1; Reviewer names files",
      tests: tests(6),
      check: v8check,
    }),
    ver(7, 2 * DAY + 60, "Reviewer: stricter about the INDICATORS registry", 1, {
      tests: tests(5),
      check: check(5, 6, 3, null),
    }),
    ver(6, 3 * DAY + 60, "Added the Spec approval gate", 3, { tests: tests(4) }),
    ver(5, 5 * DAY, "Engineer: model changed to xai/grok-4.7", 2),
    ver(4, 6 * DAY, "Engineer: added a backup model", 4),
    ver(3, 8 * DAY, "Imported from a team file", 0),
    ver(2, 9 * DAY, "Engineer: instructions changed", 0),
    ver(1, 10 * DAY, "First version", 0),
  ];
  return {
    current: 8,
    saved_at: before(8),
    changes: 0,
    next: 9,
    total: versions.length,
    versions,
    tests: null,
    check_sets: CHECK_SETS,
  };
};
const PASSED = checkedVersions(check(5, 7, 5, -0.7));
// Set-CheckNotStarted: Save and check, the save made v8 and the check was refused; then the
// summary reads v8 saved just now (no changes).
const NOT_STARTED = "This team already has a compare running. Stop it first.";
const notStartedRoutes = (desktop) => {
  const before = saveRoutes(desktop);
  let saved = false;
  return {
    ...before,
    [VERSIONS_KEY]: () => ({
      json: saved
        ? { ...before[VERSIONS_KEY], current: 8, next: 9, changes: 0, saved_at: new Date().toISOString(), tests: null }
        : before[VERSIONS_KEY],
    }),
    [`POST /api/teams/${TEAM_ID}/versions`]: () => {
      saved = true;
      return { status: 201, json: { number: 8, tests_started: [], check_started: null, check_error: NOT_STARTED } };
    },
  };
};
const WORSE = checkedVersions(check(3, 7, 5, 0.4, true));
const historyRoutes = (desktop, versions) => ({
  ...teamRoutes(desktop),
  [VERSIONS_KEY]: versions,
});
const canvasBoard = (board, routes, steps) =>
  pair(board, {
    path: `/#/teams/${TEAM_ID}`,
    routes: routes(false),
    desktopRoutes: routes(true),
    init: INIT,
    steps: async (p) => {
      await canvasReady(p);
      await steps(p);
      await still(p);
    },
  });
const saveAs = async (p) => {
  await p.getByRole("button", { name: "Save as v8" }).click();
  const dialog = p.getByRole("dialog", { name: "Save as v8" });
  await dialog.waitFor();
  return dialog;
};
const history = async (p) => {
  await p.getByRole("button", { name: "Version history" }).click();
  await p.getByRole("complementary", { name: "History" }).getByText("Tests 6 of 6").waitFor();
};
/** History scrolled to the check's callout (the panel lists 5 versions, the boards draw 3, so the
 *  callout starts below the fold). */
const callout = (title) => async (p) => {
  await history(p);
  await p.getByText(title).evaluate((el) => el.scrollIntoView({ block: "center" }));
};

/** Kept elements: a scenario as `kept-m9-<screen>-web` / `-desktop` (the same states, unframed). */
const kept = (screen, shots) =>
  shots.map((s) => ({ ...s, name: s.name.replace(/^.*-(web|desktop)$/, `kept-m9-${screen}-$1`) }));

export default [
  ...cmpBoard("Set-List", PAGE_ROUTES, setsTab(), page),
  ...cmpBoard("Set-Empty", withSets(START_ROUTES, []), setsTab()),
  ...cmpBoard("Set-RowMenu", PAGE_ROUTES, setsTab(openMenu)),
  ...cmpBoard(
    "Set-DeleteConfirm",
    PAGE_ROUTES,
    setsTab(async (p) => {
      await openMenu(p);
      await p.getByRole("menuitem", { name: "Delete" }).click();
      await p.getByRole("alertdialog", { name: "Delete Indicators?" }).waitFor();
    }),
  ),
  ...cmpBoard("Set-Edit", PAGE_ROUTES, setsTab(editIndicators)),
  ...cmpBoard(
    "Set-AddRecent",
    PAGE_ROUTES,
    setsTab(async (p) => {
      await editIndicators(p);
      await p.getByRole("button", { name: "Add from recent tasks" }).click();
      const pop = p.getByRole("dialog", { name: "Add from recent tasks" });
      await pop.getByText("Retry the price feed on a timeout").waitFor();
      await pop.getByText("Add a stochastic oscillator").click();
      await pop.getByText("Add VWAP to the indicators list").click();
      await p.evaluate(() => document.activeElement?.blur());
    }),
  ),
  ...cmpBoard("Cmp-Start", withSets(START_ROUTES), startReady),
  ...cmpBoard("Set-StartSet", withSets(START_ROUTES), async (p) => {
    await startReady(p);
    await p.getByRole("radio", { name: "A task set" }).click();
    await p.getByRole("list", { name: "Tasks in Indicators" }).waitFor();
    await still(p);
  }),
  ...cmpBoard(
    "Set-Running",
    withSets(START_ROUTES, SETS, {
      [START_KEY]: { ...START_ROUTES[START_KEY], task_sets: SETS.map(refOf), latest: { id: SET_CMP, status: "running" } },
      [CMP_KEY(SET_CMP)]: SET_RUNNING,
    }),
    resultsReady("Tasks"),
    `${page}/${SET_CMP}`,
  ),
  ...cmpBoard(
    "Set-StopConfirm",
    withSets(START_ROUTES, SETS, {
      [START_KEY]: { ...START_ROUTES[START_KEY], task_sets: SETS.map(refOf), latest: { id: SET_CMP, status: "running" } },
      [CMP_KEY(SET_CMP)]: SET_RUNNING,
    }),
    async (p) => {
      await resultsReady("Tasks")(p);
      await p.getByRole("button", { name: "Stop compare" }).click();
      await p.getByRole("alertdialog", { name: "Stop this compare?" }).waitFor();
      await still(p);
    },
    `${page}/${SET_CMP}`,
  ),
  ...cmpBoard(
    "Set-Results",
    withSets(START_ROUTES, SETS, { [CMP_KEY(SET_CMP)]: SET_RESULTS }),
    resultsReady("Results"),
    `${page}/${SET_CMP}`,
  ),
  ...cmpBoard(
    "Cmp-Results",
    withSets(RESULTS_ROUTES, SETS, { [CMP_KEY("cmp-1")]: SAMPLE }),
    resultsReady("Results"),
    `${page}/cmp-1`,
  ),
  ...canvasBoard("Set-SaveCheck", saveRoutes, async (p) => {
    const dialog = await saveAs(p);
    await dialog.getByLabel("What changed (optional)").fill("Engineer on GPT-4.1; Reviewer names files");
    await p.evaluate(() => document.activeElement?.blur());
  }),
  ...canvasBoard("Set-CheckNotStarted", notStartedRoutes, async (p) => {
    const dialog = await saveAs(p);
    await dialog.getByRole("button", { name: "Save and run tests" }).click();
    await p.getByText(/The check on Indicators didn’t start/).waitFor();
    await p.getByText("saved just now").waitFor({ timeout: 5000 }).catch(() => {});
  }),
  // History as opened (the pills), then scrolled to the callout (`<board>-callout-web` / `-desktop`).
  ...canvasBoard("Set-Checked", (d) => historyRoutes(d, PASSED), history),
  ...canvasBoard("Set-CheckedWorse", (d) => historyRoutes(d, WORSE), history),
  ...canvasBoard("Set-Checked-callout", (d) => historyRoutes(d, PASSED), callout("v8 passed both checks")),
  ...canvasBoard(
    "Set-CheckedWorse-callout",
    (d) => historyRoutes(d, WORSE),
    callout("v8 did worse on Indicators"),
  ),
  // Kept elements (shot on main 699e453 and on m09-parity with this same file): the Compare tab's
  // start form and a one-task results page (the team has sets), History (v8 checked), Save as v8.
  ...kept("compare-start", cmpBoard("k", withSets(START_ROUTES), startReady)),
  ...kept(
    "compare-results",
    cmpBoard("k", withSets(RESULTS_ROUTES, SETS, { [CMP_KEY("cmp-1")]: SAMPLE }), resultsReady("Results"), `${page}/cmp-1`),
  ),
  ...kept("history", canvasBoard("k", (d) => historyRoutes(d, PASSED), history)),
  ...kept("saveas", canvasBoard("k", saveRoutes, saveAs)),
  // The same with M9's compare unticked (on main there is none): the primary reads as before M9.
  ...kept(
    "saveas-nocheck",
    canvasBoard("k", saveRoutes, async (p) => {
      const dialog = await saveAs(p);
      const box = dialog.getByText("Compare v8 with v7 on Indicators");
      if (await box.count()) await box.click();
      await dialog.getByRole("button", { name: "Save and run tests" }).waitFor();
    }),
  ),
];
