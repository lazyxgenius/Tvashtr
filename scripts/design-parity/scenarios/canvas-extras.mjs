// M11 — Canvas extras (Team Setup › Cnv-FailPath, -FailPathOne, -TimeLimit, -Tidy, -Group,
// -GroupFolded, -TestAgent, -EditApprove, -EditApproved, -FailPathRun). Every board is drawn in
// Desktop (the 30px title strip): the Desktop render is the comparison and the web render is framed
// 30px down (versions.mjs's / runs-live.mjs's `pair`). The sample data is the boards'
// (docs/superpowers/plans/api/canvas-extras.md's shapes): team "Indicator sprint team" v7 (versions.mjs's
// canvas), the Engineer's failure path to the gate "Ask me what to do" (→ Stop) with a 10-minute time
// limit, the group "Review loop" (Engineer ⇄ Reviewer), the Reviewer's 6 tests, run #12 "Add an RSI
// indicator" at its spec gate (spec v2 → v3, the clock at 10:43:46: "Paused for you · 1m 40s") and
// run #12 having taken its failure path (the clock at 11:00:05, Prob-Failed's moment). Every state is
// reached through the UI: a click on a path (its "Use this path…" menu) › Time limit; Tidy, then the
// mouse on it (its tip); a selection box round the Engineer and the Reviewer › Group › the name typed
// (› Enter › Fold); the Reviewer's drawer › More actions; the waiting spec gate clicked › "20" edited ›
// Approve with my edits. `kept-m11-*` capture the kept-elements inventories of the screens M11 adds
// to (the team canvas, the node drawer with its More actions menu open, a run view at a spec gate),
// website and Desktop (brief §2.2).
import agentTests from "./agent-tests.mjs";
import { NODES, TEAM_ID } from "./panel-fixtures.mjs";
import { activityFor, boardRoutes, clockAt, frozenAt, runPath, RUN_ID } from "./runs-fixtures.mjs";
import { activityReady, pair as runPair } from "./runs-live.mjs";
import { canvasReady, pair, teamRoutes } from "./versions.mjs";

const GRAPH = `GET /api/teams/${TEAM_ID}/graph`;
const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
const still = async (page) => {
  await page.mouse.move(700, 880); // no hover state (the boards draw none)
  await page.waitForTimeout(250);
};

// ---- The boards' canvas, with the Engineer's failure path (Cnv-FailPath / -FailPathOne / -TimeLimit) ----
// "Ask me what to do" (Gate · retry or stop) → Stop, under the Engineer; the Engineer's time limit 10 min.
const ASK = {
  id: "n-ask",
  role_name: "gate",
  kind: "gate",
  model: null,
  engine: null,
  prompt: null,
  position: { x: 314, y: 300 },
  // The palette's Gate (routers.py: role "gate", gate kind "approval"), named as drawn.
  config: {
    gate_kind: "approval",
    title: "Ask me what to do",
    description: "Retry the Engineer or stop the run.",
  },
  last_run: null,
};
const STOP = { ...NODES.stop, position: { x: 520, y: 296 } };
const edge = (id, source, target, conditions = null, edge_type = "default") => ({
  id,
  source_node_id: source,
  target_node_id: target,
  edge_type,
  conditions,
});
const FAIL = edge("e-eng-ask", "n-eng", "n-ask", null, "failure");
const ASK_STOP = edge("e-ask-stop", "n-ask", "n-stop");

