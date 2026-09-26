// Engines › Overview (slice F2, groups G1 and G8) — website and Desktop renders of each artboard.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-engines scripts/design-parity/scenarios/engines-overview.mjs
// Names are `<Artboard>-web` / `<Artboard>-desktop`. Eng-Overview and EnF-FirstTime-1 are drawn on
// Desktop (the 30px title strip); Eng-OverviewWeb and Eng-Flow-Blocked-2 on the website.
import { NO_RUNNER, desktopInit, enginesRoutes } from "./engines-fixtures.mjs";

const ready = (page) => page.waitForSelector(".eng-head__title");
const overviewReady = async (page) => {
  await ready(page);
  await page.waitForSelector(".eng-team, .eng-ft__cards");
};

/** One artboard, rendered on the website and in Desktop. */
function both(
  artboard,
  { path = "/#/engines", routes = {}, steps = overviewReady } = {},
) {
  return [
    { name: `${artboard}-web`, path, routes: enginesRoutes(routes), steps },
    {
      name: `${artboard}-desktop`,
      path,
      routes: enginesRoutes(routes),
      steps,
      desktop: true,
      init: desktopInit(routes.subs),
    },
  ];
}

// EnF-FirstTime-1: no key saved, no subscription connected (Claude disconnected, Grok needs login,
// Codex not installed), Desktop never checked in.
const FIRST_TIME = {
  keys: [],
  runner: NO_RUNNER,
  subs: [
    {
      provider: "claude",
      connected: false,
      state: "disconnected",
      account_hint: null,
      source: null,
      checked_at: null,
      runner_fresh: false,
    },
    {
      provider: "grok",
      connected: false,
      state: "needs_login",
      account_hint: null,
      source: "harness",
      checked_at: "2026-09-26T09:00:00+00:00",
      runner_fresh: false,
    },
    {
      provider: "codex",
      connected: false,
      state: "needs_install",
      account_hint: null,
      source: "harness",
      checked_at: "2026-09-26T09:00:00+00:00",
      runner_fresh: false,
    },
  ],
};

export default [
  ...both("Eng-Overview"),
  ...both("Eng-OverviewWeb"),
  // The canvas's "Open Engines" on a blocked run lands here, rows to fix highlighted.
  ...both("Eng-Flow-Blocked-2", { path: "/#/engines?fix=1" }),
  ...both("EnF-FirstTime-1", { routes: FIRST_TIME }),
];
