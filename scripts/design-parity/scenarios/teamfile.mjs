// M4 — the team file (Team Setup › File-Panel, File-NewMenu, File-Check, File-CheckError,
// File-Imported, and File-Fixes / File-Checking added for the states built beside them). `kept-teamcanvas-*` capture the kept-elements inventory of the team canvas
// (authoring) before M4 (brief §2.2), website and Desktop. Each board renders as a website and a
// Desktop render (runs-live.mjs's `pair` convention): File-Panel and File-Imported are drawn in
// Desktop (the 30px title strip), so the Desktop render is the comparison and the web render is
// framed 30px down; the Home boards (File-NewMenu, File-Check, File-CheckError) are website boards,
// so the web render is the comparison and the Desktop render is framed 30px up. The sample data is
// the boards' (docs/superpowers/plans/api/team-file.md's shapes).
import { homeRoutes, morning } from "./home-fixtures.mjs";
import { NODES, panelRoutes, TEAM_ID, TEAM_NAME } from "./panel-fixtures.mjs";

const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
const canvasReady = async (page) => {
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(300);
};
const NO_RUNS = { [`GET /api/teams/${TEAM_ID}/runs`]: { runs: [] } };

const underTitleStrip = (page) =>
  page.addStyleTag({
    content: "body { padding-top: 30px; box-sizing: border-box; }",
  });
const aboveTitleStrip = (page) =>
  page.addStyleTag({
    content: "html { height: calc(100% + 30px); margin-top: -30px; }",
  });

/** A board as a website render and a Desktop render (runs-live.mjs's `pair`). */
function pair(
  board,
  {
    desktopBoard = true,
    path,
    routes,
    desktopRoutes = routes,
    steps,
    init = "",
  },
) {
  const frame = (f) => async (p) => {
    await f(p);
    await steps?.(p);
  };
  return [
    {
      name: `${board}-web`,
      path,
      routes,
      init,
      steps: desktopBoard ? frame(underTitleStrip) : steps,
      settle: 600,
    },
    {
      name: `${board}-desktop`,
      path,
      routes: desktopRoutes,
      desktop: true,
      init: `${SEEN}${init}`,
      steps: desktopBoard ? steps : frame(aboveTitleStrip),
      settle: 600,
    },
  ];
}

// ---- The boards' canvas: Product manager → Spec approval → Engineer ⇄ Reviewer (3 rounds) → Ship ----
const at = (key, x, y, extra = {}) => ({
  ...NODES[key],
  position: { x, y },
  ...extra,
});
const BOARD_NODES = [
  at("pm", 36, 60),
  at("prd", 250, 100, {
    config: { ...NODES.prd.config, title: "Spec approval" },
  }),
  at("eng", 424, 60),
  at("rev", 660, 60),
  at("ship", 890, 92),
];
const edge = (id, s, t, conditions = null) => ({
  id,
  source_node_id: NODES[s].id,
  target_node_id: NODES[t].id,
  edge_type: "default",
  conditions,
});
const BOARD_EDGES = [
  edge("e-pm-prd", "pm", "prd"),
  edge("e-prd-eng", "prd", "eng", { when: "approved" }),
  edge("e-eng-rev", "eng", "rev"),
  edge("e-rev-eng", "rev", "eng", { loop_limit: 3 }),
  edge("e-rev-ship", "rev", "ship", { when: "approved" }),
];

/** The canvas page's API for one team (the boards' five nodes). */
function teamRoutes(teamId, name, desktop) {
  const base = desktop
    ? panelRoutes({ keys: [], subs: ["claude", "grok"] })
    : panelRoutes();
  return {
    ...base,
    "GET /api/teams": {
      teams: [{ team_graph_id: teamId, name, node_count: 5, last_run: null }],
    },
    [`GET /api/teams/${teamId}/graph`]: {
      team_graph_id: teamId,
      name,
      nodes: BOARD_NODES,
      edges: BOARD_EDGES,
    },
    [`GET /api/teams/${teamId}/validate`]: {
      errors: [],
      warnings: [],
      runnable: true,
    },
    [`GET /api/teams/${teamId}/runs`]: { runs: [] },
    [`GET /api/teams/${teamId}/file?format=yaml`]: FILE_YAML,
    [`GET /api/teams/${teamId}/file?format=json`]: FILE_JSON,
  };
}