/** versions.mjs's canvas (`changes` since v7) with the graph changed by `nodes` / `edges`. */
function canvas(desktop, { changes = 0, nodes = (n) => n, edges = (e) => e, extra = {} } = {}) {
  const base = teamRoutes(desktop, changes);
  const g = base[GRAPH];
  return {
    ...base,
    [GRAPH]: { ...g, nodes: nodes(g.nodes), edges: edges(g.edges) },
    // Tidy saves positions; a group saves the team's layout (the server answers what it stored).
    [`POST /api/teams/${TEAM_ID}/positions`]: { ok: true },
    [`PUT /api/teams/${TEAM_ID}/layout`]: (req) => ({ json: req.postDataJSON() }),
    ...extra,
  };
}
const failCanvas = (desktop) =>
  canvas(desktop, {
    changes: 1,
    nodes: (ns) => [
      ...ns.map((n) =>
        n.id === "n-eng" ? { ...n, config: { ...n.config, time_limit_s: 600 } } : n,
      ),
      ASK,
      STOP,
    ],
    edges: (es) => [...es, FAIL, ASK_STOP],
  });
const canvasPair = (board, routes, steps, path = `/#/teams/${TEAM_ID}`) =>
  pair(board, { path, routes: routes(false), desktopRoutes: routes(true), steps });

/** Click a path a third of the way along (its label pill sits at the middle). */
async function clickPath(page, id) {
  const at = await page.evaluate((edgeId) => {
    const path = document.querySelector(
      `.react-flow__edge[data-id="${edgeId}"] .react-flow__edge-path`,
    );
    const p = path.getPointAtLength(path.getTotalLength() / 3);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  }, id);
  await page.mouse.click(at.x, at.y);
  await page.getByRole("menu", { name: "Use this path" }).waitFor();
}
const pathMenu = (id, then) => async (page) => {
  await canvasReady(page);
  await clickPath(page, id);
  await then?.(page);
  await still(page);
};

// ---- Cnv-Tidy: the five nodes where the board's dashed boxes are, before Tidy ----
const BEFORE = {
  "n-pm": { x: 76, y: 300 },
  "n-prd": { x: 299, y: 255 },
  "n-eng": { x: 478, y: 327 },
  "n-rev": { x: 808, y: 264 },
  "n-ship": { x: 1031, y: 193 },
};
const tidyCanvas = (desktop) =>
  canvas(desktop, {
    nodes: (ns) => ns.map((n) => (BEFORE[n.id] ? { ...n, position: BEFORE[n.id] } : n)),
  });
const arrange = (page) => page.getByRole("toolbar", { name: "Arrange" });

// ---- Cnv-Group / -GroupFolded: a selection box round the Engineer and the Reviewer › Group ----
async function selectLoop(page) {
  const eng = await page.locator('.react-flow__node[data-id="n-eng"]').boundingBox();
  const rev = await page.locator('.react-flow__node[data-id="n-rev"]').boundingBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(eng.x - 12, eng.y - 12);
  await page.mouse.down();
  await page.mouse.move(rev.x + rev.width + 12, rev.y + rev.height + 12, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
}
const nameGroup = async (page) => {
  await canvasReady(page);
  await selectLoop(page);
  await arrange(page).getByRole("button", { name: "Group" }).click();
  await page.getByRole("textbox", { name: "Group name" }).pressSequentially("Review loop");
};

// ---- Cnv-TestAgent: the Reviewer (6 tests) — agent-tests.mjs's canvas, its chip the count ----
const COUNT = { total: 6, passed: null, ran: null, running: null, stopped: false };
const testsCanvas = (desktop) => {
  const base = agentTests.find(
    (s) => s.name === `kept-m7-teamcanvas-${desktop ? "desktop" : "web"}`,
  ).routes;
  return {
    ...base,
    [GRAPH]: {
      ...base[GRAPH],
      nodes: base[GRAPH].nodes.map((n) => (n.id === "n-rev" ? { ...n, tests: COUNT } : n)),
    },
  };
};
const moreActions = async (page) => {
  await canvasReady(page);
  const drawer = page.getByRole("complementary", { name: "Reviewer settings" });
  await drawer.getByText("Tests").first().waitFor();
  await drawer.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).waitFor();
};

