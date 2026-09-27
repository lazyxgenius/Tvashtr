// Shared fixtures for the Focus view + Documents parity scenarios (slice F6). Not a scenario file
// itself. It builds on F5's panel fixtures: the "Indicator sprint team" canvas, the Reviewer's
// rounds in "Add an RSI indicator" (HISTORY) and that run's two documents (DOCS: the shared spec v3
// by the Product manager, build-notes v2 by the Engineer, read by the Reviewer).
import { NODES, TEAM_ID, ago, panelRoutes } from "./panel-fixtures.mjs";
import { DOCS, HISTORY, RSI } from "./panel-runs-docs.mjs";

export { DOCS, HISTORY, RSI };

/** GET /api/teams/{id}/runs: the team's runs, newest first ("Run: Add an RSI indicator · 31m ago"). */
export const TEAM_RUNS = {
  runs: [
    { ...RSI, cost_total_usd: 0, updated_at: ago(31) },
    ...HISTORY.runs.slice(1).map((r) => ({
      run_id: r.run_id,
      idea: r.idea,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.last_round_at,
      cost_total_usd: 0,
    })),
  ],
};

/** The Product manager's rounds (the entry agent wrote the spec in round 1 of each run). */
export const PM_HISTORY = {
  runs: HISTORY.runs.map((r) => ({
    ...r,
    rounds_count: 1,
    last_outcome: "prd_written",
  })),
  run: null,
};

/** The canvas page's API with the documents of the team's latest run. */
export const docsRoutes = ({ nodes = NODES, over = {} } = {}) =>
  panelRoutes({
    nodes: Object.values(nodes),
    over: {
      [`GET /api/teams/${TEAM_ID}/runs`]: TEAM_RUNS,
      [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: HISTORY,
      [`GET /api/teams/${TEAM_ID}/nodes/n-pm/runs`]: PM_HISTORY,
      "GET /api/runs/r-rsi/documents": DOCS,
      ...over,
    },
  });

/** Wait until the canvas shows the documents (the toolbar count and the chips). */
export const docsReady = async (page) => {
  await page.getByRole("button", { name: "Documents 2" }).waitFor();
  await page.getByRole("button", { name: "Shared spec v3" }).waitFor();
  await page.waitForTimeout(250);
};
