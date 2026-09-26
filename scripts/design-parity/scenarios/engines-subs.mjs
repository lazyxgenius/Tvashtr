// Engines › Subscriptions (slice F2, group G5) — website and Desktop renders of each artboard.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-engines scripts/design-parity/scenarios/engines-subs.mjs
// Names are `<Artboard>-web` / `<Artboard>-desktop`. Every artboard here is drawn on Desktop (the
// 30px title strip, the runner banner, enabled actions). The website render shows the same data
// from the server mirror: the web banner, web messages and disabled actions (ENG-46/49), and no
// flow step can run there (Connect / Refresh are Desktop-only), so it stays on the first state.
import { RUNNER_FRESH, SUBS, enginesRoutes, sub } from "./engines-fixtures.mjs";

const ready = async (page) => {
  await page.waitForSelector(".eng-head__title");
  await page.waitForSelector(".eng-sub");
};

/** The mirror as the server reports it while Desktop checks in: connected rows are fresh. */
const mirror = (statuses) =>
  statuses.map((s) => ({ ...s, runner_fresh: s.connected }));

/**
 * Desktop bridge for these frames: `getStatus` answers `statuses`; `refresh(p)` answers
 * `refresh[p]` when given (else the current status); `connect(p)` answers the current status (the
 * CLI isn't signed in yet, so the card waits for a push); `window.__engPush(s)` is the main
 * process's onStatus push.
 */
function subsInit(statuses, { refresh = {} } = {}) {
  return `(() => {
    try { sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1"); } catch {}
    const statuses = ${JSON.stringify(statuses)};
    const refreshed = ${JSON.stringify(refresh)};
    const listeners = new Set();
    window.__engPush = (s) => listeners.forEach((cb) => cb(s));
    const find = (p) => statuses.find((s) => s.provider === p);
    window.tvashtrDesktop.engines = {
      getStatus: async () => statuses,
      connect: async (p) => find(p),
      disconnect: async (p) => ({ ...find(p), connected: false, state: "disconnected" }),
      refresh: async (p) => refreshed[p] ?? find(p),
      cancelConnect: async (p) => find(p),
      onStatus: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    };
  })();`;
}

/** One artboard, rendered on the website and in Desktop. */
function both(
  artboard,
  {
    path = "/#/engines/subscriptions",
    subs = SUBS,
    routes = {},
    refresh,
    steps,
    webSteps = ready,
  } = {},
) {
  return [
    {
      name: `${artboard}-web`,
      path,
      routes: enginesRoutes({
        runner: RUNNER_FRESH,
        ...routes,
        subs: mirror(subs),
      }),
      steps: webSteps,
    },
    {
      name: `${artboard}-desktop`,
      path,
      routes: enginesRoutes({ runner: RUNNER_FRESH, ...routes, subs }),
      steps: steps ?? ready,
      desktop: true,
      init: subsInit(subs, { refresh }),
    },
  ];
}

const card = (p) => `[data-sub="${p}"]`;
const rest = (page) => page.mouse.move(1420, 760);

async function clickIn(page, p, label) {
  await page.click(`${card(p)} button:has-text("${label}")`);
  await rest(page);
}

const GROK_CONNECTED = sub("grok", "connected", "SuperGrok");
const CODEX_1 = [SUBS[0], GROK_CONNECTED, SUBS[2]];
const CODEX_FOUND = sub("codex", "needs_login");

// EnF-FirstTime-2: nothing set up; "Connect a subscription" on the first-time Overview.
const FIRST_TIME_SUBS = [
  {
    ...sub("claude", "disconnected"),
    checked_at: null,
  },
  sub("grok", "needs_login"),
  sub("codex", "needs_install"),
];
const firstTime = async (page) => {
  await page.waitForSelector(".eng-ft__cards");
  await page.click('button:has-text("Connect a subscription")');
  await ready(page);
  await rest(page);
};

export default [
  ...both("Eng-Subs"),
  ...both("Eng-Flow-Grok-1"),
  // Connect opened Terminal; the card waits for the sign-in.
  ...both("Eng-Flow-Grok-2", {
    steps: async (page) => {
      await ready(page);
      await clickIn(page, "grok", "Connect");
      await page.waitForSelector(`${card("grok")} >> text=Waiting for sign-in`);
    },
  }),
  // The sign-in finished: the main process pushes Grok connected.
  ...both("Eng-Flow-Grok-3", {
    subs: SUBS,
    steps: async (page) => {
      await ready(page);
      await clickIn(page, "grok", "Connect");
      await page.waitForSelector(`${card("grok")} >> text=Waiting for sign-in`);
      await page.evaluate((s) => window.__engPush(s), GROK_CONNECTED);
      await page.waitForSelector(".ds-toast");
      await rest(page);
    },
    webSteps: ready,
  }).map((sc) =>
    sc.name.endsWith("-web")
      ? {
          ...sc,
          routes: enginesRoutes({
            runner: RUNNER_FRESH,
            subs: mirror(CODEX_1),
          }),
        }
      : sc,
  ),
  ...both("Eng-Flow-Codex-1", { subs: CODEX_1 }),
  // "I’ve installed it — Refresh" still finds no Codex CLI.
  ...both("Eng-Flow-Codex-2", {
    subs: CODEX_1,
    steps: async (page) => {
      await ready(page);
      await clickIn(page, "codex", "I’ve installed it — Refresh");
      await page.waitForSelector(`${card("codex")} >> text=Still not found`);
    },
  }),
  // Refresh finds it (installed, not signed in: still Ready — OQ-8).
  ...both("Eng-Flow-Codex-3", {
    subs: CODEX_1,
    refresh: { codex: CODEX_FOUND },
    steps: async (page) => {
      await ready(page);
      await clickIn(page, "codex", "I’ve installed it — Refresh");
      await page.waitForSelector(".ds-toast");
      await rest(page);
    },
  }).map((sc) =>
    sc.name.endsWith("-web")
      ? {
          ...sc,
          routes: enginesRoutes({
            runner: RUNNER_FRESH,
            subs: mirror([SUBS[0], GROK_CONNECTED, CODEX_FOUND]),
          }),
        }
      : sc,
  ),
  ...both("EnF-FirstTime-2", {
    path: "/#/engines",
    subs: FIRST_TIME_SUBS,
    routes: { keys: [] },
    steps: firstTime,
    webSteps: firstTime,
  }),
];
