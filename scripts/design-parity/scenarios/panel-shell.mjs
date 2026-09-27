// F5 group G1 — canvas chrome + drawer shell + Setup (read view): Main, Web-Setup, Web-1024,
// Eng-Flow-Blocked-1, Panel-FullLength, Panel-EntryAgent, each as a website and a Desktop render.
import {
  NODES,
  REVIEWER_SKILLS,
  REVIEWER_TOOLS,
  TEAM_ID,
  drawerReady,
  isolateDrawer,
  panelRoutes,
} from "./panel-fixtures.mjs";

const at = (node) => `/#/teams/${TEAM_ID}${node ? `?node=${node}` : ""}`;

// Website: API keys for xai + anthropic. Desktop: Claude + Grok subscriptions on this computer.
const WEB = panelRoutes({ keys: ["xai", "anthropic"] });
const DESKTOP_SUBS = panelRoutes({ keys: [], subs: ["claude", "grok"] });
// Desktop showing the web boards' copy: keys, no subscription connected.
const DESKTOP_KEYS = panelRoutes({ keys: ["xai", "anthropic"] });
// Panel-EntryAgent draws the Product manager with the Reviewer's skills and tools ("Skills & tools 4").
const ENTRY_NODES = Object.values({
  ...NODES,
  pm: { ...NODES.pm, skills: REVIEWER_SKILLS, tool_config: REVIEWER_TOOLS },
});
const ENTRY_WEB = panelRoutes({ nodes: ENTRY_NODES, keys: ["xai", "anthropic"] });
const ENTRY_DESKTOP = panelRoutes({ nodes: ENTRY_NODES, keys: [], subs: ["claude", "grok"] });
// Eng-Flow-Blocked-1: no key for anthropic or xai.
const BLOCKED = panelRoutes({ keys: ["openai"] });

// Desktop: the one-time subscription disclosure was already dismissed this session.
const seenDisclosure = () => sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

// The website render of a Desktop board (Main): the web has no title strip, so the page is framed
// 30px down, where the Desktop board draws it — otherwise every row pairs with its neighbour.
const underTitleStrip = async (page) => {
  await page.addStyleTag({ content: "body { padding-top: 30px; box-sizing: border-box; }" });
};

// The Desktop render of a website board: Desktop draws the 30px title strip above the page, so the
// page is framed 30px up (the strip sits above the artboard) — the mirror of `underTitleStrip`.
const aboveTitleStrip = async (page) => {
  await page.addStyleTag({ content: "html { height: calc(100% + 30px); margin-top: -30px; }" });
};

const withFrame = (frame, steps) =>
  frame
    ? async (p) => {
        await frame(p);
        await steps?.(p);
      }
    : steps;

const pair = (name, base, webRoutes, desktopRoutes, webFrame, desktopFrame) => [
  { name: `${name}-web`, ...base, routes: webRoutes, steps: withFrame(webFrame, base.steps) },
  {
    name: `${name}-desktop`,
    ...base,
    routes: desktopRoutes,
    desktop: true,
    init: seenDisclosure,
    steps: withFrame(desktopFrame, base.steps),
  },
];

const openAdvanced = async (page) => {
  await drawerReady(page);
  await isolateDrawer(page);
  await page.getByRole("button", { name: /^Advanced/ }).click();
};

export default [
  ...pair(
    "Main",
    { path: at("n-rev"), steps: (p) => drawerReady(p) },
    WEB,
    DESKTOP_SUBS,
    underTitleStrip,
  ),
  ...pair(
    "Web-Setup",
    { path: at("n-rev"), steps: (p) => drawerReady(p) },
    WEB,
    DESKTOP_KEYS,
    undefined,
    aboveTitleStrip,
  ),
  ...pair(
    "Web-1024",
    { width: 1024, height: 768, path: at("n-rev"), steps: (p) => drawerReady(p) },
    WEB,
    DESKTOP_KEYS,
    undefined,
    aboveTitleStrip,
  ),
  ...pair(
    "Eng-Flow-Blocked-1",
    {
      path: at(),
      steps: (p) => p.getByTestId("run-blocked").waitFor(),
    },
    BLOCKED,
    BLOCKED,
    undefined,
    aboveTitleStrip,
  ),
  ...pair(
    "Panel-FullLength",
    { width: 384, height: 1260, path: at("n-rev"), steps: openAdvanced },
    WEB,
    DESKTOP_SUBS,
  ),
  ...pair(
    "Panel-EntryAgent",
    {
      width: 384,
      height: 900,
      path: at("n-pm"),
      steps: async (p) => {
        await drawerReady(p, "Product manager");
        await isolateDrawer(p);
      },
    },
    ENTRY_WEB,
    ENTRY_DESKTOP,
  ),
];