// ---- Run #12 at its spec gate (Cnv-EditApprove) and after Approve with my edits (Cnv-EditApproved) ----
const GATE_NOW = "10:43:46"; // "Paused for you · 1m 40s" after 10:42:06
const SPEC_V2 = [
  "# Add an RSI indicator",
  "",
  "## What to build",
  "",
  "- A function `rsi(prices, length)` in `core/indicators.py`",
  "- Default length: 20",
  "- Register it on `INDICATORS` so the builder lists it",
  "- Values always stay between 0 and 100",
  "",
  "## Tests",
  "",
  "- In `tests/test_indicators.py`: bounds, default length",
  "- The registry count goes from 28 to 29",
  "",
  "## Out of scope",
  "",
  "Drawing RSI on charts",
].join("\n");
const pmAuthor = { kind: "agent", node_id: "n-pm", role_name: "pm", label: "Product manager" };
const SPEC = {
  id: "d-spec",
  name: "spec",
  title: "Add an RSI indicator",
  doc_type: "prd",
  run_id: RUN_ID,
  is_shared_spec: true,
  editable: true,
  versions: [
    {
      id: "dv-1",
      version_no: 1,
      content: SPEC_V2.replace(" so the builder lists it", ""),
      created_at: clockAt("10:41:50"),
      author: pmAuthor,
      note: null,
    },
    {
      id: "dv-2",
      version_no: 2,
      content: SPEC_V2,
      created_at: clockAt("10:42:05"),
      author: pmAuthor,
      note: null,
    },
  ],
};
/** The spec gate's task, as the walk opens it (team_run.wait_at_gate: kind = the gate's kind). */
const SPEC_TASK = {
  id: 12,
  run_id: RUN_ID,
  kind: "prd_approval",
  priority: "high_blocker",
  blocking: true,
  topic: `gate:${RUN_ID}:n-prd`,
  title: "Approve the spec before the Engineer builds",
  description: "Read the spec, then approve or reject it.",
  status: "pending",
  resolution: null,
  resolution_note: null,
  created_at: clockAt("10:42:06"),
  resolved_at: null,
};
const RUN_KEY = `GET /api/runs/${RUN_ID}`;
const GRAPH_RUN = `GET /api/runs/${RUN_ID}/graph`;
const TASKS = `GET /api/runs/${RUN_ID}/tasks`;
const ACTIVITY = `GET /api/runs/${RUN_ID}/activity`;
const override = (agents, over) =>
  agents.map((a) => (over[a.node_id] ? { ...a, ...over[a.node_id] } : a));
const liveOf = (a) => ({
  live_state: a.live_state,
  last_event_at: a.last_event_at,
  activity: a.activity,
  activity_started_at: a.activity_started_at,
  retry: a.retry,
  backup_model: a.backup_model,
});

/** Live-NeedsYou's run #12, the gate's live line the server's ("Waiting for you"); after the POST
 *  (Approve with my edits) the gate is approved with spec v3 and the Engineer starts from it. */
