// M6 — my agents and recent tasks (Team Setup › Agents-Save, Agents-Menu, Agents-Use, Agents-More,
// Agents-Library, Agents-Page, Agents-Rename, Agents-Delete, Agents-UseInTeam, Agents-Recent).
// Each board renders as a website and a Desktop render (versions.mjs's `pair`): Agents-Save, -Menu,
// -Use and -More are drawn in Desktop (the 30px title strip: the Desktop render is the comparison,
// the web render is framed 30px down); Agents-Library, -Page, -Rename, -Delete, -UseInTeam and
// -Recent are website boards (the web render is the comparison, the Desktop render is framed 30px
// up). `kept-toolkit-skills-*` capture Toolkit › Skills (the nav gains "My agents"). The sample data
// is the boards' (docs/superpowers/plans/api/my-agents.md's shapes): team "Indicator sprint team",
// v7, the saved agents Strict reviewer (v2, used in Indicator sprint team v2 and Bugfix squad v1)
// and Spec writer (v1).
import { homeRoutes, morning } from "./home-fixtures.mjs";
import { ago, NODES, TEAM_ID } from "./panel-fixtures.mjs";
import {
  frozenClock,
  LIBRARY,
  skillsRoutes,
} from "./toolkit-skills-memory-fixtures.mjs";
import { canvasReady, pair, teamRoutes } from "./versions.mjs";

const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
const DAY = 1440;

// ---- The saved agents (Agents-Library) ----
const STRICT = {
  id: "a-strict",
  name: "Strict reviewer",
  purpose:
    "Reviews Python changes against the spec. Fails the round if a new indicator isn’t registered.",
  latest: 2,
  updated_at: ago(DAY + 60),
  built_on: "Reviewer",
  model: "xai/grok-4.7",
  skills: 2,
  tools: 1,
  file_access: "read-only",
  versions: [
    {
      number: 2,
      created_at: ago(DAY + 60),
      included: ["instructions", "model"],
    },
    {
      number: 1,
      created_at: ago(6 * DAY),
      included: ["instructions", "model"],
    },
  ],
  used_in: [
    {
      team_id: "t-ind",
      team_name: "Indicator sprint team",
      version: 2,
      node_ids: ["n-rev"],
    },
    {
      team_id: "t-bug",
      team_name: "Bugfix squad",
      version: 1,
      node_ids: ["n-bug-rev"],
    },
  ],
  behind: [{ team_id: "t-bug", team_name: "Bugfix squad", version: 1 }],
};
const SPEC = {
  id: "a-spec",
  name: "Spec writer",
  purpose:
    "Turns a one-line idea into a one-page spec with tests to write and what is out of scope.",
  latest: 1,
  updated_at: ago(4 * DAY + 60),
  built_on: "Product manager",
  model: "xai/grok-4.7",
  skills: 1,
  tools: 0,
  file_access: null,
  versions: [
    { number: 1, created_at: ago(4 * DAY + 60), included: ["instructions"] },
  ],
  used_in: [
    {
      team_id: "t-docs",
      team_name: "Docs team",
      version: 1,
      node_ids: ["n-docs-pm"],
    },
  ],
  behind: [],
};
// Agents-Menu draws Spec writer as "v1" (no team yet).
const MENU_AGENTS = [STRICT, { ...SPEC, used_in: [] }];

// ---- The Reviewer on the boards' canvas ----
const TEMPLATE = (key, title, role_name = key) => ({
  key,
  title,
  description: "",
  summary: "",
  role_name,
  node_kind: key === "pm" || key === "architect" ? "thinker" : "worker",
  edits_allowed: key === "engineer",
  writes_to: null,
  verdict_labels: [],
  prompt: `You are the ${title}.`,
});
const TEMPLATES = [
  TEMPLATE("pm", "Product manager"),
  TEMPLATE("architect", "Architect"),
  TEMPLATE("engineer", "Engineer"),
  TEMPLATE("reviewer", "Reviewer"),
];
// Agents-Save: "Skills (2) and tools (1)".
const ONE_TOOL = {
  mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } },
};
const STRICT_PROMPT = [
  "You are a strict Reviewer for Python changes. Review the engineer’s build against the spec. Do NOT improve it.",
  "",
  "1. List what the spec asks for.",
  "2. Run the tests: python -m pytest -q",
  "3. Check every item. Name the file and line for each problem.",
  "4. Fail the round if any new indicator is not registered on INDICATORS.",
  "5. Approve only when everything passes.",
].join("\n");
const note = (id, content) => ({
  id,
  content,
  polarity: "context",
  status: "active",
  tier: "node",
  pinned: false,
  created_at: ago(DAY),
  updated_at: ago(DAY),
});
const NOTES = [
  note("m-1", "Run pytest with -q so the output fits the verdict."),
  note("m-2", "The indicator registry lives in indicators/__init__.py."),
  note("m-3", "Check the indicator is listed on INDICATORS."),
];

