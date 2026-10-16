// M-desk-6 — the Tests pass check (Runs › Live-TestsFailed[Desktop], Live-TestsPassed[Desktop],
// Live-TestsCouldnt[Desktop]; Team Setup › Chk-TestsPass) and two run-view fixes (Runs ›
// Live-ChangesNotPushed[Desktop], Live-DoneDesktopLong). Run #12 "Add an RSI indicator" is the
// fixtures' run (runs-fixtures.mjs); its team here has the boards' Tests pass gate `n-chk` between
// the Engineer and the Reviewer (a failed check back to the Engineer), and no Stop or Escalation
// gate, as drawn. The check's lines and agent entry are the server's (control_plane/activity.py
// `_check_line`: a line per visit at its start, the agent's activity its last line). Each Runs board
// renders as a website and a Desktop render (runs-live.mjs's `pair`); the ended runs' Desktop reads
// are M-desk-4's (desk4.mjs: where the work ran). Every state is reached through the UI: a check's
// Show output, the Engineer's drawer › Changes, the gate's Command typed in its drawer.
import desk4 from "./desk4.mjs";
import { DOCS } from "./panel-runs-docs.mjs";
import { TEAM_ID } from "./panel-fixtures.mjs";
import {
  activityFor,
  boardNow,
  boardRoutes,
  clockAt,
  RUN_ID,
  runPath,
} from "./runs-fixtures.mjs";
import { activityReady, pair } from "./runs-live.mjs";
import startFrom from "./start-from.mjs";
import { canvasReady, pair as teamPair, teamRoutes } from "./versions.mjs";

const RUN = `GET /api/runs/${RUN_ID}`;
const GRAPH = `${RUN}/graph`;
const ACTIVITY = `${RUN}/activity`;
const CMD = "pip install -r requirements.txt && pytest -q";
const clone = (v) => JSON.parse(JSON.stringify(v));
const before = (hms, s) =>
  new Date(Date.parse(clockAt(hms)) - s * 1000).toISOString();
const routesOf = (list, name) => list.find((s) => s.name === name).routes;

/** `routes[key]` answered as `edit(its body)`, for every read (desk4.mjs's `desk` edits only the
 *  Desktop's). */
const patch = (routes, key, edit) => {
  const base = routes[key];
  return {
    ...routes,
    [key]: async (req) => {
      const r = typeof base === "function" ? await base(req) : { json: base };
      return { ...r, json: edit(clone(r.json)) };
    },
  };
};
/** The run graph's first read answers after the Activity's: the canvas fits its view once, when the
 *  graph lands, and a fit before the Activity panel is up frames a taller pane (the nodes sit low). */
const graphLast = (routes, key = GRAPH) => {
  let first = true;
  return {
    ...routes,
    [key]: async (req) => {
      if (first) await new Promise((done) => setTimeout(done, 400));
      first = false;
      const v = routes[key];
      return typeof v === "function" ? v(req) : { json: v };
    },
  };
};
const still = async (page) => {
  await page.mouse.move(700, 880); // no hover state (the boards draw none)
  await page.waitForTimeout(250);
};

// ---- The team: … → Engineer → Tests pass → Reviewer → Ship (the boards' layout) ----
const CHK = {
  id: "n-chk",
  role_name: "gate",
  kind: "gate",
  model: null,
  engine: null,
  prompt: null,
  position: { x: 680, y: 100 },
  config: { gate_kind: "tests_pass", title: "", description: "", command: CMD },
  last_run: null,
};
const edge = (id, source_node_id, target_node_id, conditions = null) => ({
  id,
  source_node_id,
  target_node_id,
  edge_type: "default",
  conditions,
});
/** Engineer → Tests pass → Reviewer in place of Engineer → Reviewer; no Stop or Escalation. */
const checkEdges = (edges) => [
  ...edges.filter(
    (e) =>
      e.id !== "e-eng-rev" &&
      ![e.source_node_id, e.target_node_id].some(
        (n) => n === "n-stop" || n === "n-esc",
      ),
  ),
  edge("e-eng-chk", "n-eng", "n-chk"),
  edge("e-chk-rev", "n-chk", "n-rev", { when: "approved" }),
  edge("e-chk-eng", "n-chk", "n-eng", { loop_limit: 3 }),
];

