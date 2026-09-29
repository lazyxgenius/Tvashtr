// F6 group G1 — the Documents shell: Docs-Drawer (toolbar → Documents), Docs-PanelReviewer and
// Docs-PanelPM (the agent drawer's Docs tab at full page), each as a website and a Desktop render.
import {
  NODES,
  REVIEWER_SKILLS,
  REVIEWER_TOOLS,
  TEAM_ID,
  drawerReady,
} from "./panel-fixtures.mjs";
import { aboveTitleStrip, pair } from "./panel-skills.mjs";
import { underTitleStrip } from "./panel-advanced.mjs";
import { docsReady, docsRoutes } from "./focus-docs-fixtures.mjs";

const ROUTES = docsRoutes();
// Docs-PanelPM draws the Reviewer's tab counts on the Product manager ("Skills & tools 4").
const PM_ROUTES = docsRoutes({
  nodes: {
    ...NODES,
    pm: { ...NODES.pm, skills: REVIEWER_SKILLS, tool_config: REVIEWER_TOOLS },
  },
});
const docsTab = (node) => `/#/teams/${TEAM_ID}?node=${node}&tab=docs`;

/** A Desktop board's website render sits under the title strip's 30px. */
const desktopBoard = (name, base) => {
  const [web, desktop] = pair(name, base, ROUTES);
  return [
    {
      ...web,
      steps: async (p) => {
        await underTitleStrip(p);
        await base.steps(p);
      },
    },
    desktop,
  ];
};

/** The Docs tab, once its run and documents have loaded. */
const docsTabReady = (name) => async (page) => {
  await drawerReady(page, name);
  await page.getByText("This agent reads").waitFor();
  await docsReady(page);
  await page.mouse.move(0, 0);
};

export default [
  ...desktopBoard("Docs-Drawer", {
    path: `/#/teams/${TEAM_ID}`,
    steps: async (p) => {
      await docsReady(p);
      await p.getByRole("button", { name: "Documents 2" }).click();
      await p.getByText("v2 · 36m ago · read by Reviewer").waitFor();
      await p.waitForTimeout(500);
      await p.mouse.move(0, 0);
    },
  }),
  ...desktopBoard("Docs-PanelReviewer", {
    path: docsTab(NODES.rev.id),
    steps: docsTabReady("Reviewer"),
  }),
  ...pair(
    "Docs-PanelPM",
    { path: docsTab(NODES.pm.id), steps: docsTabReady("Product manager") },
    PM_ROUTES,
    aboveTitleStrip,
  ),
];
