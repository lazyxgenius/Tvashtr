// When a connection changes (CnF-Changes-1..7 and -10, split from the CnF-Changes board by
// split-composite.py) — website and Desktop renders of each frame.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-cn/app scripts/design-parity/scenarios/connectors-changes.mjs
// 1, 3–6 are the Connected tab drawn on the website (Desktop renders sit 30px lower, "only moved");
// 2 is the Reviewer's Runs tab on the canvas (Desktop framed 30px up, as the panel's Web-Runs);
// 7 and 10 are drawn in Desktop (their web renders sit 30px higher). 8–9 are the server's own
// sign-in callback pages, not frontend screens.
import { FEATURED, LINEAR, NOTION, POPUP_OK, POSTHOG, SUPABASE, conn, connectorsRoutes, pair } from "./connectors-fixtures.mjs";
import { READ_HISTORY, READ_ROUND, call } from "./connectors-drawer.mjs";
import { TEAM_ID, ago, drawerReady } from "./panel-fixtures.mjs";
import { SKILLS, TOOLS, aboveTitleStrip, at, pair as panelPair, reviewer, routes } from "./panel-skills.mjs";

const CONNECTED = "/#/toolkit/connectors";
const idle = async (page) => page.mouse.move(0, 0);
const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };

const SENTRY_OK = conn(FEATURED.find((e) => e.key === "sentry"), { used_by: { agent_count: 1, team_count: 1 } });
const SENTRY_EXPIRED = {
  ...SENTRY_OK,
  status: "needs_signin",
  last_error: "sign-in expired",
  used_by_agents: [
    { node_id: "n-rev", role_name: "Reviewer", title: null, team_id: TEAM_ID, team_name: "Indicator sprint team", access: "read" },
  ],
};
const FOUR = [SUPABASE, NOTION, LINEAR, POSTHOG];
const NEON = conn(FEATURED.find((e) => e.key === "neon"));
const withAttention = (connections) => {
  const r = connectorsRoutes({ connections });
  const toFix = connections.filter((c) => c.status === "needs_signin").length;
  r["GET /api/toolkit/summary"] = { ...r["GET /api/toolkit/summary"], connectors_needing_attention: toFix };
  return r;
};

const rowMenu = (name) => async (page) => {
  await page.getByRole("button", { name: `More actions for ${name}` }).click();
  await page.waitForTimeout(250);
  await page.mouse.move(0, 0);
};

// CnF-Changes-2: the round went ahead without Sentry.
const SKIPPED_HISTORY = {
  ...READ_HISTORY,
  runs: [{ ...READ_HISTORY.runs[0], rounds_count: 1, last_outcome: "changes_requested", last_round_at: ago(4) }, ...READ_HISTORY.runs.slice(1)],
  run: {
    ...READ_HISTORY.run,
    rounds: [
      {
        ...READ_ROUND,
        iteration: 1,
        outcome: "changes_requested",
        outcome_detail:
          "I couldn’t check Sentry for new errors, so I reviewed the change against the spec and the tests only. Sign in to Sentry again and rerun to cover it.",
        started_at: ago(6),
        ended_at: ago(4),
        connectors: {
          used: [
            { connection_id: NOTION.id, name: "Notion", slug: "notion", reads: 1, writes: 0 },
            { connection_id: SUPABASE.id, name: "Supabase", slug: "supabase", reads: 3, writes: 0 },
          ],
          calls: [
            call(NOTION, "fetch", "“Indicator sprint · spec v3”", "10:02", 1200),
            call(SUPABASE, "list_tables", "schema: public", "10:03", 400),
          ],
          total_calls: 4,
          skipped: [{ connection_id: SENTRY_OK.id, name: "Sentry", reason: "its sign-in expired" }],
        },
      },
    ],
  },
};
const REV = reviewer({
  skills: SKILLS,
  tool_config: {
    ...TOOLS,
    tvashtr: { ...TOOLS.tvashtr, connectors: [SUPABASE, NOTION, SENTRY_OK].map((c) => ({ id: c.id, access: "read" })) },
  },
});

