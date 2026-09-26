// Toolkit › Secrets page + secret dialog (slice F3, group G2) and the secret ⋯ menu (G3) — website
// and Desktop renders of Toolkit-Secrets, TkF-SecretsEmpty-1, TkF-AddSecret-1..4,
// TkF-SecretFix-1..2, TkF-SecretMenu-1..6 and Toolkit-ReplaceSecret. Fixtures in
// toolkit-tools-fixtures.mjs mirror the design's sample data (GITHUB_TOKEN "Sep 20",
// SENTRY_TOKEN "Aug 30", LINEAR_TOKEN missing for linear).
import {
  DESKTOP_INIT,
  GITHUB,
  SECRETS,
  SUMMARY,
  TOOL_IDS,
  toolkitRoutes,
} from "./toolkit-tools-fixtures.mjs";

const path = "/#/toolkit/secrets";
const year = new Date().getFullYear();
const on = (month, day) =>
  new Date(Date.UTC(year, month - 1, day, 12)).toISOString();

// The design's dates: GITHUB_TOKEN saved Sep 20, SENTRY_TOKEN Aug 30.
const DESIGN_SECRETS = {
  secrets: [
    { ...SECRETS.secrets[0], created_at: on(9, 20), updated_at: on(9, 20) },
    { ...SECRETS.secrets[1], created_at: on(8, 30), updated_at: on(8, 30) },
  ],
  missing: SECRETS.missing,
};

// github's page data: the three agents the delete confirmation names (TkF-SecretMenu-5).
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
    agent("n-eng", "engineer", "team-web", "Web app"),
    agent("n-rev", "reviewer", "team-web", "Web app"),
    agent("n-wri", "writer", "team-docs", "Docs"),
  ],
};

/**
 * Routes whose secrets list (and nav summary) change: POST /api/secrets adds the name (409 when
 * taken), PUT replaces the value (updated now), DELETE removes it — a name a tool still uses comes
 * back under `missing` (as the server does, spec Q2) — so each scenario gets its own copy.
 */
