// M4 — the team file (Team Setup › File-Panel, File-NewMenu, File-Check, File-CheckError,
// File-Imported). `kept-teamcanvas-*` capture the kept-elements inventory of the team canvas
// (authoring) before M4 (brief §2.2), website and Desktop.
import { panelRoutes, TEAM_ID } from "./panel-fixtures.mjs";

const SEEN = () => sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");
const canvasReady = async (page) => {
  await page.locator(".react-flow__node").first().waitFor();
  await page.waitForTimeout(300);
};
const NO_RUNS = { [`GET /api/teams/${TEAM_ID}/runs`]: { runs: [] } };

export default [
  {
    name: "kept-teamcanvas-web",
    path: `/#/teams/${TEAM_ID}`,
    routes: panelRoutes({ over: NO_RUNS }),
    steps: canvasReady,
    settle: 600,
  },
  {
    name: "kept-teamcanvas-desktop",
    path: `/#/teams/${TEAM_ID}`,
    routes: panelRoutes({ keys: [], subs: ["claude", "grok"], over: NO_RUNS }),
    desktop: true,
    init: SEEN,
    steps: canvasReady,
    settle: 600,
  },
];
