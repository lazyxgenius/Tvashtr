// M8 — Compare two versions (Quality › Cmp-Start, -Running, -Results, -OneVersion, -Queued, -NeedsYou,
// -SideFailed, -StopConfirm, -Versions) and the canvas toolbar's Compare (Team Setup › Ver-Draft, shot
// with versions.mjs's scenario). Every Cmp-* board is drawn in Desktop (the 30px title strip): the
// Desktop render is the comparison and the web render is framed 30px down (runs-live.mjs's `pair`,
// which also stops the clock at the boards' moment — the lanes' "6 s ago" line is 10:34:20).
// The sample data is the boards' (docs/superpowers/plans/api/compare.md's shapes): team "Indicator
// sprint team", v5 / v6 / v7, the task "Add an RSI indicator". `kept-m8-teamcanvas-*` capture the team
// canvas's (authoring) kept-elements inventory, website and Desktop (brief §2.2).
import { TEAM_ID, TEAM_NAME } from "./panel-fixtures.mjs";
import { clockAt } from "./runs-fixtures.mjs";
import { pair } from "./runs-live.mjs";
import versions, { canvasReady, teamRoutes } from "./versions.mjs";

const NOW = "10:34:26"; // the Editing line (10:34:20) reads "6 s ago"
const T = Date.parse(clockAt(NOW));
const before = (min) => new Date(T - min * 60_000).toISOString();
const DAY = 1440;
const CMP = "cmp-1";

// ---- The Compare tab (Cmp-Start, Cmp-Versions) ----
const v = (number, min, runs, summary, current = false) => ({
  number,
  when: before(min),
  runs,
  summary,
  current,
});
const VERSIONS = [
  v(7, 0.5, 1, "Reviewer: stricter about the INDICATORS registry", true),
  v(6, DAY + 60, 3, "Added the Spec approval gate"),
  v(5, 3 * DAY + 60, 2, "Engineer: model changed to xai/grok-4.7"),
];
const start = (latest = null) => ({
  team: { id: TEAM_ID, name: TEAM_NAME },
  versions: VERSIONS,
  defaults: { a: 6, b: 7 },
  changes: 1,
  target: { repo: "lazyxgenius/trade_mcp", base_ref: "main" },
  estimate: { cost_usd: 2.3, minutes: 25 },
  latest,
});
// Cmp-OneVersion: a team with v1 only (no run yet: no estimate).
const START_ONE = {
  ...start(),
  versions: [v(1, 0.5, 0, "The team’s first version", true)],
  defaults: { a: null, b: 1 },
  changes: 0,
  estimate: null,
};

// ---- A compare's lanes (Cmp-Running, -Queued, -NeedsYou, -StopConfirm) ----
const WHO = {
  "Product manager": "n-pm",
  Approval: "n-prd",
  Engineer: "n-eng",
  Reviewer: "n-rev",
  Run: null,
};
let seq = 0;
const L = (hms, label, kind, text, tone = "neutral", refs = {}) => ({
  id: `ev:${++seq}`,
  at: clockAt(hms),
  node_id: WHO[label],
  label,
  iteration: null,
  kind,
  text,
  tone,
  refs,
});
// The boards' "Editing core/indicators.py": the open step, its file set as code.
const editing = (hms) =>
  L(hms, "Engineer", "command", "Editing core/indicators.py", "neutral", {
    command: "core/indicators.py",
    running: true,
    started_at: clockAt(hms),
  });
const chip = (node_id, label, role_name, kind, state, loops_with = null) => ({
  node_id,
  label,
  kind,
  state,
  role_name,
  loops_with,
});
/** Product manager › Spec approval › Engineer ⇄ Reviewer › Ship, each chip in its state. */
const strip = (pm, gate, eng, rev, ship) => [
  chip("n-pm", "Product manager", "pm", "completion", pm),
  chip("n-prd", "Spec approval", "prd_gate", "gate", gate),
  chip("n-eng", "Engineer", "engineer", "agent", eng),
  chip("n-rev", "Reviewer", "reviewer", "agent", rev, "n-eng"),
  chip("n-ship", "Ship", "ship", "terminal", ship),
];
const side = (label, version, status, elapsed_s, cost_usd, over = {}) => ({
  label,
  version,
  run_id: `r-${label === "A" ? 21 : 22}`,
  number: label === "A" ? 21 : 22,
  status,
  elapsed_s,
  cost_usd,
  strip: strip("idle", "idle", "idle", "idle", "idle"),
  current: null,
  lines: [],
  gate_task_id: null,
  ...over,
});
const compare = (status, elapsed_s, cost_usd, sides, over = {}) => ({
  id: CMP,
  team_id: TEAM_ID,
  task: "Add an RSI indicator",
  auto_approve: true,
  status,
  elapsed_s,
  cost_usd,
  created_at: new Date(T - elapsed_s * 1000).toISOString(),
  ended_at: null,
  waiting: null,
  sides,
  results: null,
  ...over,
});

