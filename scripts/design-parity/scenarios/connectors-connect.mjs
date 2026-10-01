// Toolkit › Connectors › the connect sheets (CnF-Connect-1..15, split from the CnF-Connect board by
// split-composite.py) — website and Desktop renders of each frame.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-cn/app scripts/design-parity/scenarios/connectors-connect.mjs
// Names are `<Frame>-web` / `<Frame>-desktop`. The frames are drawn on the website (no title strip):
// Desktop renders sit 30px lower ("only moved"). The sign-in window is stubbed (never loads the
// provider); CnF-Connect-10 stubs it as blocked.
import {
  APIFY,
  APIFY_ENTRY,
  LINEAR,
  NOTION,
  POPUP_BLOCKED,
  POSTHOG,
  SUPABASE,
  SUPABASE_ENTRY,
  conn,
  connectorsRoutes,
  detail,
  pair,
} from "./connectors-fixtures.mjs";

const BROWSE = "/#/toolkit/connectors/browse";
const CONNECTED = "/#/toolkit/connectors";
const SHEET = 'aside[role="dialog"]';
const THREE = [NOTION, LINEAR, POSTHOG]; // before Supabase is connected
const NEW_SUPABASE = conn(SUPABASE_ENTRY, { id: "c-supabase", status: "pending", signin_pending: true, scope: null });
const ACME = conn(
  { ...APIFY_ENTRY, key: "acme-metrics", name: "acme-metrics", host: "mcp.acme.dev", auth: "oauth", key_fields: [], reviewed: false, featured: false, publisher: null, scope_picker: null },
  { id: "c-acme", status: "pending", signin_pending: true },
);

const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };
const idle = async (page) => page.mouse.move(0, 0);
const connectOn = (name) => async (page) => {
  // A Featured card (an article) or a registry row.
  await page
    .locator("article, li.cn-reg__row")
    .filter({ has: page.getByText(name, { exact: true }) })
    .getByRole("button", { name: "Connect", exact: true })
    .click();
  await page.waitForSelector(SHEET);
};
const click = (name) => async (page) => {
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForTimeout(300);
};
const search = (text) => async (page) => {
  const box = page.getByPlaceholder(/Search .*connectors/);
  await box.fill(text);
  await box.blur();
  await page.waitForTimeout(600);
};
const custom = async (page) => {
  await page.getByRole("button", { name: "Custom connector" }).first().click();
  await page.waitForSelector(SHEET);
  await page.getByLabel("Name").fill("acme-metrics");
  await page.getByLabel("Server address").fill("https://mcp.acme.dev/mcp");
};
const refuse = (code, message) => () => ({ status: 400, json: { detail: { code, message } } });

/** A sign-in that is still waiting: POST pending, start answers, the poll says pending. */
const waiting = (c) => ({
  "POST /api/connectors": { ...c },
  "POST /api/connectors/:id/oauth/start": {
    authorize_url: `https://${c.signin_host}/v1/oauth/authorize?client_id=tvashtr`,
    signin_host: c.signin_host,
    expires_in: 600,
  },
  "GET /api/connectors/:id": { json: detail(c) },
});
const fix = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.json ? () => v : v]));

const SCOPES = {
  param: "project_ref",
  label: "Project",
  manual: false,
  options: [
    { value: "abcd1234", label: "trade-mcp-prod", detail: "ap-southeast-1 · 14 tables" },
    { value: "efgh5678", label: "trade-mcp-staging", detail: "ap-southeast-1 · 14 tables" },
    { value: "ijkl9012", label: "landing-page", detail: "us-east-1 · 3 tables" },
  ],
};

