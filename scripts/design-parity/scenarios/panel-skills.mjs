// F5 group G7 — the Skills & tools tab (lists + row menus): Web-Skills, Panel-SkillsEmpty,
// Panel-AddMenu, Flow-LoadMode-1..2, Flow-SkillMenu-1..2, Flow-ToolMenu-1, each as a website and a
// Desktop render.
import {
  NODES,
  TEAM_ID,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

export const at = (tab) =>
  `/#/teams/${TEAM_ID}?node=${NODES.rev.id}&tab=${tab}`;

// The design's Reviewer: house-style (Custom, Always on), pytest-review (org/skills @ main, Agent
// decides), security-checklist (Library, When triggered: auth secrets tokens), the rules files on;
// fetch (Local) and github (Library, ${GITHUB_TOKEN} set in Secrets), Domains on.
export const SKILLS = [
  {
    type: "inline",
    name: "house-style",
    content: "# House style",
    mode: "always",
  },
  {
    type: "repo",
    url: "https://github.com/org/skills",
    ref: "main",
    filter: "pytest-review",
  },
  { type: "library", id: "s-sec" },
  { type: "project_rules" },
];
export const TOOLS = {
  mcpServers: { fetch: { command: "uvx", args: ["mcp-server-fetch"] } },
  tvashtr: { library: ["t-gh"], domains: true },
};
const SKILL_LIBRARY = [
  {
    id: "s-sec",
    name: "security-checklist",
    source: {
      type: "inline",
      name: "security-checklist",
      content: "# Security checklist",
      mode: "trigger",
      triggers: ["auth", "secrets", "tokens"],
    },
    created_at: "2026-09-01T10:00:00Z",
  },
];
const TOOL_LIBRARY = [
  {
    id: "t-gh",
    name: "github",
    server_config: {
      type: "http",
      url: "https://api.githubcopilot.com/mcp",
      headers: { Authorization: "Bearer ${GITHUB_TOKEN}" },
    },
    created_at: "2026-09-01T10:00:00Z",
  },
];
export const SHELVES = {
  "GET /api/skill-library": { skills: SKILL_LIBRARY },
  "GET /api/tool-library": { tools: TOOL_LIBRARY },
  "GET /api/secrets": { secrets: [{ name: "GITHUB_TOKEN" }] },
};

export const reviewer = (extra) => ({ ...NODES.rev, ...extra });
const nodesWith = (rev) => Object.values({ ...NODES, rev });
// Both renders hold API keys: an agent on a Desktop subscription adds the PANEL-103 note, which
// isn't drawn (unit-tested instead).
export const routes = (rev, over = {}) =>
  panelRoutes({
    nodes: nodesWith(rev),
    keys: ["xai", "anthropic"],
    over: { ...SHELVES, ...over },
  });

export const FULL = routes(reviewer({ skills: SKILLS, tool_config: TOOLS }));
// Panel-SkillsEmpty: nothing added yet, and no notes ("Memory" without a count).
const EMPTY = routes(reviewer({ skills: null, tool_config: null }), {
  "GET /api/memories": { memories: [] },
});

// Desktop: the one-time subscription disclosure was already dismissed this session.
export const seenDisclosure = () =>
  sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The Desktop render of a website board: Desktop draws the 30px title strip above the page.
export const aboveTitleStrip = async (page) => {
  await page.addStyleTag({
    content: "html { height: calc(100% + 30px); margin-top: -30px; }",
  });
};

export const pair = (name, base, routeSet, desktopFrame) => [
  { name: `${name}-web`, ...base, routes: routeSet },
  {
    name: `${name}-desktop`,
    ...base,
    routes: routeSet,
    desktop: true,
    init: seenDisclosure,
    steps: desktopFrame
      ? async (p) => {
          await desktopFrame(p);
          await base.steps(p);
        }
      : base.steps,
  },
];

/** The drawer alone, on the Skills & tools tab, once the library shelves have named the rows. */
export const drawerAlone = (steps) => async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await page
    .getByText("security-checklist")
    .or(page.getByText("No skills yet"))
    .first()
    .waitFor();
  await steps?.(page);
};

const row = (page, name) =>
  page.getByRole("listitem").filter({ hasText: name });

// The second of the boards' "2 unsaved changes": github's Enable switch, below the fold.
export const offscreenChange = (page) =>
  page
    .getByRole("switch", { name: "Enable github" })
    .evaluate((el) => el.click());

export const openMenu = async (page, button) => {
  await button.click();
  // Pointer moves during the menu's pop-in can scroll the body: wait, then take the pointer away.
  await page.waitForTimeout(250);
  await page.mouse.move(0, 0);
};

export const drawer = { width: 384, height: 800, path: at("skills") };

export default [
  ...pair(
    "Web-Skills",
    { path: at("skills"), steps: (p) => drawerReady(p) },
    FULL,
    aboveTitleStrip,
  ),
  ...pair(
    "Panel-SkillsEmpty",
    { ...drawer, height: 900, steps: drawerAlone() },
    EMPTY,
  ),
  ...pair(
    "Panel-AddMenu",
    {
      ...drawer,
      height: 900,
      steps: drawerAlone((p) =>
        openMenu(p, p.getByRole("button", { name: "Add skill" })),
      ),
    },
    FULL,
  ),
  ...pair(
    "Flow-LoadMode-1",
    {
      ...drawer,
      steps: drawerAlone((p) =>
        openMenu(
          p,
          row(p, "pytest-review").getByRole("button", {
            name: "Agent decides",
          }),
        ),
      ),
    },
    FULL,
  ),
  ...pair(
    "Flow-LoadMode-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await row(p, "pytest-review")
          .getByRole("button", { name: "Agent decides" })
          .click();
        await p.getByRole("menuitem", { name: /^When triggered/ }).click();
        const words = p.getByRole("textbox", {
          name: "Trigger words for pytest-review",
        });
        await words.fill("pytest, tests");
        await words.press("Enter");
        await offscreenChange(p);
        await p.evaluate(() => document.activeElement?.blur());
      }),
    },
    FULL,
  ),
  ...pair(
    "Flow-SkillMenu-1",
    {
      ...drawer,
      steps: drawerAlone((p) =>
        openMenu(
          p,
          p.getByRole("button", { name: "More actions for pytest-review" }),
        ),
      ),
    },
    FULL,
  ),
  ...pair(
    "Flow-SkillMenu-2",
    {
      ...drawer,
      steps: drawerAlone(async (p) => {
        await p
          .getByRole("button", { name: "More actions for pytest-review" })
          .click();
        await p
          .getByRole("menuitem", { name: "Remove from this agent" })
          .click();
        await offscreenChange(p);
        await p.evaluate(() => document.activeElement?.blur());
        await p.mouse.move(0, 0);
      }),
    },
    FULL,
  ),
  ...pair(
    "Flow-ToolMenu-1",
    {
      ...drawer,
      // The design draws the menu with the tool rows still below the fold: the app's menu hangs
      // above its row, so the body first scrolls just far enough to show the fetch row.
      steps: drawerAlone(async (p) => {
        await row(p, "uvx mcp-server-fetch").evaluate((li) => {
          const body = li.closest(".nd-body");
          body.scrollTop +=
            li.getBoundingClientRect().bottom -
            body.getBoundingClientRect().bottom;
        });
        await p
          .getByRole("button", { name: "More actions for fetch" })
          .evaluate((el) => el.click());
        await p.waitForTimeout(250);
      }),
    },
    FULL,
  ),
];