function statefulRoutes() {
  const state = structuredClone(DESIGN_SECRETS);
  const saved = (name) => {
    const at = new Date().toISOString();
    const missing = state.missing.find((m) => m.name === name);
    state.missing = state.missing.filter((m) => m.name !== name);
    state.secrets.push({
      name,
      created_at: at,
      updated_at: at,
      used_by_tools: missing ? missing.used_by_tools : [],
    });
    return { status: 200, json: { name, created_at: at, updated_at: at } };
  };
  return {
    ...toolkitRoutes({ secrets: DESIGN_SECRETS }),
    "GET /api/secrets": () => ({ json: state }),
    "GET /api/toolkit/summary": () => ({
      json: { ...SUMMARY, secrets_missing: state.missing.length },
    }),
    [`GET /api/tool-library/${TOOL_IDS.github}`]: { ...GITHUB_DETAIL },
    "PUT /api/secrets/:name": (req) => {
      const name = decodeURIComponent(
        new URL(req.url()).pathname.split("/").pop(),
      );
      const row = state.secrets.find((s) => s.name === name);
      if (!row)
        return { status: 404, json: { detail: `No secret named ${name}.` } };
      row.updated_at = new Date().toISOString();
      return {
        json: { name, created_at: row.created_at, updated_at: row.updated_at },
      };
    },
    "DELETE /api/secrets/:name": (req) => {
      const name = decodeURIComponent(
        new URL(req.url()).pathname.split("/").pop(),
      );
      const row = state.secrets.find((s) => s.name === name);
      state.secrets = state.secrets.filter((s) => s.name !== name);
      // The server lists missing names A→Z.
      if (row?.used_by_tools.length) {
        state.missing.push({ name, used_by_tools: row.used_by_tools });
        state.missing.sort((a, b) => a.name.localeCompare(b.name));
      }
      return { json: {} };
    },
    "POST /api/secrets": (req) => {
      const { name } = req.postDataJSON();
      if (state.secrets.some((s) => s.name === name))
        return {
          status: 409,
          json: {
            detail: `${name} already exists. Use Replace value on it instead.`,
          },
        };
      return saved(name);
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
const openAdd = async (page) => {
  await page.getByRole("button", { name: "Add secret" }).first().click();
  await page.getByRole("dialog", { name: "Add a secret" }).waitFor();
};
const fillAdd = (name, value) => async (page) => {
  await openAdd(page);
  const dialog = page.getByRole("dialog", { name: "Add a secret" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Value").fill(value);
};
const save = (label) => async (page) => {
  await page.getByRole("button", { name: label }).click();
};
const VALUE = "lin_api_4f9c2d1e8b7a6c5d";
const openMenu = async (page) => {
  await page
    .getByRole("button", { name: "More actions for GITHUB_TOKEN" })
    .click();
  await page
    .getByRole("menu", { name: "More actions for GITHUB_TOKEN" })
    .waitFor();
};
const menuItem = (label) => async (page) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: label }).click();
};
const openReplace = async (page) => {
  await menuItem("Replace value")(page);
  await page.getByRole("dialog", { name: "Replace GITHUB_TOKEN" }).waitFor();
};
const openDelete = async (page) => {
  await menuItem("Delete secret")(page);
  await page
    .getByRole("alertdialog", { name: "Delete GITHUB_TOKEN?" })
    .getByText("Engineer, Reviewer and Writer", { exact: false })
    .waitFor();
};

export default [
  // Toolkit-Secrets: a missing LINEAR_TOKEN (banner + No value row), GITHUB_TOKEN and SENTRY_TOKEN.
  ...pair("secrets", { path }),
  // TkF-SecretsEmpty-1: nothing stored and nothing missing (no banner, no nav badge).
  ...[false, true].map((desktop) => ({
    name: `secrets-empty-${desktop ? "desktop" : "web"}`,
    path,
    routes: toolkitRoutes({
      secrets: { secrets: [], missing: [] },
      summary: { ...SUMMARY, tools_needing_attention: 0, secrets_missing: 0 },
    }),
    ...(desktop ? { desktop: true, init: DESKTOP_INIT } : {}),
  })),
  // TkF-AddSecret-1: the empty "Add a secret" dialog (Save disabled).
  ...pair("add-secret-open", {
    path,
    steps: async (page) => {
      await openAdd(page);
      await blur(page);
    },
  }),
  // TkF-AddSecret-2: "notion-token" breaks the name rule.
  ...pair("add-secret-format", {
    path,
    steps: async (page) => {
      await fillAdd("notion-token", VALUE)(page);
      await save("Save secret")(page);
      await blur(page);
    },
  }),
  // TkF-AddSecret-3: GITHUB_TOKEN is taken (the server's 409).
  ...pair("add-secret-taken", {
    path,
    steps: async (page) => {
      await fillAdd("GITHUB_TOKEN", VALUE)(page);
      await save("Save secret")(page);
      await page
        .getByText("GITHUB_TOKEN already exists.", { exact: false })
        .waitFor();
      await blur(page);
    },
  }),
  // TkF-AddSecret-4: NOTION_TOKEN saved — the new row on top, "Just now", and the toast.
  ...pair("add-secret-saved", {
    path,
    steps: async (page) => {
      await fillAdd("NOTION_TOKEN", VALUE)(page);
      await save("Save secret")(page);
      await page
        .getByRole("status")
        .filter({ hasText: "NOTION_TOKEN saved." })
        .waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretFix-1: "Add value" in the banner opens "Add LINEAR_TOKEN" with the name fixed.
  ...pair("secret-fix-open", {
    path,
    steps: async (page) => {
      await page
        .locator(".sc-banner")
        .getByRole("button", { name: "Add value" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Add LINEAR_TOKEN" });
      await dialog.getByLabel("Value").fill(VALUE);
      await blur(page);
    },
  }),
  // TkF-SecretFix-2: saved — the banner and nav badge are gone, LINEAR_TOKEN is on top.
  ...pair("secret-fix-saved", {
    path,
    steps: async (page) => {
      await page
        .locator(".sc-banner")
        .getByRole("button", { name: "Add value" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Add LINEAR_TOKEN" });
      await dialog.getByLabel("Value").fill(VALUE);
      await save("Save secret")(page);
      await page
        .getByRole("status")
        .filter({ hasText: "LINEAR_TOKEN saved." })
        .waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-1: GITHUB_TOKEN's ⋯ menu.
  ...pair("secret-menu-open", {
    path,
    steps: async (page) => {
      await openMenu(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-2: "See tools that use it" — github, 3 agents · 2 teams, Open.
  ...pair("secret-menu-tools", {
    path,
    steps: async (page) => {
      await menuItem("See tools that use it")(page);
      await page
        .getByRole("dialog", { name: "Tools that use GITHUB_TOKEN" })
        .getByText("3 agents · 2 teams")
        .waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-3 and Toolkit-ReplaceSecret: the "Replace GITHUB_TOKEN" dialog.
  ...pair("secret-menu-replace", {
    path,
    steps: async (page) => {
      await openReplace(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-4: replaced — the toast (the row's Updated reads "Just now", SECRET-17).
  ...pair("secret-menu-replaced", {
    path,
    steps: async (page) => {
      await openReplace(page);
      const dialog = page.getByRole("dialog", { name: "Replace GITHUB_TOKEN" });
      await dialog.getByLabel("New value").fill("ghp_9f8e7d6c5b4a3f2e1d0c");
      await dialog.getByRole("button", { name: "Replace value" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "GITHUB_TOKEN replaced." })
        .waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-5: "Delete GITHUB_TOKEN?" naming github's agents.
  ...pair("secret-menu-delete", {
    path,
    steps: async (page) => {
      await openDelete(page);
      await blur(page);
      await page.mouse.move(0, 0);
    },
  }),
  // TkF-SecretMenu-6: deleted — the toast; github still uses it, so GITHUB_TOKEN comes back as a
  // No value row with a banner and the nav reads "2 missing" (spec Q2; the artboard drops the row).
  ...pair("secret-menu-deleted", {
    path,
    steps: async (page) => {
      await openDelete(page);
      await page
        .getByRole("alertdialog", { name: "Delete GITHUB_TOKEN?" })
        .getByRole("button", { name: "Delete secret" })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "GITHUB_TOKEN deleted." })
        .waitFor();
      await page.mouse.move(0, 0);
    },
  }),
];
