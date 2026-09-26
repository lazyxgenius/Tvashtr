// Engines › Overview (slice F2, groups G1 and G8) — website and Desktop renders of each artboard.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-engines scripts/design-parity/scenarios/engines-overview.mjs
// Names are `<Artboard>-web` / `<Artboard>-desktop`. Eng-Overview, EnF-FirstTime-1 and
// EnF-OvConnect-* are drawn on Desktop (the 30px title strip); Eng-OverviewWeb and
// Eng-Flow-Blocked-2 on the website; EnF-OvAddKey-* without the strip but with Desktop copy.
import {
  KEYS,
  NO_RUNNER,
  RUNNER_FRESH,
  SUBS,
  desktopInit,
  enginesRoutes,
  sub,
} from "./engines-fixtures.mjs";

const ready = (page) => page.waitForSelector(".eng-head__title");
const overviewReady = async (page) => {
  await ready(page);
  await page.waitForSelector(".eng-team, .eng-ft__cards");
};

/** A render's routes; a key saved in the sheet lands in the render's own list (POST answers the
 *  posted key's last 4), so a refetch (window focus) still shows it. */
function routesFor(routes) {
  const keys = [...(routes.keys ?? KEYS)];
  return enginesRoutes({
    ...routes,
    over: {
      "GET /api/providers": () => ({ json: { providers: keys } }),
      "POST /api/providers": (req) => {
        const body = JSON.parse(req.postData() || "{}");
        const now = new Date().toISOString();
        const row = {
          provider: body.provider,
          key_last4: String(body.api_key ?? "").slice(-4),
          created_at: now,
          updated_at: now,
        };
        const at = keys.findIndex((k) => k.provider === row.provider);
        if (at >= 0) keys[at] = row;
        else keys.unshift(row);
        return { json: { ...row, replaced: at >= 0 } };
      },
      ...(routes.over ?? {}),
    },
  });
}

/** One artboard, rendered on the website and in Desktop. `webRoutes` / `webSteps` replace the
 *  website render's (a flow step only Desktop can take, e.g. a row's Connect). */
function both(
  artboard,
  {
    path = "/#/engines",
    routes = {},
    steps = overviewReady,
    webRoutes = routes,
    webSteps = steps,
  } = {},
) {
  return [
    {
      name: `${artboard}-web`,
      path,
      routes: routesFor(webRoutes),
      steps: webSteps,
    },
    {
      name: `${artboard}-desktop`,
      path,
      routes: routesFor(routes),
      steps,
      desktop: true,
      init: desktopInit(routes.subs),
    },
  ];
}

const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };

const SHEET = 'aside[role="dialog"][aria-label]';
/** The design draws the pointer off the table, the sheet and the toast (no hover tint). */
const rest = (page) => page.mouse.move(1420, 760);

/** A row's Add key (the Website cell's: the last in the row) opens the sheet with it picked. */
const rowAddKey = (provider) => async (page) => {
  await page
    .locator(`tr[data-provider="${provider}"] button:has-text("Add key")`)
    .last()
    .click();
  await page.waitForSelector(SHEET);
  await rest(page);
};

const typeKey = (secret) => async (page) => {
  await page.fill(`${SHEET} input[type="password"]`, secret);
  // The design draws the field at rest.
  await page.evaluate(() => document.activeElement?.blur());
};

/** Save key, then wait for the sheet to go and the toast to show. */
const save = async (page) => {
  await page.click(`${SHEET} button:has-text("Save key")`);
  await page.waitForSelector(SHEET, { state: "detached" });
  await page.waitForSelector('.ds-toast[role="status"]');
  await rest(page);
};

/** The toast's action (Add xai): the sheet opens again with that provider. */
const toastAction = (label) => async (page) => {
  await page.click(`.ds-toast button:has-text("${label}")`);
  await page.waitForSelector(SHEET);
  await rest(page);
};

/** A row's Connect (Desktop) or Open in Desktop (website). */
const rowButton = (provider, label) => async (page) => {
  await page.click(
    `tr[data-provider="${provider}"] button:has-text("${label}")`,
  );
  await rest(page);
};

const toastSays = (text) => (page) =>
  page.waitForSelector(`.ds-toast[role="status"]:has-text("${text}")`);

/** The main process pushes the sign-in's result (checked after the Connect). Signing in takes
 *  the user a while: the Terminal toast has gone by then. */
const pushGrokConnected = async (page) => {
  await page.waitForSelector('.ds-toast:has-text("A Terminal window opened")', {
    state: "detached",
  });
  await page.evaluate(
    (s) => window.__engPush({ ...s, checked_at: new Date().toISOString() }),
    sub("grok", "connected"),
  );
  await toastSays("Grok connected")(page);
  await rest(page);
};

// EnF-OvAddKey / EnF-OvConnect: the design draws Desktop copy ("open on this computer"); the
// website render comes closest with Desktop checked in lately (OQ-15).
const OV = { runner: RUNNER_FRESH };
const GROK_ON = [SUBS[0], sub("grok", "connected"), SUBS[2]];

const addAnthropic = seq(
  overviewReady,
  rowAddKey("anthropic"),
  typeKey("sk-ant-parity-e2e-wQ3f"),
  save,
);

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

  // G8 — a row's Add key: the sheet opens with anthropic picked, the key is saved, the row flashes
  // and the toast's Add xai finishes the team for the website.
  ...both("EnF-OvAddKey-1", { routes: OV }),
  ...both("EnF-OvAddKey-2", {
    routes: OV,
    steps: seq(overviewReady, rowAddKey("anthropic")),
  }),
  ...both("EnF-OvAddKey-3", {
    routes: OV,
    // The design draws the pasted key's dots and last 4 as the field's value.
    steps: seq(
      overviewReady,
      rowAddKey("anthropic"),
      typeKey("••••••••••••••••••••wQ3f"),
    ),
  }),
  ...both("EnF-OvAddKey-4", { routes: OV, steps: addAnthropic }),
  ...both("EnF-OvAddKey-5", {
    routes: OV,
    steps: seq(
      addAnthropic,
      toastAction("Add xai"),
      typeKey("xai-parity-e2e-9Kx2"),
      save,
    ),
  }),

  // G8 — a row's Connect on Desktop: Checking… + the Terminal toast, then connected. The website
  // can't connect: its row button is Open in Desktop (OQ-2) → the Opening dialog, and once Desktop
  // connected, the mirror says so.
  ...both("EnF-OvConnect-1", { routes: OV }),
  ...both("EnF-OvConnect-2", {
    routes: OV,
    steps: seq(
      overviewReady,
      rowButton("xai", "Connect"),
      toastSays("A Terminal window opened"),
    ),
    webSteps: seq(overviewReady, rowButton("xai", "Open in Desktop"), (page) =>
      page.waitForSelector('[role="alertdialog"]'),
    ),
  }),
  ...both("EnF-OvConnect-3", {
    routes: OV,
    steps: seq(
      overviewReady,
      rowButton("xai", "Connect"),
      toastSays("A Terminal window opened"),
      pushGrokConnected,
    ),
    webRoutes: {
      ...OV,
      subs: GROK_ON.map((s) => ({ ...s, runner_fresh: s.connected })),
    },
    webSteps: overviewReady,
  }),
];