// ---- The run: its agents with the check's entry, and the run graph they live on ----
const POS = {
  "n-pm": [36, 60],
  "n-prd": [272, 100],
  "n-eng": [468, 60],
  "n-chk": [716, 100],
  "n-rev": [902, 60],
  "n-ship": [1172, 92],
};
const BUSY = [
  "working",
  "running_command",
  "needs_you",
  "retrying",
  "quiet",
  "stalled",
];
const liveOf = (a) => ({
  live_state: a.live_state,
  last_event_at: a.last_event_at,
  activity: a.activity,
  activity_started_at: a.activity_started_at,
  retry: a.retry,
  backup_model: a.backup_model,
});
/** An agent's fields at a moment: its state, what it did and when (clock times). */
const doing = (live_state, activity, hms, iteration) => ({
  live_state,
  activity,
  last_event_at: hms ? clockAt(hms) : null,
  activity_started_at: hms ? clockAt(hms) : null,
  iteration,
});
/** A node's round (`invocations[]`), clock times. */
const round = (id, iteration, status, outcome, start, end = null) => ({
  invocation_id: id,
  iteration,
  status,
  outcome,
  outcome_detail: null,
  context_manifest: null,
  cost: null,
  connectors: null,
  started_at: clockAt(start),
  ended_at: end && clockAt(end),
});
/** The Activity reply's agents: the check's entry (the spec gate's shape) after the Engineer's,
 *  `over` merged per node; no Stop or Escalation. */
const checkAgents = (agents, over) => {
  const gate = agents.find((a) => a.node_id === "n-prd");
  return agents
    .filter((a) => POS[a.node_id])
    .flatMap((a) =>
      a.node_id === "n-eng"
        ? [
            a,
            {
              ...gate,
              node_id: "n-chk",
              origin_node_id: "n-chk",
              label: "Tests pass",
            },
          ]
        : [a],
    )
    .map((a) => ({ ...a, ...over[a.node_id] }));
};
/** The run graph with the check, each node's state and live block its agent's. */
const checkGraph = (graph, agents, invocations = {}) => ({
  ...graph,
  nodes: [
    ...graph.nodes.filter((n) => POS[n.id]),
    { ...CHK, origin_node_id: CHK.id, invocations: [] },
  ].map((n) => {
    const a = agents.find((x) => x.node_id === n.id);
    const status =
      a.live_state === "failed"
        ? "failed"
        : BUSY.includes(a.live_state)
          ? "running"
          : a.live_state === "done" || a.iteration > 0
            ? "done"
            : "idle";
    const [x, y] = POS[n.id];
    return {
      ...n,
      position: { x, y },
      status,
      iteration: a.iteration,
      invocations: invocations[n.id] ?? n.invocations,
      live: liveOf(a),
    };
  }),
  edges: checkEdges(graph.edges),
});
/** `routes` with the check in the team: the agents edited by `over`, the graph to match. */
const withCheck = (routes, board, over, invocations) => {
  const agents = checkAgents(activityFor(board).agents, over);
  return patch(
    patch(routes, ACTIVITY, (a) => ({ ...a, agents })),
    GRAPH,
    (g) => checkGraph(g, agents, invocations),
  );
};

