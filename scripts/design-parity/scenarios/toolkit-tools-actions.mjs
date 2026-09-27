// Toolkit › Tools row actions (slice F3, group G4) — website and Desktop renders of
// TkF-FixSecret-1..3 (linear's "Add secret" → "Add LINEAR_TOKEN" → Ready) and TkF-ToolMenu-1..4
// (github's ⋯ menu, the Remove confirmation, removed, duplicated). Fixtures in
// toolkit-tools-fixtures.mjs mirror the design's sample data (fetch, github, linear needing
// LINEAR_TOKEN; github used by Engineer and Reviewer in Indicator sprint team, Writer in Docs team).
import {
  DESKTOP_INIT,
  GITHUB,
  SECRETS,
  SUMMARY,
  TOOLS,
  TOOL_IDS,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools";

const agent = (node_id, role_name, team_id, team_name) => ({
  node_id,
  role_name,
  title: null,
  team_id,
  team_name,
});
const GITHUB_DETAIL = {
  ...GITHUB,
  used_by_agents: [
    agent("n-eng", "engineer", "team-ind", "Indicator sprint team"),
    agent("n-rev", "reviewer", "team-ind", "Indicator sprint team"),
    agent("n-wri", "writer", "team-docs", "Docs team"),
  ],
};

// GET /api/agents?tool_id=<linear>: the design's teams (TkF-AddTool-6) — Reviewer already uses it.
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
export const AGENT_TEAMS = {
  teams: [
    {
      team_id: "team-ind",
      team_name: "Indicator sprint team",
      agents: [
        choice("n-pm", "pm", { edits_allowed: false }),
        choice("n-eng", "engineer"),
        choice("n-rev", "reviewer", { enabled: true }),
      ],
    },
    {
      team_id: "team-docs",
      team_name: "Docs team",
      agents: [choice("n-wri", "writer")],
    },
  ],
};

const idOf = (req) =>
  decodeURIComponent(new URL(req.url()).pathname.split("/")[3] ?? "");

/**
 * Routes whose tool list, secrets and nav summary change: POST /api/secrets stores a missing name
 * (its tools turn Ready), DELETE /api/tool-library/{id} removes a tool, and POST …/duplicate adds
 * `<name>-copy` — so each scenario gets its own copy.
 */
function statefulRoutes() {
  let tools = structuredClone(TOOLS);
  const secrets = structuredClone(SECRETS);
  const summary = () => ({
    ...SUMMARY,
    tools: tools.length,
    tools_needing_attention: tools.filter((t) => t.status !== "ready").length,
    secrets_missing: secrets.missing.length,
  });
  return {
    ...toolkitRoutes(),
    "GET /api/tool-library": () => ({ json: { tools } }),
    "GET /api/secrets": () => ({ json: secrets }),
    "GET /api/toolkit/summary": () => ({ json: summary() }),
    [`GET /api/tool-library/${TOOL_IDS.github}`]: { ...GITHUB_DETAIL },
    "GET /api/agents": AGENT_TEAMS,
    "POST /api/secrets": (req) => {
      const { name } = req.postDataJSON();
      const at = new Date().toISOString();
      secrets.missing = secrets.missing.filter((m) => m.name !== name);
      secrets.secrets.push({
        name,
        created_at: at,
        updated_at: at,
        used_by_tools: [],
      });
      tools = tools.map((t) => {
        const missing = t.missing_secrets.filter((n) => n !== name);
        return {
          ...t,
          missing_secrets: missing,
          status: missing.length ? t.status : "ready",
        };
      });
      return { json: { name, created_at: at, updated_at: at } };
    },
    "DELETE /api/tool-library/:id": (req) => {
      const id = idOf(req);
      const gone = tools.find((t) => t.id === id);
      tools = tools.filter((t) => t.id !== id);
      return {
        json: { removed_from_agents: gone ? gone.used_by.agent_count : 0 },
      };
    },
    "POST /api/tool-library/:id/duplicate": (req) => {
      const src = tools.find((t) => t.id === idOf(req));
      const copy = {
        ...structuredClone(src),
        id: `${src.id}-copy`,
        name: `${src.name}-copy`,
        used_by: { agent_count: 0, team_count: 0 },
      };
      tools.push(copy);
      return { status: 201, json: copy };
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
const VALUE = "lin_api_4f9c2d1e8b7a6c5d";

const openAddSecret = async (page) => {
  await page
    .getByRole("row")
    .filter({ hasText: "linear" })
    .getByRole("button", { name: "Add secret" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Add LINEAR_TOKEN" });
  await dialog.getByLabel("Value").fill(VALUE);
  return dialog;
};
const openMenu = async (page) => {
  await page.getByRole("button", { name: "More actions for github" }).click();
  await page.getByRole("menu", { name: "More actions for github" }).waitFor();
};
const menuItem = (label) => async (page) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: label }).click();
};
const openRemove = async (page) => {
  await menuItem("Remove from Toolkit")(page);
  await page
    .getByRole("alertdialog", { name: "Remove github from Toolkit?" })
    .getByText("Engineer and Reviewer in Indicator sprint team", {
      exact: false,
    })
    .waitFor();
};
const toastSays = (text) => (page) =>
  page.getByRole("status").filter({ hasText: text }).waitFor();

export default [
  // TkF-FixSecret-1: linear needs LINEAR_TOKEN — its row's tint "Add secret".
  ...pair("fix-secret-list", { path }),
  // TkF-FixSecret-2: "Add LINEAR_TOKEN" with the name fixed and a value typed.
  ...pair("fix-secret-open", {
    path,
    steps: async (page) => {
      await openAddSecret(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-FixSecret-3: saved — linear turns Ready in place, the nav badge goes, and the toast.
  ...pair("fix-secret-saved", {
    path,
    steps: async (page) => {
      const dialog = await openAddSecret(page);
      await dialog.getByRole("button", { name: "Save secret" }).click();
      await toastSays("LINEAR_TOKEN saved. linear is ready.")(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-ToolMenu-1: github's ⋯ menu.
  ...pair("tool-menu-open", {
    path,
    steps: async (page) => {
      await openMenu(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-ToolMenu-2: "Remove github from Toolkit?" naming its three agents by team.
  ...pair("tool-menu-remove", {
    path,
    steps: async (page) => {
      await openRemove(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-ToolMenu-3: removed — the row is gone and the toast.
  ...pair("tool-menu-removed", {
    path,
    steps: async (page) => {
      await openRemove(page);
      await page
        .getByRole("alertdialog", { name: "Remove github from Toolkit?" })
        .getByRole("button", { name: "Remove tool" })
        .click();
      await toastSays("github removed from Toolkit.")(page);
      await page.mouse.move(0, 0);
    },
  }),
  // "Turn on for agents…" from linear's ⋯ (the dialog's own board, TkF-AddTool-6, is gated with
  // the wizard in G6; this one checks the same dialog over the list): Reviewer pre-checked.
  ...pair("tool-menu-turn-on", {
    path,
    steps: async (page) => {
      await page
        .getByRole("button", { name: "More actions for linear" })
        .click();
      await page.getByRole("menuitem", { name: "Turn on for agents…" }).click();
      await page
        .getByRole("dialog", { name: "Turn on for agents" })
        .getByText("Turn on for 1 agent")
        .waitFor();
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-ToolMenu-4: duplicated — github-copy on top, "Not used yet", and the toast with Open.
  ...pair("tool-menu-duplicated", {
    path,
    steps: async (page) => {
      await menuItem("Duplicate")(page);
      await toastSays("Copied as github-copy.")(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
];