const RUNNING = compare("running", 1150, 2.02, [
  side("A", 6, "running", 1150, 1.1, {
    strip: strip("done", "done", "active", "done", "idle"),
    current: { label: "Engineer", text: "round 3" },
    lines: [
      L("10:31:40", "Reviewer", "verdict", "Round 2 · asked to register RSI on INDICATORS"),
      L("10:33:02", "Engineer", "read", "Round 3 · read the reviewer’s notes"),
      L("10:33:45", "Engineer", "retry", "Model busy. Tried again · 1 of 3", "warn"),
      editing("10:34:20"),
    ],
  }),
  side("B", 7, "finished", 962, 0.92, {
    strip: strip("done", "done", "done", "done", "idle"),
    current: { label: "Approved", text: "in round 2" },
    lines: [
      L("10:26:12", "Reviewer", "verdict", "Round 1 · asked to register RSI on INDICATORS"),
      L("10:29:30", "Engineer", "message", "Round 2 · registered RSI and fixed the default length"),
      L("10:31:02", "Reviewer", "verdict", "Round 2 · approved", "ok"),
      L("10:31:04", "Run", "done", "Finished · no pull request in a compare", "ok"),
    ],
  }),
]);
const QUEUED = compare(
  "waiting",
  0,
  0,
  [
    side("A", 6, "waiting", 0, 0, { run_id: null, number: null }),
    side("B", 7, "waiting", 0, 0, { run_id: null, number: null }),
  ],
  { waiting: { in_use: 3, limit: 3 } },
);
const NEEDS_YOU = compare(
  "running",
  760,
  0.75,
  [
    side("A", 6, "needs_you", 760, 0.14, {
      strip: strip("done", "waiting", "idle", "idle", "idle"),
      current: { label: "Spec approval", text: "waiting for you" },
      lines: [
        L("10:22:40", "Product manager", "read", "Read the task and the repo"),
        L("10:25:30", "Product manager", "wrote_doc", "Wrote the spec"),
        L("10:25:31", "Approval", "gate_waiting", "Waiting for you to approve the spec", "warn"),
      ],
      gate_task_id: 41,
    }),
    side("B", 7, "running", 760, 0.61, {
      strip: strip("done", "done", "active", "idle", "idle"),
      current: { label: "Engineer", text: "round 1" },
      lines: [
        L("10:24:50", "Product manager", "wrote_doc", "Wrote the spec"),
        L("10:26:10", "Approval", "gate_approved", "You approved the spec", "ok"),
        L("10:28:30", "Engineer", "read", "Round 1 · read the spec"),
        editing("10:34:20"),
      ],
    }),
  ],
  { auto_approve: false },
);

// ---- Results (Cmp-Results, Cmp-SideFailed): finished 2 minutes ago, $2.40 in all ----
const row = (key, label, a, b, better, difference) => ({ key, label, a, b, better, difference });
const done = (results, aStatus = "finished", bStatus = "finished") =>
  compare(
    "finished",
    1872,
    2.4,
    [
      side("A", 6, aStatus, 1872, 1.48, { strip: strip("done", "done", "done", "done", "idle") }),
      side("B", 7, bStatus, 962, 0.92, { strip: strip("done", "done", "done", "done", "idle") }),
    ],
    { ended_at: before(2.2), results },
  );