// ---- The check's lines (inv:<n>:check, at the visit's start) ----
const FAILED_TAIL = [
  "....................F......................                              [100%]",
  "=================================== FAILURES ===================================",
  "_____________________ TestRsi.test_matches_the_reference ______________________",
  "    def test_matches_the_reference(self):",
  '        closes = load_closes("tests/data/aapl.csv")',
  ">       assert rsi(closes, 14)[-1] == pytest.approx(58.31, rel=1e-3)",
  "E       assert 61.07 == 58.31 ± 5.8e-02",
  "tests/test_indicators.py:212: AssertionError",
  "=========================== short test summary info ============================",
  "FAILED tests/test_indicators.py::TestRsi::test_matches_the_reference",
  "1 failed, 42 passed in 6.3s",
  "=============================== 1 warning in 6.3s ==============================",
];
const check = (inv, hms, iteration, tone, text, refs) => ({
  id: `inv:${inv}:check`,
  at: clockAt(hms),
  node_id: "n-chk",
  label: "Tests pass",
  iteration,
  kind: "check",
  tone,
  text,
  refs: { running: false, started_at: clockAt(hms), ...refs },
});
const RUNNING = "Running the tests…";
const FAILED = "Tests failed — back to Engineer with the last 12 lines";
const COULDNT = "Couldn’t run the tests — passed on without a result";
const PASSED = "Tests passed · 42 passed in 6.1s";
const edited = (id, hms, iteration) => ({
  id,
  at: clockAt(hms),
  node_id: "n-eng",
  label: "Engineer",
  iteration,
  kind: "edited",
  tone: "neutral",
  text: "Edited core/indicators.py",
  refs: { file: "core/indicators.py", added: 48, removed: 3 },
});
/** The `n` steps before `hms` (Live-Done's story; its plain "Read the task" further back when the
 *  story is short — runs-fixtures.mjs's `withEarlier` rule), then `shown`. */
const story = (n, hms, shown) => {
  const done = activityFor("Live-Done").lines;
  const kept = done
    .filter((l) => Date.parse(l.at) < Date.parse(clockAt(hms)))
    .slice(-n);
  const pad = Array.from({ length: n - kept.length }, (_, i) => ({
    ...done[0],
    id: `ev:pad:${i}`,
    at: before("10:41:01", n - kept.length - i),
  }));
  return [...pad, ...kept, ...shown];
};

// ---- Live-TestsFailed: round 2, the check sent the Engineer back; the tests run again ----
const LIVE_RUN = (now) => (r) => ({
  ...r,
  workflow_status: "PENDING",
  run: {
    ...r.run,
    created_at: before(now, 258), // "4m 18s"
    updated_at: clockAt(now),
    cost_total_usd: 0.38,
    spent_usd: 0.38,
  },
});
/** A live run (Live-Working's reads) at `now`: its run, agents and lines. */
const liveRoutes = (now, over, invocations, lines) =>
  patch(
    patch(
      withCheck(boardRoutes("Live-Working"), "Live-Working", over, invocations),
      RUN,
      LIVE_RUN(now),
    ),
    ACTIVITY,
    (a) => ({
      ...a,
      status: "running",
      live_state: "working",
      cursor: `${clockAt(now)}|${lines.at(-1).id}`,
      total: lines.length,
      lines,
      pinned: null,
      summary: null,
    }),
  );
const FAILED_NOW = "11:00:52"; // "live · 6 s" after 11:00:46
const failedRoutes = liveRoutes(
  FAILED_NOW,
  {
    "n-pm": doing("done", "Wrote the spec (v2)", "10:57:52", 1),
    "n-prd": doing("done", "You approved", "10:43:10", 1),
    "n-eng": doing(
      "done",
      "Round 2 · edited core/indicators.py",
      "11:00:40",
      2,
    ),
    "n-chk": doing("working", RUNNING, "11:00:46", 2),
    "n-rev": doing("waiting", null, null, 0),
  },
  {
    "n-eng": [
      round(3, 1, "done", "built", "10:43:12", "10:57:50"),
      round(7, 2, "done", "built", "10:58:20", "11:00:42"),
    ],
    "n-chk": [
      round(6, 1, "done", "rejected", "10:58:02", "10:58:10"),
      round(8, 2, "running", null, "11:00:46"),
    ],
  },
  story(18, "10:46:00", [
    check(6, "10:58:02", 1, "danger", FAILED, {
      result: "failed",
      output_tail: FAILED_TAIL,
      passed: 42,
      failed: 1,
    }),
    edited("ev:50", "11:00:40", 2),
    check(8, "11:00:46", 2, "neutral", RUNNING, {
      running: true,
      result: "running",
    }),
  ]),
);

