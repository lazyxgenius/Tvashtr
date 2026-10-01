// Giving agents a connector (CnF-Agents-1..11, split from the CnF-Agents board by
// split-composite.py) — website and Desktop renders of each frame.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-cn/app scripts/design-parity/scenarios/connectors-agents.mjs
// The drawer frames (1–7, 10, 11) are the team canvas with the Reviewer's drawer, drawn on the
// website: their Desktop renders are framed 30px up, as the panel's Web-Skills. 8–9 are Supabase's
// page: their Desktop renders sit 30px lower ("only moved").
import { FEATURED, LINEAR, NOTION, SUPABASE, conn, connectorsRoutes, pair as cnPair } from "./connectors-fixtures.mjs";
import { CONNECTIONS, READ_HISTORY, READ_ROUND, call, toConnectors } from "./connectors-drawer.mjs";
import { NODES, TEAM_ID, drawerReady } from "./panel-fixtures.mjs";
import { SUPABASE_DETAIL } from "./connectors-page.mjs";
import { SKILLS, TOOLS, aboveTitleStrip, at, pair, reviewer, routes } from "./panel-skills.mjs";

const NEON = conn(FEATURED.find((e) => e.key === "neon"));
const withGrants = (grants) =>
  reviewer({ skills: SKILLS, tool_config: { ...TOOLS, tvashtr: { ...TOOLS.tvashtr, connectors: grants } } });
const NONE = reviewer({ skills: SKILLS, tool_config: TOOLS });
const SB_NO = [{ id: SUPABASE.id, access: "read" }, { id: NOTION.id, access: "read" }];
const drawerRoutes = (rev, over = {}) => routes(rev, { "GET /api/connectors": { connections: CONNECTIONS }, ...over });