const RESULTS = done({
  headline: "v7 did better on this task",
  rows: [
    row("result", "Result", "Approved in round 4", "Approved in round 2", "b", "2 fewer rounds"),
    row("cost", "Cost", "$1.48", "$0.92", "b", "−$0.56"),
    row("time", "Time", "31m 12s", "16m 02s", "b", "−15m"),
    row("repo_tests", "Repo tests passing", "41 of 41", "41 of 41", null, "same"),
    row("agent_tests", "Reviewer’s tests", "4 of 6", "5 of 6", "b", "+1"),
    row("retries", "Retries and stalls", "2 retries", "none", "b", ""),
    row("files", "Files changed", "2", "2", null, ""),
  ],
  current_version: 7,
  restore: 6,
});
const SIDE_FAILED = done(
  {
    headline: "v6 finished; v7 failed on this task",
    rows: [
      row(
        "result",
        "Result",
        "Approved in round 4",
        "Failed: the Engineer stopped responding",
        "a",
        "—",
      ),
      row("cost", "Cost", "$1.48", "$0.92", null, "—"),
      row("time", "Time", "31m 12s", "16m 02s", null, "—"),
      row("repo_tests", "Repo tests passing", "41 of 41", "—", null, "—"),
      row("agent_tests", "Reviewer’s tests", "4 of 6", "5 of 6", "b", "+1"),
      row("retries", "Retries and stalls", "none", "1 stall", "a", ""),
      row("files", "Files changed", "2", "1", null, ""),
    ],
    current_version: 7,
    restore: 6,
  },
  "finished",
  "failed",
);

/** The compare page's API: the Compare tab, M6's recent tasks (the task box), the compare. */
const routes = (s, c = null) => ({
  [`GET /api/teams/${TEAM_ID}/compare`]: s,
  "GET /api/recent-tasks": {
    tasks: [{ task: "Add an RSI indicator", team: { id: TEAM_ID, name: TEAM_NAME } }],
  },
  ...(c ? { [`GET /api/compares/${CMP}`]: c } : {}),
});
const page = `/#/teams/${TEAM_ID}/compare`;
const still = async (p) => {
  await p.mouse.move(700, 880); // no hover state (the boards draw none)
  await p.waitForTimeout(250);
};
/** The start form, its task filled from the team's newest task. */
const startReady = async (p) => {
  await p.waitForFunction(() =>
    [...document.querySelectorAll("input")].some((i) => i.value === "Add an RSI indicator"),
  );
  await still(p);
};
const lanesReady = async (p) => {
  await p.getByRole("region", { name: "Version B" }).waitFor();
  await still(p);
};
const resultsReady = async (p) => {
  await p.getByRole("table", { name: "Results" }).waitFor();
  await still(p);
};
const live = (c) => ({
  path: `${page}/${CMP}`,
  routes: routes(start({ id: CMP, status: c.status }), c),
  now: NOW,
});

export default [
  ...pair("Cmp-Start", { path: page, routes: routes(start()), now: NOW, steps: startReady }),
  ...pair("Cmp-Running", { ...live(RUNNING), steps: lanesReady }),
  ...pair("Cmp-Results", { ...live(RESULTS), steps: resultsReady }),
  ...pair("Cmp-OneVersion", { path: page, routes: routes(START_ONE), now: NOW, steps: startReady }),
  ...pair("Cmp-Queued", { ...live(QUEUED), steps: lanesReady }),
  ...pair("Cmp-NeedsYou", { ...live(NEEDS_YOU), steps: lanesReady }),
  ...pair("Cmp-SideFailed", { ...live(SIDE_FAILED), steps: resultsReady }),
  ...pair("Cmp-StopConfirm", {
    ...live(RUNNING),
    steps: async (p) => {
      await lanesReady(p);
      await p.getByRole("button", { name: "Stop compare" }).click();
      await p.getByRole("alertdialog", { name: "Stop this compare?" }).waitFor();
      await still(p);
    },
  }),
  ...pair("Cmp-Versions", {
    path: `${page}?tab=versions`,
    routes: routes(start()),
    now: NOW,
    steps: async (p) => {
      await p.getByRole("button", { name: "Compare with v7" }).first().waitFor();
      await still(p);
    },
  }),
  // The toolbar's Compare: versions.mjs's Ver-Draft (the canvas with 2 changes, History open).
  ...versions.filter((s) => s.name === "Ver-Draft-web" || s.name === "Ver-Draft-desktop"),
  // Kept elements: the team canvas, authoring (the toolbar's every control), website and Desktop.
  {
    name: "kept-m8-teamcanvas-web",
    path: `/#/teams/${TEAM_ID}`,
    routes: teamRoutes(false),
    steps: canvasReady,
    settle: 600,
  },
  {
    name: "kept-m8-teamcanvas-desktop",
    path: `/#/teams/${TEAM_ID}`,
    routes: teamRoutes(true),
    desktop: true,
    init: 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");',
    steps: canvasReady,
    settle: 600,
  },
];
