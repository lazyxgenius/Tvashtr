// Tvashtr Desktop app screens (desktop-app.md), group G2: the launch states and the checklist card
// (Expired, Splash, Offline, Reconnected, Updating). Desktop-only boards, so every scenario is
// `desktop: true` with the v6 fake bridge from desktop-app.mjs.
//
// A state that waits on an answer (Splash's "Loading your teams…", Offline's 10 s tries) can't be
// reached from the first page load (the harness waits for the network to go idle), so those
// scenarios load the app signed out (Welcome, which goes idle), then sign the session in and hold
// the request with `page.route`, and reload.
import { desktopBridge, signedOut } from "./desktop-app.mjs";

const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};
const signedIn = { "GET /api/auth/me": ME };
const lastUser = { login: "lazyxgenius", displayName: "lazyxgenius" };
const isPath = (p) => (url) => url.pathname === p;

/** Hold `GET /api/teams` unanswered: the launch stops at "Loading your teams…". */
async function holdTeams(page) {
  await page.route(isPath("/api/teams"), () => {});
}

/** From here on the session is lazyxgenius's. */
async function signIn(page) {
  await page.route(isPath("/api/auth/me"), (route) =>
    route.fulfill({ json: ME }),
  );
}

const expired = {
  path: "/",
  desktop: true,
  routes: signedOut,
  init: desktopBridge({ lastUser }),
};

const splash = {
  path: "/",
  desktop: true,
  routes: signedOut,
  init: desktopBridge({
    plans: { claude: "connected", grok: "needs_login", codex: "disconnected" },
  }),
  steps: async (page) => {
    await signIn(page);
    await holdTeams(page);
    await page.reload({ waitUntil: "load" });
    await page.getByText("Loading your teams…").waitFor();
    await page.getByText("Grok needs sign-in · you can fix it later").waitFor();
  },
};

// /health never answers: each of the 3 tries gives up after 10 s (≈33 s in real time).
const offline = {
  path: "/",
  desktop: true,
  routes: signedOut,
  init: desktopBridge(),
  steps: async (page) => {
    await signIn(page);
    await page.route(isPath("/health"), () => {});
    await page.reload({ waitUntil: "load" });
    await page
      .getByRole("heading", { name: "Can’t reach Tvashtr" })
      .waitFor({ timeout: 45_000 });
  },
};

// Offline (the server answers 503), then Try again once it is back: Reconnected while the teams load.
const reconnected = {
  path: "/",
  desktop: true,
  routes: signedOut,
  init: desktopBridge(),
  steps: async (page) => {
    const health = isPath("/health");
    await signIn(page);
    await page.route(health, (route) =>
      route.fulfill({ status: 503, json: { detail: "down" } }),
    );
    await page.reload({ waitUntil: "load" });
    await page
      .getByRole("heading", { name: "Can’t reach Tvashtr" })
      .waitFor({ timeout: 15_000 });
    await page.unroute(health);
    await holdTeams(page);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("heading", { name: "Reconnected" }).waitFor();
    await page.getByText("Loading your teams…").waitFor();
  },
};

// The updater is installing while one Desktop run is going.
const updating = {
  path: "/",
  desktop: true,
  routes: {
    ...signedIn,
    "GET /api/teams": { teams: [] },
    "GET /api/runs": {
      runs: [{ run_id: "r1", desktop_target: true, status_group: "running" }],
      next_cursor: null,
    },
  },
  init: desktopBridge({
    update: { state: "installing", version: "[version]" },
  }),
  steps: async (page) => {
    await page
      .getByText("Your running team will resume from its last step")
      .waitFor();
  },
};

export default [
  { name: "DT-Expired", ...expired },
  { name: "DtF-Exp-1", ...expired },
  { name: "DT-Splash", ...splash },
  { name: "DtF-Launch-1", ...splash },
  { name: "DT-Offline", ...offline },
  { name: "DtF-Off-1", ...offline },
  { name: "DtF-Off-2", ...reconnected },
  { name: "DtF-Upd-2", ...updating },
];