/** The canvas with the Reviewer's drawer open; `used` flips once use-agent is posted. */
function canvasRoutes(desktop, { agents = MENU_AGENTS } = {}) {
  let used = false;
  const base = teamRoutes(desktop);
  const graphKey = `GET /api/teams/${TEAM_ID}/graph`;
  const versionsKey = `GET /api/teams/${TEAM_ID}/versions`;
  const withRev = (rev) => ({
    ...base[graphKey],
    nodes: base[graphKey].nodes.map((n) =>
      n.id === "n-rev" ? { ...n, ...rev } : n,
    ),
  });
  const plain = { tool_config: ONE_TOOL };
  const based = {
    tool_config: ONE_TOOL,
    prompt: STRICT_PROMPT,
    config: {
      ...NODES.rev.config,
      based_on: { id: STRICT.id, name: STRICT.name, version: 2 },
    },
  };
  return {
    ...base,
    [graphKey]: () => ({ json: withRev(used ? based : plain) }),
    [versionsKey]: () => ({
      json: { ...base[versionsKey], changes: used ? 1 : 0 },
    }),
    "GET /api/node-templates": { templates: TEMPLATES },
    "GET /api/memories": (req) => ({
      json: {
        memories:
          new URL(req.url()).searchParams.get("node_id") === "n-rev" &&
          new URL(req.url()).searchParams.get("status") !== "pending_review"
            ? NOTES
            : [],
      },
    }),
    "GET /api/my-agents": { agents },
    [`POST /api/teams/${TEAM_ID}/nodes/n-rev/use-agent`]: () => {
      used = true;
      return {
        json: {
          node: withRev(based).nodes.find((n) => n.id === "n-rev"),
          before: { prompt: NODES.rev.prompt },
          text: "Reviewer now uses Strict reviewer v2",
        },
      };
    },
  };
}
const drawer = (page) =>
  page.getByRole("complementary", { name: "Reviewer settings" });
const settle = async (page) => {
  await page.mouse.move(700, 880); // no hover state
  await page.waitForTimeout(250);
};
/** The Reviewer's drawer, then `then`. */
const reviewer =
  (then = async () => {}) =>
  async (page) => {
    await canvasReady(page);
    await drawer(page).waitFor();
    await page.waitForTimeout(250);
    await then(page);
  };
const reviewerBoard = (board, then, opts = {}) =>
  pair(board, {
    path: `/#/teams/${TEAM_ID}?node=n-rev`,
    routes: canvasRoutes(false, opts),
    desktopRoutes: canvasRoutes(true, opts),
    steps: reviewer(then),
  });

// ---- Toolkit › My agents (website boards) ----
const TEAMS = [
  { team_graph_id: "t-docs", name: "Docs team", node_count: 3, last_run: null },
  {
    team_graph_id: "t-ind",
    name: "Indicator sprint team",
    node_count: 5,
    last_run: null,
  },
  {
    team_graph_id: "t-bug",
    name: "Bugfix squad",
    node_count: 4,
    last_run: null,
  },
];
const toolkitRoutes = () => ({
  ...skillsRoutes({ library: LIBRARY }),
  "GET /api/my-agents": { agents: [STRICT, SPEC] },
  "GET /api/teams": { teams: TEAMS },
  // Agents-Page's nav: Tools 3, Skills 3, My agents 2, Memory 2 new, Secrets 1 missing.
  "GET /api/toolkit/summary": {
    tools: 3,
    tools_needing_attention: 0,
    skills: 3,
    memory: { inbox: 2, active: 14, archive: 0 },
    secrets_missing: 1,
    connectors: 0,
    connectors_needing_attention: 0,
  },
});
const page = (board, then = async () => {}) =>
  pair(board, {
    desktopBoard: false,
    path: "/#/toolkit/agents",
    routes: toolkitRoutes(),
    init: frozenClock,
    steps: async (p) => {
      await p.getByRole("article", { name: "Strict reviewer" }).waitFor();
      await then(p);
      await settle(p);
    },
  });
const more = async (p) => {
  await p.getByRole("button", { name: "More for Strict reviewer" }).click();
  await p.getByRole("menu", { name: "More for Strict reviewer" }).waitFor();
};

