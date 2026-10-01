// M2 run view fixtures — the boards' one story: team "Indicator sprint team" (Product manager →
// Spec approval gate → Engineer ⇄ Reviewer, up to 3 rounds → Ship), task "Add an RSI indicator",
// repo lazyxgenius/trade_mcp, run #12. Each Runs › Live-* board is one `state` of this run.
import { EDGES, NODES, TEAM_ID, TEAM_NAME, ago, now, panelRoutes } from "./panel-fixtures.mjs";

export const RUN_ID = "r-12";
export const runPath = (node) => `/#/teams/${TEAM_ID}/runs/${RUN_ID}${node ? `?node=${node}` : ""}`;
const sec = (s) => new Date(now - s * 1000).toISOString();

const inv = (id, iteration, status, outcome = null, startedS = 300, endedS = null) => ({
  invocation_id: id,
  iteration,
  status,
  outcome,
  outcome_detail: null,
  context_manifest: null,
  cost: null,
  connectors: null,
  started_at: sec(startedS),
  ended_at: endedS === null ? null : sec(endedS),
});

const plain = (live_state) => ({
  live_state,
  last_event_at: null,
  activity: null,
  activity_started_at: null,
  retry: null,
  backup_model: null,
});

/** The run's graph (`GET /api/runs/:id/graph`) for a board state. */
export function runGraph(state = "working") {
  const n = (key, status, iteration, invocations, live) => ({
    ...NODES[key],
    origin_node_id: NODES[key].id,
    status,
    iteration,
    invocations,
    live,
  });
  const eng =
    state === "working"
      ? {
          live_state: "running_command",
          last_event_at: sec(4),
          activity: "Running tests · tests/test_indicators.py",
          activity_started_at: sec(4),
          retry: null,
          backup_model: null,
        }
      : plain("waiting");
  const nodes = [
    n("pm", "done", 1, [inv(1, 1, "done", "prd_written", 258, 180)], plain("done")),
    n("prd", "done", 1, [inv(2, 1, "done", "approved", 180, 150)], plain("done")),
    n("stop", "idle", 0, [], plain("waiting")),
    n("eng", "running", 1, [inv(3, 1, "running", null, 150)], eng),
    n("rev", "idle", 0, [], plain("waiting")),
    n("esc", "idle", 0, [], plain("waiting")),
    n("ship", "idle", 0, [], plain("waiting")),
  ];
  return {
    run_id: RUN_ID,
    team_graph_id: `${TEAM_ID}-run`,
    nodes,
    edges: EDGES,
    resolution_warnings: [],
    live_state: state === "working" ? "running_command" : "working",
  };
}

export function runRow(status = "running") {
  return {
    id: RUN_ID,
    team_graph_id: `${TEAM_ID}-run`,
    idea: "Add an RSI indicator",
    status,
    pm_document_id: "d-spec",
    ship_commit_sha: null,
    ship_tag: null,
    repo_path: null,
    base_ref: "main",
    ship_branch: null,
    subpath: null,
    github_repo: "lazyxgenius/trade_mcp",
    pr_url: null,
    cost_total_usd: 0.38,
    pair_id: null,
    pair_label: null,
    created_at: sec(258),
    updated_at: sec(4),
    local_repo_label: null,
    status_group: status === "running" ? "running" : status,
    budget_cap_usd: 5,
    library_team_id: TEAM_ID,
    retry_of_run_id: null,
    team: { id: TEAM_ID, name: TEAM_NAME },
    spent_usd: 0.38,
    awaiting: null,
    failure: null,
    live_state: "running_command",
  };
}

/** Every API route the run view reads, for a board state. */
export function runRoutes(state = "working", over = {}) {
  return panelRoutes({
    over: {
      [`GET /api/runs/${RUN_ID}`]: {
        run_id: RUN_ID,
        workflow_status: "PENDING",
        run: runRow("running"),
        costs: [],
      },
      [`GET /api/runs/${RUN_ID}/tasks`]: { tasks: [] },
      [`GET /api/runs/${RUN_ID}/graph`]: runGraph(state),
      [`GET /api/spike/run-events/${RUN_ID}`]: { run_id: RUN_ID, events: [] },
      [`GET /api/runs/${RUN_ID}/documents`]: { documents: [] },
      [`GET /api/teams/${TEAM_ID}/runs`]: { runs: [] },
      ...over,
    },
  });
}