// CnF-Changes-6: Supabase is gone once the DELETE answers.
const disconnectRoutes = () => {
  let gone = false;
  return connectorsRoutes({
    over: {
      "GET /api/connectors": () => ({ json: { connections: (gone ? [NOTION, LINEAR, POSTHOG] : FOUR).toReversed() } }),
      "DELETE /api/connectors/:id": () => {
        gone = true;
        return { json: { removed_from_agents: 2, revoked: true } };
      },
    },
  });
};

// CnF-Changes-7: Desktop connects Neon in the system browser; the sheet waits.
const NEW_NEON = { ...NEON, status: "pending", signin_pending: true };
const neonWaiting = () => {
  const r = connectorsRoutes();
  return {
    ...r,
    "POST /api/connectors": NEW_NEON,
    "POST /api/connectors/:id/oauth/start": {
      authorize_url: "https://mcp.neon.com/authorize?client_id=tvashtr",
      signin_host: "mcp.neon.com",
      expires_in: 600,
    },
    "GET /api/connectors/:id": () => ({ json: { ...NEW_NEON, used_by_agents: [], recent_use: [], revoke_hint: null } }),
  };
};

export default [
  // 1 · Connectors: Sentry needs you to sign in.
  ...pair("CnF-Changes-1", { path: CONNECTED, routes: withAttention([SENTRY_EXPIRED, ...FOUR]), steps: idle }),
  // 2 · A run went ahead without it and says so.
  ...panelPair(
    "CnF-Changes-2",
    {
      path: at("runs"),
      steps: async (p) => {
        await drawerReady(p);
        await p.getByText("Connectors used this round").waitFor();
        await idle(p);
      },
    },
    routes(REV, {
      "GET /api/connectors": { connections: [SENTRY_EXPIRED, ...FOUR] },
      [`GET /api/teams/${TEAM_ID}/nodes/n-rev/runs`]: SKIPPED_HISTORY,
    }),
    aboveTitleStrip,
  ),
  // 3 · Signed in again: all ready.
  ...pair("CnF-Changes-3", { path: CONNECTED, routes: connectorsRoutes({ connections: [SENTRY_OK, ...FOUR] }), steps: idle }),
  // 4 · ⋯ on Supabase: Disconnect.
  ...pair("CnF-Changes-4", { path: CONNECTED, routes: connectorsRoutes(), steps: rowMenu("Supabase") }),
  // 5 · Confirm: two agents lose access.
  ...pair("CnF-Changes-5", {
    path: CONNECTED,
    routes: connectorsRoutes({
      over: {
        "GET /api/connectors/:id": {
          ...SUPABASE,
          used_by_agents: ["n-eng", "n-rev"].map((node_id, i) => ({
            node_id,
            role_name: i ? "Reviewer" : "Engineer",
            title: null,
            team_id: TEAM_ID,
            team_name: "Indicator sprint team",
            access: "read",
          })),
          recent_use: [],
          revoke_hint: null,
        },
      },
    }),
    steps: seq(rowMenu("Supabase"), async (p) => {
      await p.getByRole("menuitem", { name: "Disconnect" }).click();
      await p.getByRole("alertdialog").waitFor();
      await p.waitForTimeout(400);
      await idle(p);
    }),
  }),
  // 6 · Disconnected (the toast). Each render gets its own list (the DELETE empties it).
  ...[0, 1].map(
    (i) =>
      pair("CnF-Changes-6", {
        path: CONNECTED,
        routes: disconnectRoutes(),
        steps: seq(rowMenu("Supabase"), async (p) => {
          await p.getByRole("menuitem", { name: "Disconnect" }).click();
          await p.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
          await p.getByText("Supabase is disconnected").waitFor();
          await idle(p);
        }),
      })[i],
  ),
  // 7 · Continue opens your browser (Desktop): the sheet waits for the browser.
  ...pair("CnF-Changes-7", {
    path: "/#/toolkit/connectors/browse",
    popup: POPUP_OK,
    routes: neonWaiting(),
    steps: async (p) => {
      await p
        .locator("article")
        .filter({ has: p.getByText("Neon", { exact: true }) })
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      await p.getByRole("button", { name: "Continue to Neon" }).click();
      await p.waitForTimeout(500);
      await idle(p);
    },
  }),
  // 10 · Back in the app: connected everywhere (Neon first, as drawn).
  ...pair("CnF-Changes-10", { path: CONNECTED, routes: connectorsRoutes({ connections: [NEON, ...FOUR] }), steps: idle }),
];