/** Open the check's output (its line's Show output), the list at its live end. */
const showCheckOutput = (text) => async (page) => {
  await activityReady(page);
  await page
    .locator("li.lv-line", { hasText: text })
    .getByRole("button", { name: "Show output" })
    .evaluate((el) => el.click()); // a real click scrolls the canvas pane to bring it into view
  await page
    .locator(".lv-act__list")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  await still(page);
};

// ---- Live-TestsCouldnt: round 1, the sandbox failed; the Reviewer reads on without a result ----
const COULDNT_NOW = "11:02:24"; // the Reviewer's line 4 s old
const couldntRoutes = liveRoutes(
  COULDNT_NOW,
  {
    "n-pm": doing("done", "Wrote the spec (v2)", "10:59:24", 1),
    "n-prd": doing("done", "You approved", "10:43:10", 1),
    "n-eng": doing(
      "done",
      "Round 1 · edited core/indicators.py",
      "11:00:58",
      1,
    ),
    "n-chk": doing("done", COULDNT, "11:01:41", 1),
    "n-rev": doing("working", "Reading core/indicators.py", "11:02:20", 1),
  },
  {
    "n-eng": [round(3, 1, "done", "built", "10:43:12", "11:01:00")],
    "n-chk": [round(6, 1, "done", "approved", "11:01:41", "11:01:58")],
    "n-rev": [round(7, 1, "running", null, "11:02:02")],
  },
  story(16, "10:46:00", [
    edited("ev:50", "11:00:58", 1),
    check(6, "11:01:41", 1, "warn", COULDNT, {
      result: "skipped",
      output_tail: [
        "Couldn't run the tests: the sandbox failed (RuntimeError).",
      ],
    }),
    {
      id: "ev:51",
      at: clockAt("11:02:20"),
      node_id: "n-rev",
      label: "Reviewer",
      iteration: 1,
      kind: "read",
      tone: "neutral",
      text: "Read core/indicators.py",
      refs: { files: ["core/indicators.py"] },
    },
  ]),
);

// ---- Live-TestsPassed: Live-Done with the check passing before the Reviewer's round 3 ----
const DONE_DESKTOP = routesOf(desk4, "Live-DoneDesktop-desktop");
const NEXT = routesOf(startFrom, "Next-Finished-web")[`${RUN}/next`];
const doneCheck = (routes) =>
  withCheck(routes, "Live-Done", {
    "n-chk": doing("done", PASSED, "11:01:41", 3),
  });
const passedRoutes = patch(
  patch(doneCheck({ ...DONE_DESKTOP, [`${RUN}/next`]: NEXT }), RUN, (r) => ({
    ...r,
    run: { ...r.run, cost_total_usd: 0.42, spent_usd: 0.42 },
  })),
  ACTIVITY,
  (a) => {
    const lines = a.lines.flatMap((l) => {
      if (l.kind === "verdict" && l.iteration === 3)
        return [
          {
            ...l,
            text: "Approved — RSI is registered, bounded 0–100, and the tests Tvashtr ran passed (42 passed)",
          },
        ];
      if (l.kind === "done")
        return [{ ...l, text: l.text.replace("$1.12", "$0.42") }];
      // The check passed before the Reviewer's round 3 began (its start line now after it).
      if (l.kind === "started" && l.node_id === "n-rev" && l.iteration === 3)
        return [
          check(9, "11:01:41", 3, "ok", PASSED, {
            result: "passed",
            passed: 42,
            failed: 0,
          }),
          { ...l, at: clockAt("11:01:50") },
        ];
      return [l];
    });
    return {
      ...a,
      lines,
      total: lines.length,
      settled: true,
      summary: {
        ...a.summary,
        tests_passed: 42,
        cost_usd: a.ran_on ? a.summary.cost_usd : 0.42,
      },
    };
  },
);