// ---- File-Panel: the 48-line file, as the board prints it (lines 42–48 are below the fold) ----
const YAML = [
  "# Tvashtr team file · version 7 · saved 2 minutes ago",
  "name: Indicator sprint team",
  "version: 7",
  "budget_usd: 5.00",
  "repo: lazyxgenius/trade_mcp",
  "",
  "agents:",
  "  - id: pm",
  "    name: Product manager",
  "    based_on: built-in/product-manager",
  "    model: xai/grok-4.7          # your Grok plan, on this computer",
  "    skills: [spec-writing, repo-map]",
  "  - id: engineer",
  "    name: Engineer",
  "    model: anthropic/claude-sonnet-4",
  "    backup_model: openai/gpt-4.1-mini",
  "    file_access: can-edit",
  "    skills: [python, pytest, git, refactor]",
  "    tools: [chart-render]",
  "  - id: reviewer",
  "    name: Reviewer",
  "    model: xai/grok-4.7",
  "    file_access: read-only",
  "    instructions: |",
  "      You are the Reviewer on a software team. The engineer’s",
  "      build is in your current working directory. Review it —",
  "      do NOT improve it.",
  "",
  "gates:",
  "  - {id: spec-approval, after: pm, asks: you}",
  "",
  "routes:",
  "  - {from: pm, to: spec-approval}",
  "  - {from: spec-approval, to: engineer}",
  "  - {from: engineer, to: reviewer}",
  "  - {from: reviewer, to: engineer, when: changes requested, loop_limit: 3}",
  "  - {from: reviewer, to: ship, when: approved}",
  "",
  "needs:",
  "  connectors: [github]          # each person signs in on their own computer",
  "  secrets: [GITHUB_TOKEN]       # names only, never values",
  "",
  "layout:",
  "  pm: [0, 0]",
  "  spec-approval: [214, 40]",
  "  engineer: [388, 0]",
  "  reviewer: [624, 0]",
  "  ship: [854, 32]",
].join("\n");
const NEEDS = { connectors: ["github"], secrets: ["GITHUB_TOKEN"] };
const FILE_YAML = {
  filename: "indicator-sprint-team.yaml",
  format: "yaml",
  content: YAML,
  lines: 48,
  needs: NEEDS,
};
const JSON_TEXT = JSON.stringify(
  {
    tvashtr_team: 1,
    name: TEAM_NAME,
    budget_usd: 5,
    repo: "lazyxgenius/trade_mcp",
    needs: NEEDS,
  },
  null,
  2,
);
const FILE_JSON = {
  filename: "indicator-sprint-team.json",
  format: "json",
  content: JSON_TEXT,
  lines: JSON_TEXT.split("\n").length,
  needs: NEEDS,
};

