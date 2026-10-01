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