// ---- Live-ChangesNotPushed: Prob-Failed's run (GitHub), the Engineer's drawer › Changes ----
const FAILED_DESKTOP = routesOf(desk4, "Prob-FailedDesktop-desktop");
const notPushedRoutes = patch(
  patch(
    patch(FAILED_DESKTOP, ACTIVITY, (a) => ({ ...a, settled: true })),
    RUN,
    (r) => ({ ...r, run: { ...r.run, cost_total_usd: 0.42, spent_usd: 0.42 } }),
  ),
  GRAPH,
  (g) => ({
    ...g,
    nodes: g.nodes.map((n) =>
      n.id === "n-eng"
        ? {
            ...n,
            invocations: n.invocations.map((inv) =>
              inv.iteration === 2
                ? {
                    ...inv,
                    started_at: before("10:59:05", 257), // "failed after 4m 17s"
                    outcome_detail:
                      "Failed after 4m 17s on your Claude subscription.",
                  }
                : inv,
            ),
          }
        : n,
    ),
  }),
);
const NOT_PUSHED = {
  ...notPushedRoutes,
  [`${RUN}/diff`]: {
    run_id: RUN_ID,
    base_ref: "main",
    ship_branch: null,
    files: [],
    total: 0,
    not_pushed: true,
  },
};
/** The Engineer's drawer opens on Runs; pick its Changes tool, Activity folded as drawn. */
const notPushed = async (page) => {
  await activityReady(page);
  await page.getByRole("button", { name: "Hide activity" }).click();
  await page
    .getByRole("group", { name: "Run tools" })
    .getByRole("button", { name: "Changes" })
    .click();
  await page
    .getByText("This run stopped before it pushed its changes")
    .waitFor();
  await still(page);
};

// ---- Live-DoneDesktopLong (S1): the Done view at 1440×900 with long real content ----
const LONG_ID = "86bff6c6-b372-417f-9914-2788f95bf1c0";
const BRANCH = `tvashtr/${LONG_ID}`;
const PR53 = "https://github.com/lazyxgenius/trade_mcp/pull/53";
const longRoutes = (() => {
  let r = { ...DONE_DESKTOP, [`${RUN}/next`]: NEXT };
  r = patch(r, RUN, (x) => ({
    ...x,
    run: {
      ...x.run,
      idea: "Add a Hull moving average indicator",
      pr_url: PR53,
      ship_branch: BRANCH,
      team_version_number: 1,
    },
  }));
  r = patch(r, GRAPH, (g) => ({
    ...g,
    resolution_warnings: [
      {
        source_kind: "desktop_tools",
        name: "1 library tool(s)",
        reason:
          "tools aren't used by Desktop subscription agents yet — this agent ran without them",
      },
    ],
  }));
  r = patch(r, ACTIVITY, (a) => ({
    ...a,
    settled: true,
    lines: a.lines.map((l) =>
      l.kind === "pr"
        ? {
            ...l,
            text: `Pushed branch ${BRANCH} and opened pull request #53`,
            refs: { pr_url: PR53, pr_number: 53, branch: BRANCH },
          }
        : l.kind === "done"
          ? {
              ...l,
              text: l.text.replace("22m 38s", "37m 16s"),
              refs: { ...l.refs, elapsed_s: 2236 },
            }
          : l,
    ),
    summary: {
      ...a.summary,
      branch: BRANCH,
      pr_number: 53,
      pr_url: PR53,
      tests_passed: null,
      elapsed_s: 2236,
    },
  }));
  r = patch(r, `${RUN}/next`, (n) => ({
    ...n,
    pr: { ...n.pr, number: 53, branch: BRANCH },
  }));
  r[`${RUN}/documents`] = {
    ...DOCS,
    run_id: RUN_ID,
    documents: DOCS.documents.slice(0, 1),
  };
  // Run #12 under the board's run id ("run 86bff6c6").
  const rename = (v) =>
    JSON.parse(JSON.stringify(v).replaceAll(`"${RUN_ID}"`, `"${LONG_ID}"`));
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [
      k.replace(`/runs/${RUN_ID}`, `/runs/${LONG_ID}`),
      typeof v === "function"
        ? async (req) => {
            const x = await v(req);
            return { ...x, json: rename(x.json) };
          }
        : rename(v),
    ]),
  );
})();

