// Tvashtr Desktop app screens (desktop-app.md), group G1: the launch frame and sign-in. Every board
// is Desktop-only, so every scenario is `desktop: true`. `init` swaps the harness's v5 fake bridge
// for a v6 one (auth + app.getInfo) whose version is "[version]", so the foot reads like the
// design's "Tvashtr Desktop · [version]".
//
// Shared fixtures for later groups: `desktopBridge(opts)` builds the init script; `signedOut` is
// the 401 route map.

/**
 * The v6 fake bridge as an init-script string (Playwright can't serialise closures).
 * `window.__tvSignIn(event)` fires an `auth.onSignIn` event from a scenario's steps.
 * `plans` sets each plan CLI's state (default Claude + Grok connected, Codex off); `update` is what
 * `update.getState` answers (default idle).
 * @param {{ openedFromWeb?: {login: string, host: string} | null,
 *   lastUser?: {login: string, displayName: string} | null, platform?: string,
 *   plans?: Record<string, string>, update?: object }} [opts]
 */
export function desktopBridge(opts = {}) {
  const cfg = JSON.stringify({
    openedFromWeb: opts.openedFromWeb ?? null,
    lastUser: opts.lastUser ?? null,
    platform: opts.platform ?? "darwin",
    plans: opts.plans ?? {
      claude: "connected",
      grok: "connected",
      codex: "disconnected",
    },
    update: opts.update ?? { state: "idle" },
  });
  return `(() => {
    const cfg = ${cfg};
    const status = (provider, connected, state) => ({
      provider, connected, state: state ?? (connected ? "connected" : "disconnected"),
      account_hint: null, source: connected ? "harness" : null, checked_at: new Date().toISOString(),
    });
    const listeners = new Set();
    window.__tvSignIn = (event) => listeners.forEach((cb) => cb(event));
    const signInUrl = "https://tvashtr.fly.dev/api/auth/desktop/start?challenge=c&state=s&account=github";
    window.tvashtrDesktop = {
      engines: {
        getStatus: async () =>
          Object.entries(cfg.plans).map(([p, st]) => status(p, st === "connected", st)),
        connect: async (p) => status(p, true),
        disconnect: async (p) => status(p, false),
        refresh: async (p) => status(p, true),
        cancelConnect: async (p) => status(p, false),
        onStatus: () => () => {},
      },
      navigation: { onNavigate: () => () => {}, consumePending: async () => null },
      auth: {
        startSignIn: async () => {
          listeners.forEach((cb) => cb({ state: "waiting", signInUrl }));
          return { signInUrl };
        },
        reopenBrowser: async () => {},
        cancelSignIn: async () => {},
        onSignIn: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
        getLaunchContext: async () => ({ openedFromWeb: cfg.openedFromWeb, lastUser: cfg.lastUser }),
        rememberUser: async () => {},
        forgetUser: async () => {},
      },
      update: {
        getState: async () => cfg.update,
        onState: () => () => {},
      },
      app: {
        setUnsavedChanges: () => {},
        getInfo: async () => ({
          version: "[version]", apiOrigin: "https://tvashtr.fly.dev", apiHost: "tvashtr.fly.dev",
          platform: cfg.platform, bundlePath: null, bundleWritable: false,
        }),
      },
    };
    window.tvashtrDesktopInfo = { shell: "electron", version: 6, platform: cfg.platform };
  })();`;
}

/** Nobody signed in (the session is gone or never existed). */
export const signedOut = {
  "GET /api/auth/me": () => ({
    status: 401,
    json: { detail: "Not authenticated" },
  }),
};

const welcome = {
  path: "/",
  desktop: true,
  routes: signedOut,
  init: desktopBridge(),
};
const handoff = {
  ...welcome,
  init: desktopBridge({
    openedFromWeb: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
  }),
};
const waiting = {
  ...welcome,
  steps: async (page) => {
    await page.getByRole("button", { name: "Sign in with GitHub" }).click();
    await page
      .getByRole("heading", { name: "Finish signing in in your browser" })
      .waitFor();
  },
};
const failed = {
  ...welcome,
  steps: async (page) => {
    await waiting.steps(page);
    await page.evaluate(() =>
      window.__tvSignIn({
        state: "failed",
        reason: "timeout",
        message: "The browser didn't send you back within 10 minutes.",
      }),
    );
    await page
      .getByRole("heading", { name: "Sign-in didn’t finish" })
      .waitFor();
  },
};

export default [
  { name: "DT-Welcome", ...welcome },
  { name: "DtF-Run-1", ...welcome },
  { name: "DT-Handoff", ...handoff },
  { name: "DtF-Hand-1", ...handoff },
  { name: "DT-Waiting", ...waiting },
  { name: "DtF-Run-2", ...waiting },
  { name: "DtF-Sign-1", ...waiting },
  { name: "DtF-Sign-2", ...failed },
];