export { ago, TEAM_ID, TEAM_NAME };

// ---- M2: one Activity reply per board (Runs › Live-*, Prob-Stalled / -Failed / -NotifyAsk) ----
// The boards print local clock times ("10:43:10") and "ago" stamps against a board's own moment, so
// each board has a `now` on yesterday's date (in the past, whatever the hour of the sweep); the
// scenario freezes the page's Date.now there (`frozenAt`).
const DAY = new Date(now - 24 * 3600_000);
export const clockAt = (hms) => {
  const [h, m, s] = hms.split(":").map(Number);
  const d = new Date(DAY);
  d.setHours(h, m, s, 0);
  return d.toISOString();
};
const before = (hms, s) => new Date(Date.parse(clockAt(hms)) - s * 1000).toISOString();

/** An init script (a string: init scripts are serialized) stopping Date.now at a board's moment,
 *  so "4 s ago" stays "4 s ago" however long the page takes to load. */
export const frozenAt = (hms, extra = "") => `(() => {
  Date.now = () => ${Date.parse(clockAt(hms))};
  ${extra}
})();`;

const WHO = {
  Run: null,
  "Product manager": "n-pm",
  "Approval gate": "n-prd",
  Engineer: "n-eng",
  Reviewer: "n-rev",
  Ship: "n-ship",
};
let lineSeq = 0;
/** One Activity line, the API's shape (docs/superpowers/plans/api/activity.md). */
const L = (hms, label, kind, text, tone = "neutral", refs = {}, iteration = null) => ({
  id: `ev:${++lineSeq}`,
  at: clockAt(hms),
  node_id: WHO[label],
  label,
  iteration,
  kind,
  text,
  tone,
  refs,
});

const READ6 = [
  "core/indicators.py",
  "core/registry.py",
  "core/__init__.py",
  "tests/test_indicators.py",
  "tests/test_registry.py",
  "tests/conftest.py",
];
const FAILED_TAIL = [
  "....F..F.......F.........................",
  "FAILED tests/test_indicators.py::test_rsi_stays_between_0_and_100 - AssertionError: 104.2 > 100",
  "FAILED tests/test_indicators.py::test_rsi_default_length_is_14",
  "FAILED tests/test_indicators.py::TestRegistry::test_list_indicators_returns_twenty_eight",
  "3 failed, 38 passed in 4.21s",
];
const SUITE_TAIL = [
  "tests/test_indicators.py ........................................ [ 41%]",
  "tests/test_strategies.py ................................         [ 74%]",
  "tests/test_backtest.py ...........                                [ 85%]",
  "(still running: tests/test_backtest.py::test_ten_year_replay)",
];
const PYTEST = "python -m pytest -q tests/test_indicators.py";