function gateRoutes() {
  let approved = false;
  const base = boardRoutes("Live-NeedsYou");
  const waitingAct = activityFor("Live-NeedsYou");
  const gateWaiting = override(waitingAct.agents, {
    "n-prd": { activity: "Waiting for you", activity_started_at: clockAt("10:42:06") },
  });
  const gateLine = waitingAct.lines.find((l) => l.kind === "gate_waiting");
  const approvedAgents = override(gateWaiting, {
    "n-prd": {
      live_state: "done",
      activity: "Approved with your edits · spec v3",
      last_event_at: clockAt("10:42:06"),
      activity_started_at: clockAt("10:42:06"),
    },
    "n-eng": {
      live_state: "working",
      iteration: 1,
      activity: "Starting from spec v3",
      last_event_at: clockAt(GATE_NOW),
      activity_started_at: clockAt(GATE_NOW),
    },
  });
  const run = base[RUN_KEY];
  const graph = base[GRAPH_RUN];
  const withLive = (agents) => (n) => {
    const a = agents.find((x) => x.node_id === n.id);
    return a ? { ...n, live: liveOf(a) } : n;
  };
  const inv = (n, status, outcome, start, end = null) => ({
    invocation_id: n,
    iteration: 1,
    status,
    outcome,
    outcome_detail: null,
    context_manifest: null,
    cost: null,
    connectors: null,
    started_at: clockAt(start),
    ended_at: end ? clockAt(end) : null,
  });
  const graphAfter = {
    ...graph,
    live_state: "working",
    nodes: graph.nodes
      .map((n) =>
        n.id === "n-prd"
          ? { ...n, status: "done", invocations: [inv(2, "done", "approved", "10:42:06", "10:43:46")] }
          : n.id === "n-eng"
            ? { ...n, status: "running", iteration: 1, invocations: [inv(3, "running", null, GATE_NOW)] }
            : n,
      )
      .map(withLive(approvedAgents)),
  };
  return {
    ...base,
    [RUN_KEY]: () => ({
      json: approved
        ? {
            ...run,
            run: {
              ...run.run,
              status: "running",
              status_group: "running",
              live_state: "working",
              updated_at: clockAt(GATE_NOW),
            },
          }
        : run,
    }),
    [GRAPH_RUN]: () => ({
      json: approved
        ? graphAfter
        : { ...graph, nodes: graph.nodes.map(withLive(gateWaiting)) },
    }),
    [TASKS]: () => ({
      json: {
        run_id: RUN_ID,
        tasks: [
          approved
            ? { ...SPEC_TASK, status: "resolved", resolution: "approved", resolved_at: clockAt(GATE_NOW) }
            : SPEC_TASK,
        ],
      },
    }),
    [ACTIVITY]: () => ({
      json: approved
        ? {
            ...waitingAct,
            status: "running",
            live_state: "working",
            agents: approvedAgents,
            pinned: null,
            // The gate's open line folds into its approval (the board's 5 steps; Live-Working's rule).
            lines: waitingAct.lines.map((l) =>
              l === gateLine
                ? {
                    ...l,
                    kind: "gate_approved",
                    text: "Approved with your edits · spec v3",
                    tone: "ok",
                  }
                : l,
            ),
          }
        : { ...waitingAct, agents: gateWaiting, pinned: { ...waitingAct.pinned, task_id: 12 } },
    }),
    "GET /api/documents/d-spec": SPEC,
    [`POST /api/runs/${RUN_ID}/tasks/12/resolve`]: (req) => {
      approved = req.postDataJSON().decision === "approve";
      return {
        json: { run_id: RUN_ID, task_id: 12, decision: "approve", resolution: "approved" },
      };
    },
  };
}

/** The spec drawer, opened from the waiting gate, with "20" edited to "14, the usual default". */
async function editSpec(page) {
  await activityReady(page);
  await page.locator('.react-flow__node[data-id="n-prd"]').click();
  const drawer = page.getByRole("complementary", { name: "Spec v2" });
  await drawer.waitFor();
  await drawer.locator(".ProseMirror").getByText("Default length: 20").waitFor();
  const at = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf("Default length: 20");
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + 16);
      r.setEnd(n, i + 18);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
  });
  await page.mouse.dblclick(at.x, at.y);
  await page.keyboard.type("14, the usual default");
  await drawer.getByText("1 edit").waitFor();
  return drawer;
}

/** A board that changes state through the UI: its own routes per render (web, Desktop). */
const fresh = (board, make, opts) => [
  runPair(board, { ...opts, routes: make() })[0],
  runPair(board, { ...opts, routes: make() })[1],
];