// ---- File-Check / File-CheckError: the dry run's answer ----
const CHECK = {
  ok: true,
  error: null,
  filename: "indicator-sprint-team.yaml",
  lines: 48,
  name: "Indicator sprint team (copy)",
  counts: { agents: 4, gates: 1, routes: 5 },
  checks: [
    {
      key: "shape",
      tone: "ok",
      title: "4 agents, 1 gate and 5 routes",
      detail: "The canvas will look the same as in the file.",
    },
    {
      key: "models",
      tone: "ok",
      title: "Both models are set up on this computer",
      detail: "xai/grok-4.7 and anthropic/claude-sonnet-4",
      code: ["xai/grok-4.7", "anthropic/claude-sonnet-4"],
    },
    {
      key: "connector:github",
      tone: "warn",
      title: "GitHub isn’t signed in here",
      detail:
        "The Engineer needs it to open pull requests. Runs still work; sign in before you want one to ship.",
    },
    {
      key: "tool:chart-render",
      tone: "warn",
      title: "The tool chart-render isn’t in your Toolkit",
      detail:
        "The Engineer runs without it until you add it or remove it from the team.",
      code: ["chart-render"],
    },
    {
      key: "secrets",
      tone: "ok",
      title: "No secrets inside the file",
      detail: "It names GITHUB_TOKEN. You’ll use your own.",
    },
  ],
  fixes: 2,
};
const CHECK_ERROR = {
  ok: false,
  error: { line: 12, message: "`agents` should be a list of agents." },
  filename: "indicator-sprint-team.yaml",
  lines: 48,
  name: "",
  counts: { agents: 0, gates: 0, routes: 0 },
  checks: [],
  fixes: 0,
};

/** New team › Import a team file › the picked file, then the dialog with the check's answer. */
const importFile = async (page) => {
  await page.keyboard.press("t");
  await page.waitForSelector('[role="dialog"][aria-label="New team"]');
  await page.getByTestId("import-team-input").setInputFiles({
    name: "indicator-sprint-team.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(YAML),
  });
  await page.getByRole("dialog", { name: "Import a team file" }).waitFor();
  await page.getByText(/^(48 lines|Can’t be read · 48 lines)$/).waitFor();
  await page.waitForTimeout(200);
};

// ---- File-Imported: the new team, its two fixes (on the Engineer) and the toast ----
const COPY_ID = "t-ind-copy";
const COPY_NAME = "Indicator sprint team (copy)";
const NOTICE = {
  fixes: [
    {
      key: "connector:github",
      text: "Sign in to GitHub",
      action: "sign_in",
      target: "github",
      node_ids: ["n-eng"],
    },
    {
      key: "tool:chart-render",
      text: "Add chart-render or remove it",
      action: "open_toolkit",
      target: "chart-render",
      node_ids: ["n-eng"],
    },
  ],
  note: "You can run the team now. It can’t open a pull request until GitHub is signed in.",
  toast: true,
};
const IMPORTED = `sessionStorage.setItem("tvashtr.teamImport.${COPY_ID}", ${JSON.stringify(JSON.stringify(NOTICE))});`;

// File-Fixes: four fixes (a model key and a Domain too: the note is the no-key one), the Engineer's
// three chips, then Copy in the Team file panel (closed again) leaves its toast.
const NOTICE_MORE = {
  fixes: [
    ...NOTICE.fixes,
    {
      key: "model:anthropic",
      text: "Add a key for anthropic, or pick another model",
      action: "open_engines",
      target: "anthropic",
      node_ids: ["n-eng"],
    },
    {
      key: "domain:docs",
      text: "Pick a Domain for Ask the docs",
      action: "open_domains",
      target: "docs",
      node_ids: [],
    },
  ],
  note: "The team can’t run until each model has a key here, or you pick another model.",
  toast: false,
};
const IMPORTED_MORE = `sessionStorage.setItem("tvashtr.teamImport.${COPY_ID}", ${JSON.stringify(JSON.stringify(NOTICE_MORE))});`;

/** File-Checking: the dialog while the check is out, and when it couldn't be made. */
const importChecking = (shown) => async (page) => {
  await page.keyboard.press("t");
  await page.waitForSelector('[role="dialog"][aria-label="New team"]');
  await page.getByTestId("import-team-input").setInputFiles({
    name: "indicator-sprint-team.yaml",
    mimeType: "text/yaml",
    buffer: Buffer.from(YAML),
  });
  await page.getByRole("dialog", { name: "Import a team file" }).waitFor();
  await page.getByText(shown).waitFor();
  await page.waitForTimeout(200);
};