// The run's story, in order. Each board shows its last few lines; the rest sit behind "Show N
// earlier steps" (the board's step count is the line count).
const STORY = {
  start: () =>
    L("10:41:02", "Run", "started", "Started on lazyxgenius/trade_mcp, branch main", "neutral", {
      repo: "lazyxgenius/trade_mcp",
      branch: "main",
    }),
  pmRead: () =>
    L("10:41:06", "Product manager", "read", "Read the task and 14 files", "neutral", {}, 1),
  pmSearch: () =>
    L(
      "10:41:40",
      "Product manager",
      "searched",
      "Looked up how indicators are registered: INDICATORS",
      "neutral",
      { query: "INDICATORS" },
      1,
    ),
  pmSpec: () =>
    L(
      "10:42:05",
      "Product manager",
      "wrote_doc",
      "Wrote the spec (v2)",
      "neutral",
      { document_id: "d-spec", version: 2, name: "spec" },
      1,
    ),
  gateWait: () =>
    L(
      "10:42:06",
      "Approval gate",
      "gate_waiting",
      "Waiting for you to approve the spec",
      "neutral",
      { task_id: 12 },
    ),
  gateOk: () =>
    L("10:43:10", "Approval gate", "gate_approved", "You approved the spec", "ok", { task_id: 12 }),
  engRead: () =>
    L(
      "10:43:31",
      "Engineer",
      "read",
      "Read 6 files in core/ and tests/",
      "neutral",
      { files: READ6 },
      1,
    ),
  engEdit1: () =>
    L(
      "10:44:02",
      "Engineer",
      "edited",
      "Edited core/indicators.py",
      "neutral",
      { file: "core/indicators.py", added: 48, removed: 3 },
      1,
    ),
  engTests1: () =>
    L(
      "10:44:40",
      "Engineer",
      "tests",
      "Ran the tests: 3 failed, 38 passed",
      "danger",
      { command: PYTEST, passed: 38, failed: 3, output_tail: FAILED_TAIL },
      1,
    ),
  engEdit2: () =>
    L(
      "10:45:12",
      "Engineer",
      "edited",
      "Edited core/indicators.py",
      "neutral",
      { file: "core/indicators.py", added: 6, removed: 2 },
      1,
    ),
  engTestsLive: () =>
    L(
      "10:45:20",
      "Engineer",
      "tests",
      "Running the tests again",
      "neutral",
      { command: PYTEST, running: true, started_at: clockAt("10:45:20"), output_tail: [] },
      1,
    ),
  engTests2: () =>
    L(
      "10:45:20",
      "Engineer",
      "tests",
      "Ran the tests: all 41 passed",
      "ok",
      { command: PYTEST, passed: 41, failed: 0, output_tail: ["41 passed in 4.02s"] },
      1,
    ),
  revStart: () =>
    L(
      "10:46:02",
      "Reviewer",
      "started",
      "Round 1 · checked the change against spec v2",
      "neutral",
      {},
      1,
    ),
  revRead: () =>
    L(
      "10:46:40",
      "Reviewer",
      "read",
      "Read core/indicators.py",
      "neutral",
      { files: ["core/indicators.py"] },
      1,
    ),
  revTests: () =>
    L(
      "10:47:30",
      "Reviewer",
      "tests",
      "Ran the tests: all 41 passed",
      "ok",
      {
        command: "python -m pytest -q",
        passed: 41,
        failed: 0,
        output_tail: ["41 passed in 4.10s"],
      },
      1,
    ),
  verdict1: () =>
    L(
      "10:48:40",
      "Reviewer",
      "verdict",
      "Asked for 2 fixes: register RSI on INDICATORS and default the length to 14",
      "neutral",
      {
        verdict: "changes_requested",
        reasons: "Register RSI on INDICATORS. Default the length to 14.",
      },
      1,
    ),
  eng2Start: () =>
    L(
      "10:48:52",
      "Engineer",
      "started",
      "Started round 2 with the reviewer’s notes",
      "neutral",
      {},
      2,
    ),
  eng2Edit: () =>
    L(
      "10:49:31",
      "Engineer",
      "edited",
      "Edited core/indicators.py and tests/test_indicators.py",
      "neutral",
      { file: "core/indicators.py" },
      2,
    ),
  suiteLive: () =>
    L(
      "10:49:50",
      "Engineer",
      "command",
      "Running the full test suite: python -m pytest -q",
      "neutral",
      {
        command: "python -m pytest -q",
        running: true,
        started_at: clockAt("10:49:50"),
        output_tail: SUITE_TAIL,
      },
      2,
    ),
  suiteDone: () =>
    L(
      "10:49:50",
      "Engineer",
      "tests",
      "Ran the tests: 2 failed, 39 passed",
      "danger",
      {
        command: "python -m pytest -q",
        passed: 39,
        failed: 2,
        output_tail: ["2 failed, 39 passed in 3m 02s"],
      },
      2,
    ),
  eng2Edit2: () =>
    L(
      "10:52:05",
      "Engineer",
      "edited",
      "Edited core/indicators.py",
      "neutral",
      { file: "core/indicators.py", added: 4, removed: 1 },
      2,
    ),
  asked1: () =>
    L("10:52:31", "Engineer", "message", "Asked the model for the next step", "neutral", {}, 2),
  retry1: () =>
    L(
      "10:52:33",
      "Engineer",
      "retry",
      "Model busy (too many requests). Trying again in 10 s · 1 of 3",
      "warn",
      { attempt: 1, of: 3, wait_s: 10, reason: "too many requests" },
      2,
    ),
  retry2: () =>
    L(
      "10:52:44",
      "Engineer",
      "retry",
      "Still busy. Trying again in 20 s · 2 of 3",
      "warn",
      { attempt: 2, of: 3, wait_s: 20, reason: "too many requests" },
      2,
    ),
  backup: () =>
    L(
      "10:53:04",
      "Engineer",
      "backup",
      "Switched to the backup model, openai/gpt-4.1-mini",
      "warn",
      { from_model: "anthropic/claude-sonnet-4", to_model: "openai/gpt-4.1-mini" },
      2,
    ),
  edit3: () =>
    L(
      "10:53:20",
      "Engineer",
      "edited",
      "Edited core/indicators.py",
      "neutral",
      { file: "core/indicators.py", added: 12, removed: 4 },
      2,
    ),
  asked2: () =>
    L("10:53:30", "Engineer", "message", "Asked the model for the next step", "neutral", {}, 2),
  stalled: () =>
    L(
      "10:58:40",
      "Engineer",
      "stalled",
      "No update for 5m 10s · Stalled",
      "danger",
      { after_s: 310 },
      2,
    ),
};