// ---- Cnv-FailPathRun: run #12's Engineer failed in round 2 and the run took its failure path ----
const FAIL_NOW = "11:00:05"; // Prob-Failed's moment: "18m 03s", the Engineer "1m ago"
const ASK_TASK = {
  id: 13,
  run_id: RUN_ID,
  kind: "approval",
  priority: "high_blocker",
  blocking: true,
  topic: `gate:${RUN_ID}:n-ask`,
  title: "Ask me what to do",
  description: "Retry the Engineer or stop the run.",
  status: "pending",
  resolution: null,
  resolution_note: null,
  created_at: clockAt("10:59:06"),
  resolved_at: null,
};
function failRoutes() {
  const base = boardRoutes("Prob-Failed");
  const act = activityFor("Prob-Failed");
  const run = base[RUN_KEY];
  const graph = base[GRAPH_RUN];
  const askLive = {
    live_state: "needs_you",
    last_event_at: clockAt("10:59:06"),
    activity: "Waiting for you",
    activity_started_at: clockAt("10:59:06"),
    retry: null,
    backup_model: null,
  };
  const line = (id, hms, node_id, label, kind, text, tone, refs = {}) => ({
    id,
    at: clockAt(hms),
    node_id,
    label,
    iteration: null,
    kind,
    text,
    tone,
    refs,
  });
  // The board's 27 steps: Prob-Failed's, its closing Run line replaced by the failure path's two.
  const lines = [
    ...act.lines.slice(1, -1),
    line(
      "ev:path",
      "10:59:05",
      null,
      "Run",
      "failure_path",
      "The Engineer failed, so the run takes its failure path to Ask me what to do",
      "neutral",
    ),
    line(
      "task:13:open",
      "10:59:06",
      "n-ask",
      "Ask me what to do",
      "gate_waiting",
      "Waiting for you: retry the Engineer or stop the run",
      "neutral",
      { task_id: 13, title: "Ask me what to do" },
    ),
  ];
  return {
    ...base,
    [RUN_KEY]: {
      ...run,
      workflow_status: "PENDING",
      run: {
        ...run.run,
        status: "awaiting_human",
        status_group: "needs_you",
        live_state: "needs_you",
      },
    },
    [GRAPH_RUN]: {
      ...graph,
      live_state: "needs_you",
      nodes: [
        ...graph.nodes,
        {
          ...ASK,
          position: { x: 500, y: 330 },
          origin_node_id: ASK.id,
          status: "running",
          iteration: 1,
          invocations: [],
          live: askLive,
        },
      ],
      edges: [...graph.edges, FAIL, ASK_STOP],
    },
    [TASKS]: { run_id: RUN_ID, tasks: [ASK_TASK] },
    [ACTIVITY]: {
      ...act,
      status: "awaiting_human",
      live_state: "needs_you",
      cursor: `${clockAt("10:59:06")}|task:13:open`,
      total: 27,
      lines,
      agents: [
        ...act.agents,
        {
          node_id: "n-ask",
          origin_node_id: "n-ask",
          label: "Ask me what to do",
          kind: "gate",
          iteration: 1,
          rounds_limit: null,
          ...askLive,
          model: null,
        },
      ],
      // The server's callout for an open gate (activity.py: any gate but the spec's says its own
      // description).
      pinned: {
        kind: "gate",
        node_id: "n-ask",
        label: "Ask me what to do",
        title: "The ask me what to do gate is waiting for you",
        body: ASK_TASK.description,
        task_id: 13,
        gate_kind: "approval",
      },
    },
  };
}

/** A screen's kept-elements inventory, website and Desktop (run with INVENTORY=1), unframed. */
const kept = (name, { path, routes, now, steps }) => [
  {
    name: `kept-m11-${name}-web`,
    path,
    routes: routes(false),
    init: now ? frozenAt(now) : "",
    steps,
    settle: 900,
  },
  {
    name: `kept-m11-${name}-desktop`,
    path,
    routes: routes(true),
    desktop: true,
    init: now ? frozenAt(now, SEEN) : SEEN,
    steps,
    settle: 900,
  },
];

