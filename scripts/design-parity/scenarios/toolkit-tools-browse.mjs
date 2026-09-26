// Toolkit › Tools › Browse (slice F3, group G5) — website and Desktop renders of
// Toolkit-ToolsBrowse / TkF-ToolTabs-2 (the catalog with Web fetch already in your tools) and
// TkF-Catalog-1..4 (Add on Web fetch, added + toast, the Install GitHub App dialog, back from
// GitHub with the App on 2 repos). The catalog fixture mirrors the design (fetch + github-app
// only; the real catalog also has the remote `github` entry, which the design doesn't draw).
import {
  DESKTOP_INIT,
  GITHUB,
  LINEAR,
  SUMMARY,
  TOOLS,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/tools/browse";

const NOT_INSTALLED = {
  hosted: true,
  installed: false,
  installation_count: 0,
  repo_count: 0,
};
const INSTALLED = {
  hosted: true,
  installed: true,
  installation_count: 1,
  repo_count: 2,
};

/**
 * Routes whose tool list and nav summary follow POST /api/tool-library (the catalog's Add), and
 * whose GitHub status the steps can flip (`gh.status = INSTALLED`) — fresh per scenario.
 */
function state({ tools = TOOLS, status = NOT_INSTALLED } = {}) {
  let list = structuredClone(tools);
  const gh = { status };
  const routes = {
    ...toolkitRoutes(),
    "GET /api/tool-library": () => ({ json: { tools: list } }),
    "GET /api/toolkit/summary": () => ({
      json: {
        ...SUMMARY,
        tools: list.length,
        tools_needing_attention: list.filter((t) => t.status !== "ready")
          .length,
      },
    }),
    "GET /api/github/status": () => ({ json: gh.status }),
    "POST /api/tool-library": (req) => {
      const { name, server_config } = req.postDataJSON();
      const at = new Date().toISOString();
      const created = {
        id: `tool-${name}`,
        name,
        server_config,
        created_at: at,
        updated_at: at,
        secret_refs: [],
        missing_secrets: [],
        status: "ready",
        used_by: { agent_count: 0, team_count: 0 },
      };
      list = [...list, created];
      return { json: created };
    },
  };
  return { routes, gh };
}

/** A web + Desktop pair; `make()` builds each render's own state (routes + GitHub switch). */
function pair(name, make) {
  const web = make();
  const desktop = make();
  return [
    { name: `${name}-web`, ...web },
    { name: `${name}-desktop`, ...desktop, desktop: true, init: DESKTOP_INIT },
  ];
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur());
const card = (page, title) => page.getByRole("article", { name: title });
const toastSays = (text) => (page) =>
  page.getByRole("status").filter({ hasText: text }).waitFor();

export default [
  // Toolkit-ToolsBrowse = TkF-ToolTabs-2: Web fetch is in your tools, the App isn't installed.
  ...pair("browse", () => ({
    path,
    routes: state().routes,
    steps: async (page) => {
      await card(page, "GitHub App repos").waitFor();
    },
  })),
  // TkF-Catalog-1: Web fetch not added yet — a primary "Add".
  ...pair("catalog-add", () => ({
    path,
    routes: state({ tools: [GITHUB, LINEAR] }).routes,
    steps: async (page) => {
      await card(page, "GitHub App repos").waitFor();
    },
  })),
  // TkF-Catalog-2: added — "In your tools" and the toast with "Choose agents".
  ...pair("catalog-added", () => ({
    path,
    routes: state({ tools: [GITHUB, LINEAR] }).routes,
    steps: async (page) => {
      await card(page, "GitHub App repos").waitFor();
      await card(page, "Web fetch")
        .getByRole("button", { name: "Add" })
        .click();
      await toastSays("Web fetch added.")(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  })),
  // TkF-Catalog-3: the Install GitHub App alertdialog.
  ...pair("catalog-install", () => ({
    path,
    routes: state().routes,
    steps: async (page) => {
      await card(page, "GitHub App repos")
        .getByRole("button", { name: "Install GitHub App" })
        .click();
      await page
        .getByRole("alertdialog", { name: "Install the Tvashtr GitHub App" })
        .waitFor();
      await blur(page);
      await page.mouse.move(0, 0);
    },
  })),
  // TkF-Catalog-4, website: "Open GitHub" (a new window — stubbed here), then the window comes
  // back into focus with the App on 2 repos.
  (() => {
    const { routes, gh } = state();
    return {
      name: "catalog-back-web",
      path,
      routes,
      steps: async (page) => {
        await page.evaluate(() => {
          window.open = () => null;
        });
        await card(page, "GitHub App repos")
          .getByRole("button", { name: "Install GitHub App" })
          .click();
        await page.getByRole("button", { name: "Open GitHub" }).click();
        gh.status = INSTALLED;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await toastSays("GitHub App installed on 2 repos.")(page);
        await blur(page);
        await page.mouse.move(0, 0);
      },
    };
  })(),
  // TkF-Catalog-4, Desktop: Electron loaded GitHub in the window and reloaded `/`; the app goes
  // back to Browse from `tv:return` and compares with the state saved before leaving.
  {
    name: "catalog-back-desktop",
    desktop: true,
    path: "/",
    routes: state({ status: INSTALLED }).routes,
    init: `${DESKTOP_INIT}
try {
  if (!sessionStorage.getItem("tv:booted")) {
    sessionStorage.setItem("tv:booted", "1");
    sessionStorage.setItem("tv:return", "#/toolkit/tools/browse");
    sessionStorage.setItem("tv:github-before", JSON.stringify({ installed: false, repo_count: 0 }));
  }
} catch {}`,
    steps: async (page) => {
      await toastSays("GitHub App installed on 2 repos.")(page);
      await page.mouse.move(0, 0);
    },
  },
];