/** `total` lines: filler from the story (oldest dropped) before the board's own lines. */
function withEarlier(total, shown, story) {
  const first = Date.parse(shown[0].at);
  const earlier = story.filter((l) => Date.parse(l.at) < first);
  const need = total - shown.length;
  const kept = earlier.slice(Math.max(0, earlier.length - need));
  // Not enough story: repeat a plain read further back.
  for (let i = kept.length; i < need; i += 1) {
    kept.unshift({
      ...L("10:40:00", "Product manager", "read", "Read the task", "neutral", {}, 1),
      at: before("10:41:02", need - i),
    });
  }
  return [...kept, ...shown];
}

const AGENT_BASE = {
  "n-pm": ["Product manager", "completion", null],
  "n-prd": ["Approval gate", "gate", null],
  "n-stop": ["Stop", "stop", null],
  "n-eng": ["Engineer", "agent", 3],
  "n-rev": ["Reviewer", "agent", 3],
  "n-esc": ["Escalation gate", "gate", null],
  "n-ship": ["Ship", "ship", null],
};
const agentsOf = (over) =>
  Object.entries(AGENT_BASE).map(([id, [label, kind, rounds_limit]]) => {
    const o = over[id] ?? {};
    return {
      node_id: id,
      origin_node_id: id,
      label,
      kind,
      iteration: o.iteration ?? 0,
      rounds_limit,
      live_state: o.state ?? "waiting",
      activity: o.activity ?? null,
      last_event_at: o.at ? clockAt(o.at) : null,
      activity_started_at: o.started ? clockAt(o.started) : o.at ? clockAt(o.at) : null,
      retry: o.retry ?? null,
      backup_model: o.backup ?? null,
      model: Object.values(NODES).find((n) => n.id === id)?.model ?? null,
    };
  });

const done = (activity, at, iteration = 1) => ({ state: "done", activity, at, iteration });
const PM_DONE = done("Wrote the spec (v2)", "10:42:05");
const GATE_DONE = done("You approved · 10:43", "10:43:10");
const REV_R1 = done("Round 1 · changes requested", "10:48:40");