export default [
  ...canvasPair("Cnv-FailPath", failCanvas, pathMenu("e-eng-ask")),
  ...canvasPair("Cnv-FailPathOne", failCanvas, pathMenu("e-eng-rev")),
  ...canvasPair(
    "Cnv-TimeLimit",
    failCanvas,
    pathMenu("e-eng-ask", async (page) => {
      await page.getByRole("menuitem", { name: /^Time limit/ }).click();
      await page.getByRole("menu", { name: "Time limit" }).waitFor();
    }),
  ),
  ...canvasPair("Cnv-Tidy", tidyCanvas, async (page) => {
    await canvasReady(page);
    const tidy = arrange(page).getByRole("button", { name: "Tidy" });
    await tidy.click();
    await page.getByText("Tidied the layout").waitFor();
    await tidy.hover(); // its tip, as drawn
    await page.waitForTimeout(250);
  }),
  ...canvasPair("Cnv-Group", canvas, async (page) => {
    await nameGroup(page);
    await page.waitForTimeout(250);
  }),
  ...canvasPair("Cnv-GroupFolded", canvas, async (page) => {
    await nameGroup(page);
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Fold Review loop" }).click();
    await page.getByRole("group", { name: "Review loop, folded" }).waitFor();
    await still(page);
  }),
  ...canvasPair(
    "Cnv-TestAgent",
    testsCanvas,
    async (page) => {
      await moreActions(page);
      await page.getByRole("menuitem", { name: /^Test this agent/ }).hover(); // the board's lit row
      await page.waitForTimeout(250);
    },
    `/#/teams/${TEAM_ID}?node=n-rev`,
  ),
  ...fresh("Cnv-EditApprove", gateRoutes, {
    now: GATE_NOW,
    steps: async (page) => {
      await editSpec(page);
      await still(page);
    },
  }),
  // The same with the Activity hidden: the drawer docks in the canvas's area, so here it runs to the
  // window's foot as the board draws it and the whole spec is in view (measured against the board).
  ...fresh("Cnv-EditApprove", gateRoutes, {
    now: GATE_NOW,
    steps: async (page) => {
      await editSpec(page);
      await page.getByRole("button", { name: "Hide activity" }).click();
      await page.locator(".lv-act--folded").waitFor();
      await still(page);
    },
  }).map((s) => ({ ...s, name: s.name.replace("Cnv-EditApprove", "Cnv-EditApprove-spec") })),
  ...fresh("Cnv-EditApproved", gateRoutes, {
    now: GATE_NOW,
    steps: async (page) => {
      const drawer = await editSpec(page);
      await drawer.getByRole("button", { name: "Approve with my edits" }).click();
      await drawer.waitFor({ state: "detached" });
      await page.getByText("Approved with your edits · spec v3").first().waitFor();
      await still(page);
    },
  }),
  ...runPair("Cnv-FailPathRun", {
    now: FAIL_NOW,
    routes: failRoutes(),
    steps: async (page) => {
      await activityReady(page);
      await still(page);
    },
  }),
  // Kept elements: the same fixtures, no menu, no hover, no drawer (but the node drawer's).
  ...kept("canvas", {
    path: `/#/teams/${TEAM_ID}`,
    routes: failCanvas,
    steps: async (page) => {
      await canvasReady(page);
      await still(page);
    },
  }),
  // The toolbar's kept "Add to canvas" with every add option (the boards' "+ Add agent" ruling).
  ...kept("canvas-add", {
    path: `/#/teams/${TEAM_ID}`,
    routes: failCanvas,
    steps: async (page) => {
      await canvasReady(page);
      // It opens on hover (a click toggles it), and closes when the mouse leaves.
      await page.getByRole("button", { name: "Add to canvas" }).hover();
      await page.getByRole("menu", { name: "Add to canvas" }).waitFor();
    },
  }),
  ...kept("drawer", {
    path: `/#/teams/${TEAM_ID}?node=n-rev`,
    routes: testsCanvas,
    steps: async (page) => {
      await moreActions(page);
      await still(page);
    },
  }),
  ...kept("specgate", {
    path: runPath(),
    routes: () => gateRoutes(),
    now: GATE_NOW,
    steps: async (page) => {
      await activityReady(page);
      await still(page);
    },
  }),
];
