// Connectors in an agent's drawer and on Desktop (Cn-Screens-6, Cn-Screens-9, split from the
// Cn-Screens board by split-composite.py) — website and Desktop renders of each frame.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-cn/app scripts/design-parity/scenarios/connectors-drawer.mjs
// Cn-Screens-6 is the team canvas with the Reviewer's Skills & tools tab scrolled to "Connectors"
// (Supabase and Notion ticked), drawn on the website: its Desktop render is framed 30px up, as the
// panel's Web-Skills. Cn-Screens-9 is the Connected tab drawn in Desktop (title strip): its web
// render sits 30px higher ("only moved").
import { LINEAR, NOTION, POSTHOG, SUPABASE, conn, connectorsRoutes, FEATURED, pair as cnPair } from "./connectors-fixtures.mjs";
import { SHELVES, SKILLS, TOOLS, aboveTitleStrip, at, pair, reviewer, routes } from "./panel-skills.mjs";
import { NODES, TEAM_ID, ago, drawerReady, panelRoutes } from "./panel-fixtures.mjs";
import { HISTORY } from "./panel-runs-docs.mjs";

const SENTRY = conn(FEATURED.find((e) => e.key === "sentry"));
export const CONNECTIONS = [SUPABASE, NOTION, LINEAR, POSTHOG, SENTRY];
const GRANTED = reviewer({
  skills: SKILLS,
  tool_config: {
    ...TOOLS,
    tvashtr: { ...TOOLS.tvashtr, connectors: [{ id: SUPABASE.id, access: "read" }, { id: NOTION.id, access: "read" }] },
  },
});

/** The drawer's tab scrolled so the Connectors heading sits where the frame draws it (y 421). */
export const toConnectors = async (page) => {
  await drawerReady(page);
  const head = page.getByText("Connectors this agent can use");
  await head.waitFor();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("span")].find((e) => e.textContent === "Connectors this agent can use");
    let el = h.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible")) el = el.parentElement;
    if (el) el.scrollTop += h.getBoundingClientRect().y - 460;
  });
  await page.mouse.move(0, 0);
};

// Cn-Screens-7: the Reviewer's last round approved, with what it read through connectors.
export const call = (c, tool, arg, hhmm, ms) => ({
  connection_id: c.id,
  name: c.name,
  tool,
  write: false,
  ok: true,
  forwarded: true,
  arg,
  at: `2026-10-01T${hhmm}:00`,
  duration_ms: ms,
});
const SQL = "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'indicator_values'";
export const READ_ROUND = {
  ...HISTORY.run.rounds[1],
  outcome: "approved",
  outcome_detail:
    "The RSI change matches the spec. The table already has the columns it writes, and `indicator_values` takes the new rows.",
  started_at: ago(14),
  ended_at: ago(12),
  connectors: {
    used: [
      { connection_id: SUPABASE.id, name: "Supabase", slug: "supabase", reads: 6, writes: 0 },
      { connection_id: NOTION.id, name: "Notion", slug: "notion", reads: 1, writes: 0 },
    ],
    calls: [
      call(NOTION, "fetch", "“Indicator sprint · spec v3”", "10:02", 1200),
      call(SUPABASE, "list_tables", "schema: public", "10:03", 400),
      call(SUPABASE, "execute_sql", SQL, "10:03", 600),
      call(SUPABASE, "execute_sql", "SELECT count(*) FROM indicator_values", "10:04", 500),
    ],
    total_calls: 7,
    skipped: [],
  },
};
export const READ_HISTORY = {
  runs: [{ ...HISTORY.runs[0], rounds_count: 2, last_outcome: "approved", last_round_at: ago(12) }, ...HISTORY.runs.slice(1)],
  run: { ...HISTORY.run, rounds: [READ_ROUND, HISTORY.run.rounds[2]] },
};

export default [
  ...pair(
    "Cn-Screens-6",
    { path: at("skills"), steps: toConnectors },
    routes(GRANTED, { "GET /api/connectors": { connections: CONNECTIONS } }),
    aboveTitleStrip,
  ),
  ...pair(
    "Cn-Screens-7",
    {
      path: at("runs"),
      steps: async (p) => {
        await drawerReady(p);
        await p.getByText("Connectors used this round").waitFor();
        await p.mouse.move(0, 0);
      },
    },
    routes(GRANTED, {
      "GET /api/connectors": { connections: CONNECTIONS },
      [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: READ_HISTORY,
    }),
    aboveTitleStrip,
  ),
  // Cn-Screens-8: the Reviewer on a Claude plan (Desktop only: a Claude Sonnet model, Claude
  // connected on this computer, no Anthropic key). The website render has no plan, so no note.
  ...pair(
    "Cn-Screens-8",
    { path: at("skills"), steps: toConnectors },
    panelRoutes({
      nodes: Object.values({ ...NODES, rev: { ...GRANTED, model: "anthropic/claude-sonnet-5" } }),
      keys: ["xai"],
      subs: ["claude"],
      over: { ...SHELVES, "GET /api/connectors": { connections: CONNECTIONS } },
    }),
    aboveTitleStrip,
  ),
  ...cnPair("Cn-Screens-9", { path: "/#/toolkit/connectors", routes: connectorsRoutes(), steps: async (p) => p.mouse.move(0, 0) }),
];