// Each board: its moment, the run (status, elapsed seconds, cost), the agents, the lines, the
// pinned callout and the summary.
function boardOf(board) {
  lineSeq = 0;
  const s = Object.fromEntries(Object.entries(STORY).map(([k, f]) => [k, f()]));
  const round1 = [
    s.start,
    s.pmRead,
    s.pmSearch,
    s.pmSpec,
    s.gateWait,
    s.gateOk,
    s.engRead,
    s.engEdit1,
    s.engTests1,
    s.engEdit2,
  ];
  const round2 = [
    ...round1,
    s.engTests2,
    s.revStart,
    s.revRead,
    s.revTests,
    s.verdict1,
    s.eng2Start,
    s.eng2Edit,
    s.suiteDone,
    s.eng2Edit2,
  ];
  const working = {
    now: "10:45:24",
    status: "running",
    elapsed: 258,
    cost: 0.38,
    liveState: "running_command",
    agents: {
      "n-pm": PM_DONE,
      "n-prd": GATE_DONE,
      "n-eng": {
        state: "running_command",
        activity: "Running tests · tests/test_indicators.py",
        at: "10:45:20",
        iteration: 1,
      },
    },
    // Live-Working counts 10 steps: the gate's open line is folded into its approval.
    lines: [
      s.start,
      s.pmRead,
      s.pmSearch,
      s.pmSpec,
      s.gateOk,
      s.engRead,
      s.engEdit1,
      s.engTests1,
      s.engEdit2,
      s.engTestsLive,
    ],
    total: 10,
  };
  const B = {
    "Live-Working": working,
    "Live-Website": working,
    "Live-AgentSteps": working,
    "Prob-NotifyAsk": working,
    "Live-NeedsYou": {
      now: "10:42:20",
      status: "awaiting_human",
      elapsed: 64,
      cost: 0.06,
      liveState: "needs_you",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:42:06"),
        "n-prd": {
          state: "needs_you",
          activity: "Waiting for you · Review the spec",
          at: "10:42:06",
          iteration: 1,
        },
      },
      lines: [s.start, s.pmRead, s.pmSearch, s.pmSpec, s.gateWait],
      total: 5,
      pinned: {
        kind: "gate",
        node_id: "n-prd",
        label: "Approval gate",
        title: "The approval gate is waiting for you",
        body: "Read the spec, then approve or reject it. The run is paused until you decide, and the timer has stopped.",
        task_id: 12,
        backup_model: null,
      },
    },
    "Live-Command": {
      now: "10:52:00",
      status: "running",
      elapsed: 538,
      cost: 0.71,
      liveState: "running_command",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:46:00"),
        "n-prd": done("You approved · 10:43", "10:47:00"),
        "n-eng": {
          state: "running_command",
          activity: "python -m pytest -q · no output for 40 s",
          at: "10:51:20",
          started: "10:49:50",
          iteration: 2,
        },
        "n-rev": { ...done("Round 1 · changes requested", "10:49:00"), state: "waiting" },
      },
      lines: withEarlier(
        17,
        [s.verdict1, s.eng2Start, s.eng2Edit, s.suiteLive],
        round1.concat([s.engTests2, s.revStart, s.revRead, s.revTests]),
      ),
      total: 17,
    },
    "Live-Retrying": {
      now: "10:52:54",
      status: "running",
      elapsed: 702,
      cost: 0.79,
      liveState: "retrying",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:45:54"),
        "n-prd": done("You approved · 10:43", "10:46:54"),
        "n-eng": {
          state: "retrying",
          activity: "Model busy · trying again in 20 s (2 of 3)",
          at: "10:52:44",
          iteration: 2,
          retry: { attempt: 2, of: 3, next_at: clockAt("10:53:04") },
          backup: "openai/gpt-4.1-mini",
        },
        "n-rev": { ...REV_R1, at: "10:48:54", state: "waiting" },
      },
      lines: withEarlier(21, [s.asked1, s.retry1, s.retry2], round2),
      total: 21,
      pinned: {
        kind: "retrying",
        node_id: "n-eng",
        label: "Engineer",
        title: "The Engineer’s model is busy",
        body: "Tvashtr tries once more in 20 seconds. If it is still busy, the Engineer switches to its backup model, openai/gpt-4.1-mini, and carries on. You don’t need to do anything.",
        task_id: null,
        backup_model: "openai/gpt-4.1-mini",
      },
    },
    // The board's 10:55:02 "No update for 1m 32s" line is a state, not a line (activity.md):
    // the server never sends it, so the reply has the three lines before it.
    "Live-Quiet": {
      now: "10:55:02",
      status: "running",
      elapsed: 840,
      cost: 0.83,
      liveState: "quiet",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:46:02"),
        "n-prd": done("You approved · 10:43", "10:47:02"),
        "n-eng": {
          state: "quiet",
          activity: "Asked the model",
          at: "10:53:30",
          iteration: 2,
          backup: "openai/gpt-4.1-mini",
        },
        "n-rev": { ...REV_R1, at: "10:49:02", state: "waiting" },
      },
      lines: withEarlier(
        24,
        [s.backup, s.edit3, s.asked2],
        [...round2, s.asked1, s.retry1, s.retry2],
      ),
      total: 24,
    },
    "Prob-Stalled": {
      now: "10:58:40",
      status: "running",
      elapsed: 1058,
      cost: 0.84,
      liveState: "stalled",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:43:40"),
        "n-prd": done("You approved · 10:43", "10:45:40"),
        "n-eng": { state: "stalled", activity: "Asked the model", at: "10:53:30", iteration: 2 },
        "n-rev": { ...REV_R1, at: "10:50:40", state: "waiting" },
      },
      lines: withEarlier(
        25,
        [s.backup, s.edit3, s.asked2, s.stalled],
        [...round2, s.asked1, s.retry1, s.retry2],
      ),
      total: 25,
      pinned: {
        kind: "stalled",
        node_id: "n-eng",
        label: "Engineer",
        title: "The Engineer may be stuck",
        body: "No update for 5m 10s. Its last step was asking the model for the next step, at 10:53:30. Nothing has shipped. The spec, your approval and the round 1 changes are saved.",
        task_id: null,
        backup_model: null,
      },
    },
    "Prob-Failed": {
      now: "11:00:05",
      status: "failed",
      elapsed: 1083,
      cost: 0.84,
      liveState: "failed",
      agents: {
        "n-pm": done("Wrote the spec (v2)", "10:44:05"),
        "n-prd": done("You approved · 10:43", "10:45:05"),
        "n-eng": {
          state: "failed",
          activity: "The model didn’t answer after 3 tries",
          at: "10:59:05",
          iteration: 2,
        },
        "n-rev": { ...REV_R1, at: "10:51:05", state: "waiting" },
      },
      lines: withEarlier(
        27,
        [
          L(
            "10:56:31",
            "Engineer",
            "retry",
            "Model busy. Trying again in 10 s · 1 of 3",
            "warn",
            { attempt: 1, of: 3, wait_s: 10 },
            2,
          ),
          L(
            "10:56:42",
            "Engineer",
            "retry",
            "Still busy. Trying again in 20 s · 2 of 3",
            "warn",
            { attempt: 2, of: 3, wait_s: 20 },
            2,
          ),
          L(
            "10:57:03",
            "Engineer",
            "backup",
            "Switched to the backup model, openai/gpt-4.1-mini",
            "warn",
            { from_model: "anthropic/claude-sonnet-4", to_model: "openai/gpt-4.1-mini" },
            2,
          ),
          L(
            "10:57:05",
            "Engineer",
            "error",
            "The backup model didn’t answer within 2 minutes",
            "danger",
            { message: "timeout" },
            2,
          ),
          L(
            "10:59:05",
            "Engineer",
            "error",
            "Failed: the model didn’t answer after 3 tries",
            "danger",
            { message: "no answer" },
            2,
          ),
          L(
            "10:59:05",
            "Run",
            "done",
            "Stopped. Nothing shipped. Everything finished before round 2 is saved.",
            "neutral",
            { elapsed_s: 1083, cost_usd: 0.84 },
          ),
        ],
        [...round2, s.asked1, s.retry1, s.retry2, s.backup, s.edit3, s.asked2],
      ),
      total: 27,
      pinned: {
        kind: "failed",
        node_id: "n-eng",
        label: "Engineer",
        title: "Engineer failed: the model didn’t answer after 3 tries",
        body: "Impact: nothing was shipped. Safe: your approved spec (v2) and the Engineer’s round 1 changes are saved. Next: resume from Engineer, round 2. Tvashtr skips the work that is done, so you don’t pay for it again.",
        task_id: null,
        backup_model: null,
      },
    },
    "Live-Done": {
      now: "11:04:00",
      status: "completed",
      elapsed: 1358,
      cost: 1.12,
      liveState: "done",
      agents: {
        "n-pm": done("Wrote the spec (v3)", "10:44:00", 2),
        "n-prd": GATE_DONE,
        "n-eng": done("Ran the tests: all 41 passed", "11:00:12", 3),
        "n-rev": done("Approved", "11:02:41", 3),
        "n-ship": { state: "done", activity: "Pull request #42", at: "11:03:22" },
      },
      lines: withEarlier(
        31,
        [
          L(
            "11:00:12",
            "Engineer",
            "tests",
            "Ran the tests: all 41 passed",
            "ok",
            {
              command: "python -m pytest -q",
              passed: 41,
              failed: 0,
              output_tail: ["41 passed in 3m 10s"],
            },
            3,
          ),
          L(
            "11:01:30",
            "Reviewer",
            "started",
            "Round 3 · checked the change against spec v3",
            "neutral",
            {},
            3,
          ),
          L(
            "11:02:41",
            "Reviewer",
            "verdict",
            "Approved: RSI is registered, bounded 0–100 and tested",
            "ok",
            { verdict: "approved", reasons: "RSI is registered, bounded 0–100 and tested." },
            3,
          ),
          L(
            "11:03:22",
            "Ship",
            "pr",
            "Pushed branch tvashtr/run-12 and opened pull request #42",
            "ok",
            {
              pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
              pr_number: 42,
              branch: "tvashtr/run-12",
            },
          ),
          L("11:03:40", "Run", "done", "Done in 22m 38s · $1.12", "ok", {
            elapsed_s: 1358,
            cost_usd: 1.12,
          }),
        ],
        [...round2, s.asked1, s.retry1, s.retry2, s.backup, s.edit3, s.asked2],
      ),
      total: 31,
      summary: {
        pr_url: "https://github.com/lazyxgenius/trade_mcp/pull/42",
        pr_number: 42,
        branch: "tvashtr/run-12",
        base_ref: "main",
        tests_passed: 41,
        rounds: 3,
        elapsed_s: 1358,
        cost_usd: 1.12,
      },
    },
  };
  return B[board];
}

