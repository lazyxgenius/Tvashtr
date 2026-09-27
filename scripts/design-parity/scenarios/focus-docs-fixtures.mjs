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

const PM = {
  kind: "agent",
  node_id: "n-pm",
  role_name: "pm",
  label: "Product manager",
};
const ENG = {
  kind: "agent",
  node_id: "n-eng",
  role_name: "engineer",
  label: "Engineer",
};
const YOU = { kind: "human", node_id: null, role_name: null, label: "You" };

/** The shared spec as Docs-Viewer draws it (v3), and v2 as Docs-Compare's diff implies. */
export const SPEC_V3 = [
  "# Add an RSI indicator",
  "",
  "Traders want a momentum signal in the strategy builder. Add the Relative Strength Index as a first-class indicator.",
  "",
  "## Goals",
  "",
  "- Compute RSI over a configurable period (default 14) on candle closes.",
  "- Register it on `INDICATORS` so the builder, the tests and the TypeScript mirror all list it.",
  "- Show it in the indicator picker with its parameters and outputs.",
  "",
  "## Acceptance",
  "",
  "- `TestRegistry` lists 29 indicators, including `rsi`.",
  "- `web/lib/engine-facts.ts` sets `indicator_count` to 29.",
  "- A unit test checks RSI against a known series.",
  "",
  "## Out of scope",
  "",
  "- Alerts on RSI crossovers.",
].join("\n");
const SPEC_V2 = SPEC_V3.replace(
  "- `web/lib/engine-facts.ts` sets `indicator_count` to 29.\n- A unit test checks RSI against a known series.",
  "- `TestRegistry` lists 28 indicators.",
);
/** Docs-EditLive: the editor holds the start of the spec with the third goal rewritten. */
export const SPEC_EDIT = SPEC_V3.split("\n## Acceptance")[0]
  .trimEnd()
  .replace(
    "Show it in the indicator picker with its parameters and outputs.",
    "Show the RSI line under the price chart with 30 / 70 guides.",
  );

const version = (n, content, author, note, min) => ({
  id: `v-${n}`,
  version_no: n,
  content,
  created_at: ago(min),
  author,
  note,
});

/** GET /api/documents/d-spec: three versions (the run is live, so it's editable). */
export const SPEC_DETAIL = {
  id: "d-spec",
  name: "spec",
  title: "PRD",
  doc_type: "prd",
  run_id: "r-rsi",
  is_shared_spec: true,
  editable: true,
  created_at: ago(52),
  updated_at: ago(31),
  versions: [
    version(
      1,
      SPEC_V2.replace("- `TestRegistry` lists 28 indicators.\n", ""),
      PM,
      "First draft",
      52,
    ),
    version(2, SPEC_V2, YOU, "Edited while the run was live", 40),
    version(3, SPEC_V3, PM, "Revised in round 3", 31),
  ],
};
export const NOTES_DETAIL = {
  id: "d-notes",
  name: "build-notes",
  title: "build-notes",
  doc_type: "build-notes",
  run_id: "r-rsi",
  is_shared_spec: false,
  editable: true,
  created_at: ago(50),
  updated_at: ago(36),
  versions: [
    version(
      1,
      "# Build notes\n\n- Added `rsi` to `INDICATORS`.",
      ENG,
      "Round 1",
      50,
    ),
    version(
      2,
      "# Build notes\n\n- Added `rsi` to `INDICATORS`.\n- Ran pytest.",
      ENG,
      "Round 2",
      36,
    ),
  ],
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
      "GET /api/documents/d-spec": SPEC_DETAIL,
      "GET /api/documents/d-notes": NOTES_DETAIL,
      ...over,
    },
  });

/** Wait until the canvas shows the documents (the toolbar count and the chips). */
export const docsReady = async (page) => {
  await page.getByRole("button", { name: "Documents 2" }).waitFor();
  await page.getByRole("button", { name: "Shared spec v3" }).waitFor();
  await page.waitForTimeout(250);
};
