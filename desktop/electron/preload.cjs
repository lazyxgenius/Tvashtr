// Sandboxed preload: only `electron` can be required here, so everything is inline.
// The contract for every method is docs/superpowers/plans/api/desktop-bridge.md.
const { contextBridge, ipcRenderer } = require("electron");

const engines = {
  getStatus: () => ipcRenderer.invoke("tvashtr:engines:getStatus"),
  connect: (provider) => ipcRenderer.invoke("tvashtr:engines:connect", provider),
  disconnect: (provider) => ipcRenderer.invoke("tvashtr:engines:disconnect", provider),
  refresh: (provider) => ipcRenderer.invoke("tvashtr:engines:refresh", provider),
  // v5: stop re-checking a pending sign-in when the window regains focus.
  cancelConnect: (provider) => ipcRenderer.invoke("tvashtr:engines:cancelConnect", provider),
  // M-subs-desktop: the main process re-asks a CLI when the window regains focus after Connect
  // opened the vendor login in Terminal — cards subscribe so they flip to Connected on their own.
  onStatus: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on("tvashtr:engines:status", handler);
    return () => ipcRenderer.removeListener("tvashtr:engines:status", handler);
  },
};

// ---- navigation: tvashtr:// deep links (v5) --------------------------------------------------
// Main pushes every link as {id, target} and keeps it until this page acknowledges it; a page with
// no listener yet picks it up with consumePending() (or when its first listener subscribes).
const navListeners = new Set();
let lastNavId = 0;

function dispatchNav(msg) {
  if (!msg || typeof msg.id !== "number" || msg.id <= lastNavId) return false;
  lastNavId = msg.id;
  const target = msg.target.params
    ? { path: msg.target.path, params: { ...msg.target.params } }
    : { path: msg.target.path };
  for (const cb of [...navListeners]) {
    try {
      cb(target);
    } catch (e) {
      console.error("[tvashtr] navigation listener failed", e);
    }
  }
  return true;
}

ipcRenderer.on("tvashtr:navigation:navigate", (_e, msg) => {
  if (navListeners.size === 0) return; // stays pending for consumePending()
  if (dispatchNav(msg)) ipcRenderer.send("tvashtr:navigation:ack", msg.id);
});

const navigation = {
  onNavigate: (cb) => {
    navListeners.add(cb);
    if (navListeners.size === 1) {
      // A link that arrived before anyone listened.
      void ipcRenderer.invoke("tvashtr:navigation:consumePending").then(dispatchNav);
    }
    return () => navListeners.delete(cb);
  },
  consumePending: async () => {
    const msg = await ipcRenderer.invoke("tvashtr:navigation:consumePending");
    if (!msg || typeof msg.id !== "number" || msg.id <= lastNavId) return null;
    lastNavId = msg.id;
    return msg.target;
  },
};

// ---- repos: local-folder runs (v5) -----------------------------------------------------------
// Main answers {ok, value} | {ok:false, code, message}; reject with an Error whose message is the
// readable copy (Electron would otherwise prefix "Error invoking remote method …").
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.value;
  throw new Error(
    (res && res.message) || "Something went wrong on this computer. Try again.",
  );
}

const repos = {
  pickFolder: () => call("tvashtr:repos:pickFolder"),
  inspect: (path) => call("tvashtr:repos:inspect", path),
  // v6 (DB-5): "Set up git here".
  initGit: (args) => call("tvashtr:repos:initGit", args),
  recent: {
    list: () => call("tvashtr:repos:recent:list"),
    add: (path) => call("tvashtr:repos:recent:add", path).then(() => undefined),
    remove: (path) => call("tvashtr:repos:recent:remove", path).then(() => undefined),
  },
  prepareRun: (args) => call("tvashtr:repos:prepareRun", args),
  bringBackBranch: (args) => call("tvashtr:repos:bringBackBranch", args),
};

// ---- auth: sign in through the default browser (v6, DB-1) ------------------------------------
// Main runs the PKCE handshake; the page only starts, re-opens or cancels it and hears the outcome.
const auth = {
  startSignIn: (opts) =>
    call("tvashtr:auth:startSignIn", {
      account: opts && opts.account === "current" ? "current" : "github",
      openBrowser: !(opts && opts.openBrowser === false),
    }),
  reopenBrowser: () => call("tvashtr:auth:reopenBrowser").then(() => undefined),
  cancelSignIn: () => call("tvashtr:auth:cancelSignIn").then(() => undefined),
  onSignIn: (cb) => {
    const handler = (_e, event) => cb(event);
    ipcRenderer.on("tvashtr:auth:event", handler);
    return () => ipcRenderer.removeListener("tvashtr:auth:event", handler);
  },
  getLaunchContext: () => call("tvashtr:auth:getLaunchContext"),
  rememberUser: (user) =>
    call("tvashtr:auth:rememberUser", {
      login: user && typeof user.login === "string" ? user.login : "",
      displayName: user && typeof user.displayName === "string" ? user.displayName : "",
    }).then(() => undefined),
  forgetUser: () => call("tvashtr:auth:forgetUser").then(() => undefined),
};

// ---- setup: this Mac's first-run setup, per account (v6, DB-4) ------------------------------
const setup = {
  get: (accountId) => call("tvashtr:setup:get", typeof accountId === "string" ? accountId : ""),
  update: (accountId, patch) =>
    call(
      "tvashtr:setup:update",
      typeof accountId === "string" ? accountId : "",
      patch && typeof patch === "object" ? patch : {},
    ),
};

// ---- app (v5; getInfo v6) ---------------------------------------------------------------------
const appBridge = {
  // v6 (DB-3): the running version, the API host and whether the bundle can update in place.
  getInfo: () => call("tvashtr:app:getInfo"),
  // Main asks "Keep editing / Discard and close" on window close, reload and quit while dirty.
  setUnsavedChanges: (state) => {
    const s = state && typeof state === "object" ? state : {};
    ipcRenderer.send("tvashtr:app:unsaved", {
      dirty: s.dirty === true,
      agentName: typeof s.agentName === "string" ? s.agentName : undefined,
    });
  },
};

contextBridge.exposeInMainWorld("tvashtrDesktop", {
  engines,
  navigation,
  repos,
  auth,
  setup,
  app: appBridge,
});
contextBridge.exposeInMainWorld("tvashtrDesktopInfo", {
  shell: "electron",
  // v6: auth (browser sign-in), setup (this Mac's first-run setup), app.getInfo.
  // v5: engines.cancelConnect, navigation, repos, app.
  // v4: `platform` — the renderer draws the design's dark title strip only where main.cjs hid the
  // system one.
  version: 6,
  platform: process.platform,
});