/** `GET /api/runs/r-12/activity` for a board (the whole reply; `after` is ignored). */
export function activityFor(board) {
  const b = boardOf(board);
  return {
    run_id: RUN_ID,
    status: b.status,
    live_state: b.liveState,
    cursor: `${clockAt(b.now)}|ev:${b.lines.length}`,
    total: b.total,
    agents: agentsOf(b.agents),
    lines: b.lines,
    pinned: b.pinned ?? null,
    summary: b.summary ?? null,
  };
}

/** The run graph for a board: node statuses + the M1 `live` blocks the cards read. */
function boardGraph(board) {
  const b = boardOf(board);
  const a = new Map(agentsOf(b.agents).map((x) => [x.node_id, x]));
  const live = (id) => {
    const x = a.get(id);
    return {
      live_state: x.live_state,
      last_event_at: x.last_event_at,
      activity: x.activity,
      activity_started_at: x.activity_started_at,
      retry: x.retry,
      backup_model: x.backup_model,
    };
  };
  const t = (hms) => clockAt(hms);
  const round = (n, status, outcome, start, end) => ({
    ...inv(n, n, status, outcome),
    started_at: t(start),
    ended_at: end ? t(end) : null,
  });
  const n = (key, status, iteration, invocations) => ({
    ...NODES[key],
    origin_node_id: NODES[key].id,
    status,
    iteration,
    invocations,
    live: live(NODES[key].id),
  });
  const r2 = [
    "Live-Command",
    "Live-Retrying",
    "Live-Quiet",
    "Prob-Stalled",
    "Prob-Failed",
  ].includes(board);
  const doneRun = board === "Live-Done";
  const needs = board === "Live-NeedsYou";
  const pm = n("pm", "done", 1, [round(1, "done", "prd_written", "10:41:04", "10:42:05")]);
  const prd = needs
    ? n("prd", "running", 1, [round(1, "running", null, "10:42:06")])
    : n("prd", "done", 1, [round(1, "done", "approved", "10:42:06", "10:43:10")]);
  const engR1 = round(1, "done", "built", "10:43:12", "10:45:40");
  const eng = needs
    ? n("eng", "idle", 0, [])
    : doneRun
      ? n("eng", "done", 3, [
          engR1,
          round(2, "done", "built", "10:48:52", "10:56:00"),
          round(3, "done", "built", "10:58:00", "11:00:12"),
        ])
      : r2
        ? n("eng", board === "Prob-Failed" ? "failed" : "running", 2, [
            engR1,
            round(
              2,
              board === "Prob-Failed" ? "failed" : "running",
              null,
              "10:48:52",
              board === "Prob-Failed" ? "10:59:05" : null,
            ),
          ])
        : n("eng", "running", 1, [round(1, "running", null, "10:43:12")]);
  const rev = doneRun
    ? n("rev", "done", 3, [
        round(1, "done", "changes_requested", "10:46:02", "10:48:40"),
        round(2, "done", "changes_requested", "10:56:10", "10:57:50"),
        round(3, "done", "approved", "11:01:30", "11:02:41"),
      ])
    : r2
      ? n("rev", "done", 1, [round(1, "done", "changes_requested", "10:46:02", "10:48:40")])
      : n("rev", "idle", 0, []);
  const ship = doneRun
    ? n("ship", "done", 1, [round(1, "done", "shipped", "11:02:50", "11:03:22")])
    : n("ship", "idle", 0, []);
  return {
    run_id: RUN_ID,
    team_graph_id: `${TEAM_ID}-run`,
    nodes: [pm, prd, n("stop", "idle", 0, []), eng, rev, n("esc", "idle", 0, []), ship],
    edges: EDGES,
    resolution_warnings: [],
    live_state: b.liveState,
  };
}