export default [
  // 1 · Browse: click Connect on Supabase (Connected 3: Notion, Linear, PostHog).
  ...pair("CnF-Connect-1", { path: BROWSE, routes: connectorsRoutes({ connections: THREE }), steps: idle }),
  // 2 · Choose what agents may do.
  ...pair("CnF-Connect-2", {
    path: BROWSE,
    routes: connectorsRoutes({ connections: THREE }),
    steps: seq(connectOn("Supabase"), idle),
  }),
  // 3 · Waiting for the Supabase window (the frame also draws the provider's page beside it).
  ...pair("CnF-Connect-3", {
    path: BROWSE,
    routes: connectorsRoutes({ connections: THREE, over: fix(waiting(NEW_SUPABASE)) }),
    steps: seq(connectOn("Supabase"), click("Continue to Supabase"), idle),
  }),
  // 4 · Back in Tvashtr: pick the project (the sign-in came back connected).
  ...pair("CnF-Connect-4", {
    path: BROWSE,
    routes: connectorsRoutes({
      connections: THREE,
      over: {
        "POST /api/connectors": { ...NEW_SUPABASE, status: "connected", signin_pending: false },
        "GET /api/connectors/:id/scope-options": SCOPES,
      },
    }),
    steps: seq(connectOn("Supabase"), click("Continue to Supabase"), idle),
  }),
  // 5 · Connected; no agent has it yet.
  ...pair("CnF-Connect-5", {
    path: CONNECTED,
    routes: connectorsRoutes({ connections: [{ ...SUPABASE, used_by: { agent_count: 0, team_count: 0 } }, NOTION, LINEAR, POSTHOG] }),
    steps: idle,
  }),
  // 6 · Search "apify": it's in the Registry.
  ...pair("CnF-Connect-6", { path: BROWSE, routes: connectorsRoutes(), steps: seq(search("apify"), idle) }),
  // 7 · It asks for a key, and says it isn't reviewed.
  ...pair("CnF-Connect-7", {
    path: BROWSE,
    routes: connectorsRoutes(),
    steps: seq(search("apify"), connectOn("Apify"), async (p) => p.getByLabel("API key").fill("apify_api_x7Kq2mVn9RtLw4"), idle),
  }),
  // 8 · Apify didn't accept the key.
  ...pair("CnF-Connect-8", {
    path: BROWSE,
    routes: connectorsRoutes({ over: { "POST /api/connectors": refuse("key_rejected", "Apify didn’t accept the key.") } }),
    steps: seq(
      search("apify"),
      connectOn("Apify"),
      async (p) => p.getByLabel("API key").fill("apify_api_x7Kq2mVn9RtLw4"),
      click("Check and connect"),
      idle,
    ),
  }),
  // 9 · Pasted again: connected, read only (Apify listed first, as drawn).
  ...pair("CnF-Connect-9", {
    path: CONNECTED,
    routes: connectorsRoutes({ connections: [APIFY, SUPABASE, NOTION, LINEAR, POSTHOG] }),
    steps: idle,
  }),
  // 10 · The browser blocked the window.
  ...pair("CnF-Connect-10", {
    path: BROWSE,
    popup: POPUP_BLOCKED,
    routes: connectorsRoutes({ connections: THREE, over: fix(waiting(NEW_SUPABASE)) }),
    steps: seq(connectOn("Supabase"), click("Continue to Supabase"), idle),
  }),
  // 11 · You pressed Deny on Supabase: the poll comes back with the provider's refusal.
  ...pair("CnF-Connect-11", {
    path: BROWSE,
    routes: connectorsRoutes({
      connections: THREE,
      over: fix({
        ...waiting(NEW_SUPABASE),
        "GET /api/connectors/:id": {
          json: detail({ ...NEW_SUPABASE, signin_pending: false, last_error: "You didn’t allow access on Supabase." }),
        },
      }),
    }),
    steps: seq(connectOn("Supabase"), click("Continue to Supabase"), async (p) => p.waitForTimeout(2600), idle),
  }),
  // 12 · A custom server Tvashtr can't register with.
  ...pair("CnF-Connect-12", {
    path: CONNECTED,
    routes: connectorsRoutes({
      over: { "POST /api/connectors": refuse("cannot_register", "acme-metrics needs an app registered with it.") },
    }),
    steps: seq(custom, click("Check the server"), idle),
  }),
  // 13 · Paste the server address.
  ...pair("CnF-Connect-13", { path: CONNECTED, routes: connectorsRoutes(), steps: seq(custom, idle) }),
  // 14 · It signs in at another site: check where, then continue.
  ...pair("CnF-Connect-14", {
    path: CONNECTED,
    routes: connectorsRoutes({
      over: fix(waiting({ ...ACME, signin_host: "auth.acme.dev", signin_host_differs: true })),
    }),
    steps: seq(custom, click("Check the server"), idle),
  }),
  // 15 · Or: no sign-in, so it goes in Tools.
  ...pair("CnF-Connect-15", {
    path: CONNECTED,
    routes: connectorsRoutes({
      over: {
        "POST /api/connectors": refuse(
          "no_signin",
          "This server didn’t offer an OAuth sign-in. If it takes a key, add it in Tools and keep the key as a secret. Its tools then work the same way.",
        ),
      },
    }),
    steps: seq(custom, click("Check the server"), idle),
  }),
];
