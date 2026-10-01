// Toolkit › Connectors page (Cn-Screens-1..5, split from the Cn-Screens board by
// split-composite.py) — website and Desktop renders of each frame.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-cn/app scripts/design-parity/scenarios/connectors-page.mjs
// Names are `<Frame>-web` / `<Frame>-desktop`. The frames are drawn on the website: Desktop renders
// sit 30px lower ("only moved").
import { SUPABASE, connectorsRoutes, detail, pair } from "./connectors-fixtures.mjs";

const idle = async (page) => page.mouse.move(0, 0);
const min = (m) => new Date(Date.now() - m * 60_000).toISOString();

/** Cn-Screens-3: the page scrolled so "From the MCP Registry" sits where the frame draws it. */
const toRegistry = async (page) => {
  const head = page.getByRole("heading", { name: "From the MCP Registry" });
  await head.waitFor();
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((e) => e.textContent === "From the MCP Registry");
    let el = h.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible")) el = el.parentElement;
    (el ?? document.scrollingElement).scrollTop += h.getBoundingClientRect().y - 484;
  });
  await idle(page);
};

const row = (node_id, role_name) => ({
  node_id,
  role_name,
  title: null,
  team_id: "t-sprint",
  team_name: "Indicator sprint team",
  access: "read",
});
const TOOLS = [
  ["list_tables", false, true],
  ["execute_sql", false, true],
  ["get_logs", false, true],
  ["get_advisors", false, true],
  ["list_migrations", false, true],
  ["apply_migration", true, false],
  ["create_branch", true, false],
  ["deploy_edge_function", true, false],
].map(([name, write, on]) => ({ name, title: null, write, on }));
export const SUPABASE_DETAIL = {
  ...detail(SUPABASE),
  tools: TOOLS,
  used_by_agents: [row("n-eng", "Engineer"), row("n-rev", "Reviewer")],
  recent_use: [
    { run_id: "r42", run_number: 42, agent: "Reviewer", reads: 6, writes: 0, at: min(12) },
    { run_id: "r41", run_number: 41, agent: "Engineer", reads: 3, writes: 0, at: min(120) },
    { run_id: "r39", run_number: 39, agent: "Reviewer", reads: 4, writes: 0, at: min(60 * 26) },
  ],
};

export default [
  // Connected tab.
  ...pair("Cn-Screens-1", { path: "/#/toolkit/connectors", routes: connectorsRoutes(), steps: idle }),
  // Browse tab: Featured.
  ...pair("Cn-Screens-2", { path: "/#/toolkit/connectors/browse", routes: connectorsRoutes(), steps: idle }),
  // Browse tab, scrolled: From the MCP Registry.
  ...pair("Cn-Screens-3", { path: "/#/toolkit/connectors/browse", routes: connectorsRoutes(), steps: toRegistry }),
  // First time: nothing connected, so the Connected tab lands on Browse.
  ...pair("Cn-Screens-4", { path: "/#/toolkit/connectors", routes: connectorsRoutes({ connections: [] }), steps: idle }),
  // One connector: Supabase.
  ...pair("Cn-Screens-5", {
    path: `/#/toolkit/connectors/${SUPABASE.id}`,
    routes: connectorsRoutes({ over: { "GET /api/connectors/:id": SUPABASE_DETAIL } }),
    steps: idle,
  }),
];
