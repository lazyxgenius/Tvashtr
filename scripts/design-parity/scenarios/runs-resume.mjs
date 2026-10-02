// M3 — Resume from here (Runs › Prob-Stalled, -Failed, -Pick, -Confirm, -ConfirmStalled, -Resumed,
// Live-Home, Prob-HomeFailed). Each board renders as a website and a Desktop render (runs-live.mjs's
// `pair`); every state is reached through the UI: the callouts' Resume, the pick panel's Resume
// from here, Home's `?resume=1`.
// MA (R19) — Prob-Stopped (run #12 stopped at Engineer, round 2: the neutral callout and its Resume)
// and Prob-StopDialog (the main canvas's HmF-Stop-2: Home › Running now › Docs team's Stop, the
// dialog's new last line). `kept-ma-*` capture the kept-elements inventories of those two screens.
import { homeRoutes, morning, scrollMain, tap } from "./home-fixtures.mjs";
import {
  boardNow,
  boardRoutes,
  frozenAt,
  resumedPath,
  resumedRoutes,
  RESUMED_NOW,
  runPath,
} from "./runs-fixtures.mjs";
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
// MA: Prob-StopDialog is HmF-Stop-2 (home-runs.mjs's stop-2): the second Running now card's Stop.
const STOP_DIALOG = {
  desktopBoard: false,
  path: "/#/home",
  routes: homeRoutes(),
  init: morning,
  now: HOME_NOW,
  steps: async (page) => {
    await scrollMain(330)(page);
    await tap(page, page.getByRole("button", { name: "Stop" }).nth(1));
    await page.getByRole("alertdialog", { name: "Stop this run?" }).waitFor();
  },
};
const SEEN = 'sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");';
/** A screen's kept-elements inventory, website and Desktop (run with INVENTORY=1). */
const kept = (name, { path, routes, init, steps }) => [
  { name: `${name}-web`, path, routes, init, steps, settle: 900 },
  {
    name: `${name}-desktop`,
    path,
    routes,
    desktop: true,
    init: `${SEEN}${init}`,
    steps,
    settle: 900,
  },
];

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
  // MA: the stopped run's view, and Home with the Stop dialog (HmF-Stop-2's moment).
  ...pair("Prob-Stopped", { routes: boardRoutes("Prob-Stopped"), steps: activityReady }),
  ...pair("Prob-StopDialog", STOP_DIALOG),
  ...kept("kept-ma-runview-stopped", {
    path: runPath(),
    routes: boardRoutes("Prob-Stopped"),
    init: frozenAt(boardNow("Prob-Stopped")),
    steps: activityReady,
  }),
  ...kept("kept-ma-home-stopdialog", STOP_DIALOG),
];