/** The open gate task (Live-NeedsYou). */
const GATE_TASK = {
  id: 12,
  run_id: RUN_ID,
  kind: "gate_approval",
  priority: "high_blocker",
  blocking: true,
  topic: "prd_approval",
  title: "Approve the spec before the Engineer builds",
  description: "Read the spec, then approve or reject it.",
  status: "pending",
  resolution: null,
  resolution_note: null,
  created_at: clockAt("10:42:06"),
  resolved_at: null,
};

/** Every API route the run view reads for a board, plus the account's notification answer. */
export function boardRoutes(board, { asked = true } = {}) {
  const b = boardOf(board);
  const row = {
    ...runRow(b.status),
    status: b.status,
    status_group:
      b.status === "running" ? "running" : b.status === "awaiting_human" ? "needs_you" : b.status,
    created_at: before(b.now, b.elapsed),
    updated_at: clockAt(b.now),
    cost_total_usd: b.cost,
    spent_usd: b.cost,
    live_state: b.liveState,
    pr_url: b.summary?.pr_url ?? null,
    ship_branch: b.summary ? "tvashtr/run-12" : null,
  };
  const terminal = ["completed", "failed"].includes(b.status);
  return runRoutes("working", {
    [`GET /api/runs/${RUN_ID}`]: {
      run_id: RUN_ID,
      workflow_status: terminal ? (b.status === "completed" ? "SUCCESS" : "ERROR") : "PENDING",
      run: row,
      costs: [],
    },
    [`GET /api/runs/${RUN_ID}/graph`]: boardGraph(board),
    [`GET /api/runs/${RUN_ID}/tasks`]: {
      run_id: RUN_ID,
      tasks: board === "Live-NeedsYou" ? [GATE_TASK] : [],
    },
    [`GET /api/runs/${RUN_ID}/activity`]: activityFor(board),
    "GET /api/account/preferences": {
      notify_asked: asked,
      notify_needs_you: true,
      notify_stalls_fails: true,
      notify_finishes: true,
    },
    "GET /api/inbox": { count: 0, items: [] },
    "GET /api/runs": { runs: [], next_cursor: null },
  });
}

export const boardNow = (board) => boardOf(board).now;