const tick = (...names) => async (page) => {
  // The checkbox input is visually hidden behind its drawn box: click it in the page.
  for (const name of names) await page.getByRole("checkbox", { name }).evaluate((el) => el.click());
  await page.waitForTimeout(200);
  await page.mouse.move(0, 0);
};
const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };
const connectAnApp = async (page) => {
  await page.getByRole("button", { name: "Connect an app" }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(400);
  await page.mouse.move(0, 0);
};

// CnF-Agents-7: Neon connects without a project picker here (the fixture's Neon has none) and the
// connection list then holds it.
const neonFlow = () => {
  const list = [...CONNECTIONS];
  return drawerRoutes(withGrants(SB_NO), {
    "GET /api/connectors": () => ({ json: { connections: list } }),
    "GET /api/connectors/catalog": connectorsRoutes({ connections: CONNECTIONS })["GET /api/connectors/catalog"],
    "POST /api/connectors": () => {
      if (!list.includes(NEON)) list.unshift(NEON);
      return { json: NEON };
    },
  });
};

const NEON_STEPS = {
  path: at("skills"),
  steps: seq(toConnectors, connectAnApp, async (p) => {
    await p.getByRole("dialog").getByRole("button", { name: "Connect Neon" }).click();
    await p.getByRole("button", { name: /^Continue to / }).click();
    await p.getByText("Neon is connected and ticked").waitFor();
    await p.mouse.move(0, 0);
  }),
};

// The Supabase page (8, 9): Reviewer has it; Give an agent access lists the sprint team.
const agent = (n, enabled) => ({
  node_id: n.id,
  role_name: n.role_name,
  title: n.title ?? null,
  kind: n.kind,
  edits_allowed: Boolean(n.edits_allowed),
  enabled,
  access: enabled ? "read" : null,
  subscription: null,
});
const usage = (n, role) => ({ node_id: n.id, role_name: role, title: null, team_id: TEAM_ID, team_name: "Indicator sprint team", access: "read" });
const pageDetail = (users) => ({
  ...SUPABASE_DETAIL,
  used_by: { agent_count: users.length, team_count: 1 },
  used_by_agents: users,
});
const pageRoutes = (users) =>
  connectorsRoutes({
    over: {
      "GET /api/connectors/:id": pageDetail(users),
      "GET /api/connectors/:id/agents": {
        teams: [
          {
            team_id: TEAM_ID,
            team_name: "Indicator sprint team",
            agents: [agent(NODES.pm, false), agent(NODES.eng, false), agent(NODES.rev, true)],
          },
        ],
      },
    },
  });
const REV_ONLY = [usage(NODES.rev, "Reviewer")];
const BOTH = [usage(NODES.eng, "Engineer"), usage(NODES.rev, "Reviewer")];

// CnF-Agents-11: a write (Linear create_issue) listed first and marked.
const WRITE_HISTORY = {
  ...READ_HISTORY,
  run: {
    ...READ_HISTORY.run,
    rounds: [
      {
        ...READ_ROUND,
        outcome_detail:
          "Approved. I filed the RSI rounding edge case as a follow-up in Linear instead of blocking this change.",
        connectors: {
          used: [
            { connection_id: LINEAR.id, name: "Linear", slug: "linear", reads: 0, writes: 1 },
            { connection_id: SUPABASE.id, name: "Supabase", slug: "supabase", reads: 6, writes: 0 },
            { connection_id: NOTION.id, name: "Notion", slug: "notion", reads: 1, writes: 0 },
          ],
          calls: [
            {
              ...call(LINEAR, "create_issue", "“Follow-up: RSI rounds to 1 dp at the 70 boundary”", "10:06", 900),
              write: true,
              result_url: "https://linear.app/trade-mcp/issue/LIN-214",
            },
            call(SUPABASE, "execute_sql", "SELECT count(*) FROM indicator_values WHERE name = 'rsi_14'", "10:04", 300),
            call(NOTION, "fetch", "“Indicator sprint · spec v3”", "10:02", 1200),
          ],
          total_calls: 8,
          skipped: [],
        },
      },
      ...READ_HISTORY.run.rounds.slice(1),
    ],
  },
};
const runsAt = (history, rev) =>
  drawerRoutes(rev, { [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: history });
const runsReady = async (p) => {
  await drawerReady(p);
  await p.getByText("Connectors used this round").waitFor();
  await p.mouse.move(0, 0);
};
const LINEAR_GRANT = [...SB_NO, { id: LINEAR.id, access: "write" }];

export default [
  // 1 · Reviewer › Skills & tools: nothing ticked.
  ...pair("CnF-Agents-1", { path: at("skills"), steps: toConnectors }, drawerRoutes(NONE), aboveTitleStrip),
  // 2 · Tick Supabase and Notion.
  ...pair("CnF-Agents-2", { path: at("skills"), steps: seq(toConnectors, tick("Supabase", "Notion")) }, drawerRoutes(NONE), aboveTitleStrip),
  // 3 · Linear allows writes: pick for this agent.
  ...pair("CnF-Agents-3", { path: at("skills"), steps: seq(toConnectors, tick("Supabase", "Notion", "Linear")) }, drawerRoutes(NONE), aboveTitleStrip),
  // 4 · Saved.
  ...pair("CnF-Agents-4", { path: at("skills"), steps: toConnectors }, drawerRoutes(withGrants([...SB_NO, { id: LINEAR.id, access: "read" }])), aboveTitleStrip),
  // 5 · Reviewer needs Neon: click Connect an app (Supabase and Notion ticked).
  ...pair("CnF-Agents-5", { path: at("skills"), steps: toConnectors }, drawerRoutes(withGrants(SB_NO)), aboveTitleStrip),
  // 6 · Pick Neon (the Connect an app dialog).
  ...pair(
    "CnF-Agents-6",
    { path: at("skills"), steps: seq(toConnectors, connectAnApp) },
    drawerRoutes(withGrants(SB_NO), { "GET /api/connectors/catalog": connectorsRoutes({ connections: CONNECTIONS })["GET /api/connectors/catalog"] }),
    aboveTitleStrip,
  ),
  // 7 · Back: Neon is ticked for Reviewer (connect → Continue → connected). Each render gets its
  // own connection list (the connect adds Neon to it).
  ...[0, 1].map((i) => pair("CnF-Agents-7", NEON_STEPS, neonFlow(), aboveTitleStrip)[i]),
  // 8 · Supabase › Give an agent access.
  ...cnPair("CnF-Agents-8", {
    path: `/#/toolkit/connectors/${SUPABASE.id}`,
    routes: pageRoutes(REV_ONLY),
    steps: async (p) => {
      await p.getByRole("button", { name: "Give an agent access" }).click();
      await p.getByRole("dialog").waitFor();
      await p.waitForTimeout(400);
      await p.mouse.move(0, 0);
    },
  }),
  // 9 · Saved: Engineer and Reviewer.
  ...cnPair("CnF-Agents-9", { path: `/#/toolkit/connectors/${SUPABASE.id}`, routes: pageRoutes(BOTH), steps: async (p) => p.mouse.move(0, 0) }),
  // 10 · Runs tab: connectors used this round (the same frame as Cn-Screens-7).
  ...pair("CnF-Agents-10", { path: at("runs"), steps: runsReady }, runsAt(READ_HISTORY, withGrants(SB_NO)), aboveTitleStrip),
  // 11 · A write is listed first and marked.
  ...pair("CnF-Agents-11", { path: at("runs"), steps: runsReady }, runsAt(WRITE_HISTORY, withGrants(LINEAR_GRANT)), aboveTitleStrip),
];