// ---- Chk-TestsPass: the team canvas with the gate, its drawer open, the Command typed ----
/** versions.mjs's canvas with the check (its saved command the short one: the board's is typed). */
const chkCanvas = (desktop) => {
  const base = teamRoutes(desktop);
  const key = `GET /api/teams/${TEAM_ID}/graph`;
  const g = base[key];
  const at = { "n-rev": { x: 848, y: 60 }, "n-ship": { x: 914, y: 236 } };
  return {
    ...base,
    [key]: {
      ...g,
      nodes: [
        ...g.nodes.map((n) => (at[n.id] ? { ...n, position: at[n.id] } : n)),
        { ...CHK, config: { ...CHK.config, command: "pytest -q" } },
      ],
      edges: checkEdges(g.edges),
    },
  };
};

/** `<name>Desktop` (drawn in Desktop) against its Desktop render, and `<name>` (the website)
 *  against its unframed web render (desk5.mjs's convention). */
const boardPair = (name, opts) => {
  const o = { ...opts, routes: graphLast(opts.routes) };
  return [
    pair(`${name}Desktop`, o)[1],
    pair(name, { ...o, desktopBoard: false })[0],
  ];
};
const doneSteps = async (page) => {
  await activityReady(page);
  await still(page);
};
const [, longDesktop] = pair("Live-DoneDesktopLong", {
  path: `/#/teams/${TEAM_ID}/runs/${LONG_ID}`,
  routes: graphLast(longRoutes, `GET /api/runs/${LONG_ID}/graph`),
  now: boardNow("Live-Done"),
  steps: doneSteps,
});
const [, chkDesktop] = teamPair("Chk-TestsPass", {
  path: `/#/teams/${TEAM_ID}?node=n-chk`,
  routes: chkCanvas(false),
  desktopRoutes: chkCanvas(true),
  steps: async (page) => {
    await canvasReady(page);
    const command = page.getByRole("textbox", { name: "Command" });
    await command.fill(CMD);
    await page.getByText("Unsaved changes").waitFor({ state: "attached" });
    await command.evaluate((el) => {
      el.scrollLeft = 0;
      el.blur();
    });
    await still(page);
  },
});

export default [
  ...boardPair("Live-TestsFailed", {
    routes: failedRoutes,
    now: FAILED_NOW,
    steps: showCheckOutput(FAILED),
  }),
  ...boardPair("Live-TestsPassed", {
    routes: passedRoutes,
    now: boardNow("Live-Done"),
    steps: doneSteps,
  }),
  ...boardPair("Live-TestsCouldnt", {
    routes: couldntRoutes,
    now: COULDNT_NOW,
    steps: showCheckOutput(COULDNT),
  }),
  ...boardPair("Live-ChangesNotPushed", {
    path: runPath("n-eng"),
    routes: NOT_PUSHED,
    now: boardNow("Prob-Failed"),
    steps: notPushed,
  }),
  longDesktop,
  chkDesktop,
];
