// Toolkit › Tools › Add tool wizard, remote (slice F3, group G6) — website and Desktop renders of
// TkF-AddTool-1..7 and Toolkit-AddTool2 (= TkF-AddTool-2): name it linear, a remote URL with an
// Authorization header whose `${` picker creates LINEAR_TOKEN, the raw JSON, the Secrets step, the
// Turn-on dialog (Reviewer), and the added toast.
//
// Fixture note: the design adds linear while a linear row is already listed. POST
// /api/tool-library is create-only (spec Q1), so that would be a 409 ("You already have a tool
// named linear." on Next) — frames 2-7 start WITHOUT linear (fetch + github; GITHUB_TOKEN and
// SENTRY_TOKEN stored, nothing missing), so their background linear row and the "Tools 3" /
// "Installed 3" / "1 missing" badges are "not found in app"; frame 7 (after the add) has all three
// tools again. Frame 1 is before Next checks the name, so it keeps the design's list as drawn.
import {
  DESKTOP_INIT,
  FETCH,
  GITHUB,
  SECRETS,
  SUMMARY,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools";

const choice = (node_id, role_name, extra = {}) => ({
  node_id,
  role_name,
  title: null,
  kind: "agent",
  edits_allowed: true,
  enabled: false,
  overridden: false,
  ...extra,
});
// GET /api/agents (no tool yet): the design's teams, nobody using it.
const AGENT_TEAMS = {
  teams: [
    {
      team_id: "team-ind",
      team_name: "Indicator sprint team",
      agents: [
        choice("n-pm", "pm", { edits_allowed: false }),
        choice("n-eng", "engineer"),
        choice("n-rev", "reviewer"),
      ],
    },
    {
      team_id: "team-docs",
      team_name: "Docs team",
      agents: [choice("n-wri", "writer")],
    },
  ],
};
const TEAM_OF = Object.fromEntries(
  AGENT_TEAMS.teams.flatMap((t) =>
    t.agents.map((a) => [
      a.node_id,
      { ...a, team_id: t.team_id, team_name: t.team_name },
    ]),
  ),
);

const refsOf = (cfg) =>
  [
    ...new Set(
      Object.values({ ...(cfg.headers ?? {}), ...(cfg.env ?? {}) }).flatMap(
        (v) =>
          [...String(v).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
            (m) => m[1],
          ),
      ),
    ),
  ].sort();

/** Fresh routes per render: POST /api/secrets stores a name, POST /api/tool-library creates the
 *  tool (status from the stored names), PUT …/agents turns it on. */
function statefulRoutes() {
  let tools = [structuredClone(FETCH), structuredClone(GITHUB)];
  const secrets = { secrets: structuredClone(SECRETS.secrets), missing: [] };
  const statusOf = (t) => {
    const stored = new Set(secrets.secrets.map((s) => s.name));
    const missing = t.secret_refs.filter((n) => !stored.has(n));
    return {
      ...t,
      missing_secrets: missing,
      status: missing.length ? "needs_attention" : "ready",
    };
  };
  const summary = () => ({
    ...SUMMARY,
    tools: tools.length,
    tools_needing_attention: tools
      .map(statusOf)
      .filter((t) => t.status !== "ready").length,
    secrets_missing: tools.map(statusOf).flatMap((t) => t.missing_secrets)
      .length,
  });
  return {
    ...toolkitRoutes(),
    "GET /api/tool-library": () => ({ json: { tools: tools.map(statusOf) } }),
    "GET /api/secrets": () => ({ json: secrets }),
    "GET /api/toolkit/summary": () => ({ json: summary() }),
    "GET /api/agents": AGENT_TEAMS,
    "POST /api/secrets": (req) => {
      const { name } = req.postDataJSON();
      const at = new Date().toISOString();
      secrets.secrets.push({
        name,
        created_at: at,
        updated_at: at,
        used_by_tools: [],
      });
      return { status: 201, json: { name, created_at: at, updated_at: at } };
    },
    "POST /api/tool-library": (req) => {
      const { name, server_config } = req.postDataJSON();
      if (tools.some((t) => t.name === name)) {
        return {
          status: 409,
          json: { detail: `You already have a tool named ${name}.` },
        };
      }
      const at = new Date().toISOString();
      const created = {
        id: `tool-${name}`,
        name,
        server_config,
        created_at: at,
        updated_at: at,
        secret_refs: refsOf(server_config),
        missing_secrets: [],
        status: "ready",
        used_by: { agent_count: 0, team_count: 0 },
      };
      tools.push(created);
      return { status: 201, json: statusOf(created) };
    },
    "PUT /api/tool-library/:id/agents": (req) => {
      const id = decodeURIComponent(new URL(req.url()).pathname.split("/")[3]);
      const rows = req.postDataJSON().node_ids.map((n) => {
        const a = TEAM_OF[n];
        return {
          node_id: n,
          role_name: a.role_name,
          title: null,
          team_id: a.team_id,
          team_name: a.team_name,
        };
      });
      const teams = new Set(rows.map((r) => r.team_id)).size;
      tools = tools.map((t) =>
        t.id === id
          ? { ...t, used_by: { agent_count: rows.length, team_count: teams } }
          : t,
      );
      return {
        json: {
          agents: rows,
          agent_count: rows.length,
          team_count: teams,
          skipped: [],
        },
      };
    },
  };
}

/** A web + Desktop pair, each with fresh (stateful) routes. */
function pair(name, spec) {
  return [
    { name: `${name}-web`, routes: statefulRoutes(), ...spec },
    {
      name: `${name}-desktop`,
      routes: statefulRoutes(),
      ...spec,
      desktop: true,
      init: DESKTOP_INIT,
    },
  ];
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur());
const sheet = (page) => page.getByRole("dialog", { name: "Add a tool" });
const TOKEN = "lin_api_4f9c2d1e8b7a"; // 20 characters, as the design's dots

// 1 · Add tool → step 1, named linear.
const step1 = async (page) => {
  await page
    .getByRole("button", { name: "Add tool", exact: true })
    .first()
    .click();
  await sheet(page).getByLabel("Name").fill("linear");
};
// 2 · Connection: the URL, then an Authorization header typed "Bearer ${" → the picker.
const typeRef = async (page) => {
  await step1(page);
  await sheet(page).getByRole("button", { name: "Next: Connection" }).click();
  await sheet(page).getByLabel("URL").fill("https://mcp.linear.app/sse");
  await sheet(page).getByRole("button", { name: "Add header" }).click();
  await sheet(page)
    .getByRole("textbox", { name: "Header name 1" })
    .fill("Authorization");
  const value = sheet(page).getByRole("combobox", {
    name: "Authorization value",
  });
  await value.click();
  await value.pressSequentially("Bearer ${");
  await sheet(page).getByRole("listbox", { name: "Secrets" }).waitFor();
};
// … Enter picks the highlighted "Create LINEAR_TOKEN".
const step2 = async (page) => {
  await typeRef(page);
  await page.keyboard.press("Enter");
};
const step3 = async (page) => {
  await step2(page);
  await sheet(page).getByRole("button", { name: "Next: Secrets" }).click();
  await sheet(page).getByPlaceholder("Paste the value").fill(TOKEN);
};
const chooseReviewer = async (page) => {
  await step3(page);
  await sheet(page).getByRole("button", { name: "Choose agents" }).click();
  const dialog = page.getByRole("dialog", { name: "Turn on for agents" });
  await dialog.getByRole("checkbox", { name: "Reviewer" }).check();
  return dialog;
};
const still = async (page) => {
  await blur(page);
  await page.mouse.move(0, 0);
};

export default [
  // TkF-AddTool-1: step 1, A custom server chosen, Name "linear".
  ...pair("add-1", {
    path,
    routes: toolkitRoutes(),
    steps: async (page) => {
      await step1(page);
      await still(page);
    },
  }),
  // TkF-AddTool-2 + Toolkit-AddTool2: step 2, Remote URL, the header with its `${LINEAR_TOKEN}
  // · not set` chip.
  ...pair("add-2", {
    path,
    steps: async (page) => {
      await step2(page);
      await still(page);
    },
  }),
  // TkF-AddTool-3: typed `${` — the picker (GITHUB_TOKEN used by github, SENTRY_TOKEN not used,
  // Create LINEAR_TOKEN highlighted; the chip previews it). The input keeps focus.
  ...pair("add-3", {
    path,
    steps: async (page) => {
      await typeRef(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-AddTool-4: Advanced (raw JSON) open.
  ...pair("add-4", {
    path,
    steps: async (page) => {
      await step2(page);
      await sheet(page)
        .getByRole("button", { name: "Advanced (raw JSON)" })
        .click();
      await still(page);
    },
  }),
  // TkF-AddTool-5: step 3 — LINEAR_TOKEN Not set, its value typed.
  ...pair("add-5", {
    path,
    steps: async (page) => {
      await step3(page);
      await still(page);
    },
  }),
  // TkF-AddTool-6: "Turn linear on for…" over the sheet, Reviewer checked.
  ...pair("add-6", {
    path,
    steps: async (page) => {
      await chooseReviewer(page);
      await still(page);
    },
  }),
  // TkF-AddTool-7: added — linear Ready (on top: new rows float up), no "missing" badge, the toast.
  ...pair("add-7", {
    path,
    steps: async (page) => {
      const dialog = await chooseReviewer(page);
      await dialog.getByRole("button", { name: "Turn on for 1 agent" }).click();
      await sheet(page)
        .getByRole("button", { name: "Add tool", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "linear added and turned on for Reviewer." })
        .waitFor();
      await still(page);
    },
  }),
];