// ---- Home › Recent tasks (Agents-Recent) ----
const task = (text, status, number, minutes) => ({
  task: text,
  team: { id: "t-ind", name: "Indicator sprint team" },
  status,
  status_group: status,
  run_id: `r-${number}`,
  number,
  created_at: ago(minutes),
});
const RECENT = [
  task("Add an RSI indicator", "completed", 12, 120),
  task("Add a MACD indicator", "running", 14, 0),
  task("Add a VWAP indicator", "failed", 11, DAY + 60),
  task("Add an ATR indicator", "cancelled", 9, 4 * DAY + 60),
];

export default [
  {
    name: "kept-toolkit-skills-web",
    path: "/#/toolkit/skills",
    routes: skillsRoutes({ library: LIBRARY }),
    init: frozenClock,
    steps: (p) => p.waitForSelector(".sk-table tbody tr"),
    settle: 600,
  },
  {
    name: "kept-toolkit-skills-desktop",
    path: "/#/toolkit/skills",
    routes: skillsRoutes({ library: LIBRARY }),
    desktop: true,
    init: `${SEEN}${frozenClock}`,
    steps: (p) => p.waitForSelector(".sk-table tbody tr"),
    settle: 600,
  },
  // Agents-Save: More › Save as my agent, the board's name and words typed in.
  ...reviewerBoard(
    "Agents-Save",
    async (p) => {
      await drawer(p).getByRole("button", { name: "More actions" }).click();
      await p.getByRole("menuitem", { name: "Save as my agent" }).click();
      const dialog = p.getByRole("dialog", {
        name: "Save Reviewer as my agent",
      });
      await dialog.getByLabel("Name").fill("Strict reviewer");
      await dialog.getByLabel("What it’s for").fill(STRICT.purpose);
      await p.evaluate(() => document.activeElement?.blur());
      await settle(p);
    },
    { agents: [] },
  ),
  ...reviewerBoard("Agents-Menu", async (p) => {
    await drawer(p).getByRole("button", { name: "Templates" }).click();
    await p.getByRole("menuitem", { name: "Strict reviewer" }).waitFor();
    // The board's highlighted row is a hover; the app's hover governs (no hover drawn here).
    await settle(p);
  }),
  ...reviewerBoard("Agents-Use", async (p) => {
    await drawer(p).getByRole("button", { name: "Templates" }).click();
    await p.getByRole("menuitem", { name: "Strict reviewer" }).click();
    await drawer(p)
      .getByText("Its memory and routes stay with this team")
      .waitFor();
    await p.getByText("Reviewer now uses Strict reviewer v2").waitFor();
    // The board draws the drawer unscrolled (picking the item scrolled it).
    await p.evaluate(() => document.querySelector(".nd-body")?.scrollTo(0, 0));
    await p.mouse.move(700, 600);
    await p.waitForTimeout(250);
  }),
  ...reviewerBoard("Agents-More", async (p) => {
    await drawer(p).getByRole("button", { name: "More actions" }).click();
    // The board highlights Save as my agent.
    await p.getByRole("menuitem", { name: "Save as my agent" }).hover();
    await p.waitForTimeout(250);
  }),
  ...page("Agents-Library"),
  ...page("Agents-Page", more),
  ...page("Agents-Rename", async (p) => {
    await more(p);
    await p.getByRole("menuitem", { name: "Rename" }).click();
    await p.getByRole("dialog", { name: "Rename Strict reviewer" }).waitFor();
  }),
  ...page("Agents-Delete", async (p) => {
    await more(p);
    await p.getByRole("menuitem", { name: "Delete" }).click();
    await p.getByRole("dialog", { name: "Delete Strict reviewer?" }).waitFor();
  }),
  ...page("Agents-UseInTeam", async (p) => {
    await p
      .getByRole("article", { name: "Strict reviewer" })
      .getByRole("button", { name: "Use in a team" })
      .click();
    const dialog = p.getByRole("dialog", {
      name: "Use Strict reviewer in a team",
    });
    await dialog
      .getByRole("option", { name: "Bugfix squad" })
      .waitFor({ state: "attached" });
  }),
  ...pair("Agents-Recent", {
    desktopBoard: false,
    path: "/#/home",
    init: morning,
    routes: homeRoutes({ "GET /api/recent-tasks": { tasks: RECENT } }),
    steps: async (p) => {
      const box = p.getByRole("textbox", {
        name: "What should the team build?",
      });
      await box.click();
      await box.fill("Add a");
      await p.getByRole("listbox", { name: "Recent tasks" }).waitFor();
      // The board shows the first row chosen.
      await box.press("ArrowDown");
      await p.mouse.move(700, 880);
      await p.waitForTimeout(250);
    },
  }),
];