const HOME = {
  desktopBoard: false,
  path: "/#/home",
  init: morning,
};

export default [
  {
    name: "kept-teamcanvas-web",
    path: `/#/teams/${TEAM_ID}`,
    routes: panelRoutes({ over: NO_RUNS }),
    steps: canvasReady,
    settle: 600,
  },
  {
    name: "kept-teamcanvas-desktop",
    path: `/#/teams/${TEAM_ID}`,
    routes: panelRoutes({ keys: [], subs: ["claude", "grok"], over: NO_RUNS }),
    desktop: true,
    init: SEEN,
    steps: canvasReady,
    settle: 600,
  },
  // The toolbar's Team file opens the panel on YAML.
  ...pair("File-Panel", {
    path: `/#/teams/${TEAM_ID}`,
    routes: teamRoutes(TEAM_ID, TEAM_NAME, false),
    desktopRoutes: teamRoutes(TEAM_ID, TEAM_NAME, true),
    steps: async (page) => {
      await canvasReady(page);
      await page.getByRole("button", { name: "Team file" }).click();
      await page.getByText("48 lines").waitFor();
    },
  }),
  // Home › New team: the dialog with "Import a team file · .yaml or .json".
  ...pair("File-NewMenu", {
    ...HOME,
    routes: homeRoutes(),
    steps: async (page) => {
      await page.keyboard.press("t");
      await page.waitForSelector('[role="dialog"][aria-label="New team"]');
      await page.getByRole("button", { name: /Import a team file/ }).hover();
      await page.waitForTimeout(200);
    },
  }),
  ...pair("File-Check", {
    ...HOME,
    routes: homeRoutes({ "POST /api/teams/import-check": CHECK }),
    steps: importFile,
  }),
  ...pair("File-CheckError", {
    ...HOME,
    routes: homeRoutes({ "POST /api/teams/import-check": CHECK_ERROR }),
    steps: importFile,
  }),
  // The new team's canvas right after Import (the session holds what the import returned).
  ...pair("File-Imported", {
    path: `/#/teams/${COPY_ID}`,
    routes: teamRoutes(COPY_ID, COPY_NAME, false),
    desktopRoutes: teamRoutes(COPY_ID, COPY_NAME, true),
    init: IMPORTED,
    steps: async (page) => {
      await canvasReady(page);
      await page.getByText("Imported as a new team").waitFor();
    },
  }),
  ...pair("File-Fixes", {
    path: `/#/teams/${COPY_ID}`,
    routes: teamRoutes(COPY_ID, COPY_NAME, false),
    desktopRoutes: teamRoutes(COPY_ID, COPY_NAME, true),
    init: IMPORTED_MORE,
    steps: async (page) => {
      await canvasReady(page);
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Team file" }).click();
      await page.getByText("48 lines").waitFor();
      await page.getByRole("button", { name: "Copy" }).click();
      await page.getByText("Copied indicator-sprint-team.yaml").waitFor();
      await page
        .getByRole("complementary", { name: "Team file" })
        .getByRole("button", { name: "Close" })
        .click();
      await page.getByText("4 things to fix before shipping").waitFor();
    },
  }),
  // The check still out (the route never answers), then a check that couldn't be made (a 500).
  ...pair("File-Checking", {
    ...HOME,
    routes: homeRoutes({
      "POST /api/teams/import-check": () => new Promise(() => {}),
    }),
    steps: importChecking("Checking…"),
  }).map((s) => ({
    ...s,
    name: s.name.replace("File-Checking", "File-Checking-pending"),
  })),
  ...pair("File-Checking", {
    ...HOME,
    routes: homeRoutes({
      "POST /api/teams/import-check": () => ({
        status: 500,
        json: { detail: "boom" },
      }),
    }),
    steps: importChecking("Couldn’t check the file — is the backend running?"),
  }).map((s) => ({
    ...s,
    name: s.name.replace("File-Checking", "File-Checking-failed"),
  })),
];
