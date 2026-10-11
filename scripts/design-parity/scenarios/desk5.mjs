// M-desk-5 L3 — a finished GitHub run's Changes tab when GitHub can't answer (Runs ›
// Live-ChangesGitHubDesktop, Live-ChangesGitHub): the Done run view (its Desktop render reads
// where the work ran, as M-desk-4's Live-DoneDesktop), the Engineer's drawer on Runs, the Changes
// tool, and `/diff` answering `github_error` with the run's pull request.
import desk4 from "./desk4.mjs";
import { activityReady, pair } from "./runs-live.mjs";
import { boardNow, boardRoutes, RUN_ID, runPath } from "./runs-fixtures.mjs";

const PR = "https://github.com/lazyxgenius/trade_mcp/pull/42";
const DIFF = {
  [`GET /api/runs/${RUN_ID}/diff`]: {
    run_id: RUN_ID,
    base_ref: "main",
    ship_branch: "tvashtr/run-12",
    files: [],
    total: 0,
    github_error: true,
    pr_url: PR,
  },
};
const doneDesktop = desk4.find((s) => s.name === "Live-DoneDesktop-desktop").routes;

/** The Engineer's drawer opens on Runs; pick its Changes tool, Activity folded as drawn. */
const changes = async (page) => {
  await activityReady(page);
  await page.getByRole("button", { name: "Hide activity" }).click();
  await page
    .getByRole("group", { name: "Run tools" })
    .getByRole("button", { name: "Changes" })
    .click();
  await page.getByText("Couldn't load the changes from GitHub.").waitFor();
};

const [, desktopRender] = pair("Live-ChangesGitHubDesktop", {
  path: runPath("n-eng"),
  routes: { ...doneDesktop, ...DIFF },
  now: boardNow("Live-Done"),
  steps: changes,
});
const [webRender] = pair("Live-ChangesGitHub", {
  desktopBoard: false,
  path: runPath("n-eng"),
  routes: { ...boardRoutes("Live-Done"), ...DIFF },
  now: boardNow("Live-Done"),
  steps: changes,
});

export default [desktopRender, webRender];
