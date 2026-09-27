// Toolkit › Tools › one tool (slice F3, group G8) — website and Desktop renders of
// Toolkit-ToolDetail / TkF-Detail-1 (github's page), TkF-Detail-2 (the URL edited: Unsaved,
// Discard, Save changes on), TkF-Detail-3 (raw JSON open), TkF-Detail-4 (saved, the toast) and
// TkF-Detail-5 (the "Remove github?" alertdialog). Fixtures mirror the design: github (Remote,
// https://api.githubcopilot.com/mcp, Authorization: Bearer ${GITHUB_TOKEN}, set) used by
// Engineer and Reviewer in Indicator sprint team and Writer in Docs team.
import {
  DESKTOP_INIT,
  GITHUB,
  TOOLS,
  TOOL_IDS,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = `/#/toolkit/tools/${TOOL_IDS.github}`;

const agent = (node_id, role_name, team_id, team_name) => ({
  node_id,
  role_name,
  title: null,
  team_id,
  team_name,
});
const DETAIL = {
  ...GITHUB,
  server_config: {
    url: "https://api.githubcopilot.com/mcp",
    headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
  },
  used_by_agents: [
    agent("n-eng", "engineer", "team-ind", "Indicator sprint team"),
    agent("n-rev", "reviewer", "team-ind", "Indicator sprint team"),
    agent("n-wri", "writer", "team-docs", "Docs team"),
  ],
};

/** Routes whose github changes on PATCH (each render gets its own copy). */
function statefulRoutes() {
  let detail = structuredClone(DETAIL);
  const { used_by_agents: _agents, ...item } = detail;
  return {
    ...toolkitRoutes({
      tools: TOOLS.map((t) => (t.id === item.id ? item : t)),
    }),
    [`GET /api/tool-library/${TOOL_IDS.github}`]: () => ({ json: detail }),
    [`PATCH /api/tool-library/${TOOL_IDS.github}`]: (req) => {
      const body = req.postDataJSON();
      detail = {
        ...detail,
        ...(body.name ? { name: body.name } : {}),
        ...(body.server_config ? { server_config: body.server_config } : {}),
      };
      const { used_by_agents: _a, ...next } = detail;
      return { json: next };
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
const loaded = (page) =>
  page.getByRole("heading", { name: "github", level: 1 }).waitFor();
const editUrl = async (page) => {
  await loaded(page);
  await page
    .getByRole("textbox", { name: "URL" })
    .fill("https://api.githubcopilot.com/mcp/v2");
  await blur(page);
};

export default [
  // Toolkit-ToolDetail / TkF-Detail-1: the page as it opens.
  ...pair("detail", {
    path,
    steps: async (page) => {
      await loaded(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-Detail-2: the URL edited — Unsaved, Discard and an enabled Save changes.
  ...pair("detail-edit", {
    path,
    steps: async (page) => {
      await editUrl(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-Detail-3: "Advanced (raw JSON)" open.
  ...pair("detail-raw", {
    path,
    steps: async (page) => {
      await loaded(page);
      await page.getByRole("button", { name: "Advanced (raw JSON)" }).click();
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-Detail-4: saved — clean again, and the toast.
  ...pair("detail-saved", {
    path,
    steps: async (page) => {
      await editUrl(page);
      await page.getByRole("button", { name: "Save changes" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Saved. 3 agents use the new settings" })
        .waitFor();
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-Detail-5: "Remove github?" naming its three agents.
  ...pair("detail-remove", {
    path,
    steps: async (page) => {
      await loaded(page);
      await page.getByRole("button", { name: "Remove", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Remove github?" }).waitFor();
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
];
