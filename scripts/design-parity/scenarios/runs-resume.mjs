// M3 — Resume from here (Runs › Prob-Stalled, -Failed, -Pick, -Confirm, -ConfirmStalled, -Resumed,
// Live-Home, Prob-HomeFailed). Each board renders as a website and a Desktop render (runs-live.mjs's
// `pair`); every state is reached through the UI: the callouts' Resume, the pick panel's Resume
// from here, Home's `?resume=1`.
import { homeRoutes, scrollMain } from "./home-fixtures.mjs";
import { boardRoutes, resumedPath, resumedRoutes, RESUMED_NOW, runPath } from "./runs-fixtures.mjs";
import { activityReady, at, HOME_INBOX, HOME_NOW, HOME_RUNS, MORNING, pair } from "./runs-live.mjs";

/** The dialog the steps opened is up. */
const dialogUp = (page) => page.getByRole("dialog").waitFor();

/** Prob-Pick draws the Activity folded under the canvas, beside the panel. */
const pickOpen = async (page) => {
  await page.getByRole("complementary", { name: "Resume run #12" }).waitFor();
  await page.getByRole("button", { name: "Hide activity" }).click();
};

// Prob-HomeFailed: Needs you's third row, a failed run Resume picks up.
const FAILED_ITEM = {
  key: "run_failed:r-rel",
  kind: "run_failed",
  since: at(120),
  team: { id: "t-rel", name: "Release crew" },
  run: {
    id: "r-rel",
    idea: "Draft the v2.3 release notes",
    status: "failed",
    created_at: at(900),
    ended_at: at(120),
    target: null,
    library_team_id: "t-rel",
  },
  failure: {
    code: "model_no_answer",
    message: "The Engineer’s model didn’t answer after 3 tries",
    node_id: "n-eng",
    origin_node_id: null,
    node_role: "engineer",
    provider: null,
    target: "website",
  },
  resume: { invocation_id: 9, label: "Engineer, round 2" },
};
const home = (items) =>
  homeRoutes({
    "GET /api/inbox": { count: items.length, items },
    "GET /api/runs": { runs: HOME_RUNS, next_cursor: null },
  });
const HOME = {
  desktopBoard: false,
  path: "/#/home",
  init: MORNING,
  now: HOME_NOW,
  steps: scrollMain(206),
};

export default [
  ...pair("Prob-Stalled", { routes: boardRoutes("Prob-Stalled"), steps: activityReady }),
  ...pair("Prob-Failed", { routes: boardRoutes("Prob-Failed"), steps: activityReady }),
  // Home's Resume opens the run with the panel (`?resume=1`).
  ...pair("Prob-Pick", {
    path: `${runPath()}?resume=1`,
    routes: boardRoutes("Prob-Pick"),
    steps: pickOpen,
  }),
  // The Failed callout's Resume opens the confirm for its step.
  ...pair("Prob-Confirm", {
    routes: boardRoutes("Prob-Confirm"),
    steps: async (page) => {
      await activityReady(page);
      await page.getByRole("button", { name: "Resume from Engineer, round 2" }).click();
      await dialogUp(page);
    },
  }),
  // The Stalled callout's Resume opens the panel; the suggested step's Resume from here, the
  // confirm (Resume stops the run first).
  ...pair("Prob-ConfirmStalled", {
    routes: boardRoutes("Prob-ConfirmStalled"),
    steps: async (page) => {
      await activityReady(page);
      await page.getByRole("button", { name: "Resume from the last finished step" }).click();
      await page.getByRole("button", { name: "Resume from here" }).last().click();
      await dialogUp(page);
    },
  }),
  ...pair("Prob-Resumed", {
    path: resumedPath(),
    routes: resumedRoutes(),
    now: RESUMED_NOW,
    steps: activityReady,
  }),
  ...pair("Live-Home", { ...HOME, routes: home(HOME_INBOX) }),
  ...pair("Prob-HomeFailed", { ...HOME, routes: home([...HOME_INBOX, FAILED_ITEM]) }),
];
