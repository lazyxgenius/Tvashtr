// Tvashtr Desktop app screens (desktop-app.md), group G3: the setup frame and the Engines step
// (DT-Engines, DtF-Run-3/4/5, DtF-Hand-2). Desktop-only boards, so every scenario is
// `desktop: true` with the v6 fake bridge from desktop-app.mjs, whose `setup` store says this Mac's
// setup hasn't finished — the signed-in app then sits on #/setup/engines (DT-17).
//
// The sign-in toasts (Run-3 "Signed in as lazyxgenius", Hand-2 "Signed in from your browser") come
// from a browser sign-in finishing: load signed out (Welcome / Handoff), click the sign-in button,
// then answer /me as lazyxgenius and fire the bridge's `signed_in` event.
import { desktopBridge, signedOut } from "./desktop-app.mjs";

const ME = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};
const isPath = (p) => (url) => url.pathname === p;

/** DT-Engines' Macs: Claude Code connected, Grok found but signed out, Codex not installed. */
const PLANS = { claude: "connected", grok: "needs_login", codex: "needs_install" };

const signedInRoutes = {
  "GET /api/auth/me": ME,
  "GET /api/providers": { providers: [] },
  "GET /api/teams": { teams: [] },
};

const engines = {
  path: "/#/home",
  desktop: true,
  routes: signedInRoutes,
  init: desktopBridge({ plans: PLANS, setup: { step: "engines" } }),
  steps: async (page) => {
    await page.getByRole("heading", { name: "How should your agents run?" }).waitFor();
    await page.getByText("Found on this Mac · not signed in · covers xai/* models").waitFor();
  },
};

/** Finish a browser sign-in: the server now knows lazyxgenius, and the bridge says so. */
async function finishBrowserSignIn(page) {
  await page.route(isPath("/api/auth/me"), (route) => route.fulfill({ json: ME }));
  await page.evaluate((user) => window.__tvSignIn({ state: "signed_in", user }), ME);
  await page.getByRole("heading", { name: "How should your agents run?" }).waitFor();
}

// 3 · Back in the app: Claude found, Grok needs sign-in (+ "Signed in as lazyxgenius").
const backInTheApp = {
  path: "/",
  desktop: true,
  routes: { ...signedInRoutes, ...signedOut },
  init: desktopBridge({ plans: PLANS, setup: { step: null } }),
  steps: async (page) => {
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await page.getByRole("heading", { name: "Finish signing in in your browser" }).waitFor();
    await finishBrowserSignIn(page);
    await page.getByRole("status").getByText("Signed in as lazyxgenius").waitFor();
  },
};

// 2 · No browser step: straight to Engines (+ "Signed in from your browser").
const handoff = {
  ...backInTheApp,
  init: desktopBridge({
    plans: PLANS,
    setup: { step: null },
    openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
  }),
  steps: async (page) => {
    await page.getByRole("button", { name: "Continue as lazyxgenius" }).click();
    await finishBrowserSignIn(page);
    await page.getByRole("status").getByText("Signed in from your browser").waitFor();
  },
};

// 4 · Terminal opens to sign in to Grok: the scrim and the strip (the Terminal is the OS's).
const terminal = {
  ...engines,
  init: desktopBridge({
    plans: PLANS,
    setup: { step: "engines" },
    connect: { grok: "needs_login" },
  }),
  steps: async (page) => {
    await engines.steps(page);
    await page.getByRole("button", { name: "Sign in to Grok" }).click();
    await page.getByRole("dialog", { name: "Signing in to Grok" }).waitFor();
  },
};

// 5 · Both connected, tick the note, Continue.
const bothConnected = {
  ...engines,
  init: desktopBridge({
    plans: { claude: "connected", grok: "connected", codex: "needs_install" },
    setup: { step: "engines" },
  }),
  steps: async (page) => {
    await page.getByRole("heading", { name: "How should your agents run?" }).waitFor();
    await page.getByText("I understand: Tvashtr runs my own").click();
    await page.getByRole("button", { name: "Continue" }).and(page.locator(":enabled")).waitFor();
  },
};

export default [
  { name: "DT-Engines", ...engines },
  { name: "DtF-Run-3", ...backInTheApp },
  { name: "DtF-Hand-2", ...handoff },
  { name: "DtF-Run-4", ...terminal },
  { name: "DtF-Run-5", ...bothConnected },
];
