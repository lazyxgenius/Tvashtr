/**
 * Tvashtr Desktop v1 — Electron shell.
 *
 * Architecture (option 2): thin desktop chrome around the existing React/Vite UI.
 * The UI is loaded from a local HTTP origin (never file://) so relative /api calls
 * and session cookies behave like the one-origin hosted app. A local reverse proxy
 * forwards /api and /health to the hosted backend (default https://tvashtr.fly.dev).
 *
 * GitHub OAuth stays INSIDE Electron (loadURL), not the OS browser, so the loopback
 * callback + proxied Set-Cookie land on the same partition as the SPA.
 */
const {
  app,
  BrowserWindow,
  dialog,
  shell,
  ipcMain,
  safeStorage,
  session,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { createRegistry } = require("./harness/registry.cjs");
const { createStatusStore } = require("./harness/statusStore.cjs");
const { createEnginePrefs } = require("./harness/enginePrefs.cjs");
const { listCandidateDirs } = require("./harness/pathDetect.cjs");
const { createRunnerApi } = require("./runner/api.cjs");
const { createStatusSync } = require("./runner/statusSync.cjs");
const { createEngineController } = require("./runner/engineController.cjs");
const { createRunner } = require("./runner/runner.cjs");
const { mainWindowOptions } = require("./windowOptions.cjs");
const {
  SCHEME,
  parseDeepLink,
  findDeepLinkArg,
  createNavigationQueue,
} = require("./deepLink.cjs");
const { createUnsavedGuard, unsavedDialogOptions, DISCARD } = require("./unsavedGuard.cjs");
const { resolveCliEnv } = require("./harness/spawnEnv.cjs");
const { RepoError, createGit, displayPath } = require("./repos/common.cjs");
const { createRepoService } = require("./repos/service.cjs");

const DESKTOP_ROOT = path.join(__dirname, "..");

/** @type {import('http').Server | null} */
let localServer = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {string} */
let localOrigin = "http://127.0.0.1:5178";
/** @type {string} */
let apiBaseOrigin = "https://tvashtr.fly.dev";


const PROVIDERS = ["claude", "grok", "codex"];

/** @type {ReturnType<typeof createRunner> | null} */
let runner = null;

/** Talks to the control plane through the local proxy with the UI's own session cookie. */
const api = createRunnerApi({ baseUrl: () => localOrigin, cookieHeader: sessionCookieHeader });

/** `tvashtr://` links waiting for the page (see deepLink.cjs). */
const navigationQueue = createNavigationQueue({
  send: (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tvashtr:navigation:navigate", msg);
    }
  },
});

/** The renderer's latest "unsaved agent edits" state. */
const unsaved = createUnsavedGuard();

/**
 * Only the app's own page may use the newer bridge calls — the same window also shows GitHub's
 * sign-in pages, which get the preload too.
 * @param {import('electron').IpcMainEvent | import('electron').IpcMainInvokeEvent} event
 */
function isAppPage(event) {
  try {
    const frameUrl = event.senderFrame ? event.senderFrame.url : "";
    return new URL(frameUrl).origin === new URL(localOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * M-subs-desktop: engines + the Desktop runner. The status logic (launch probe, sticky Disconnect,
 * Connect re-probe on focus, cancelConnect, Refresh that never rejects) is in
 * runner/engineController.cjs; this only wires it to IPC and Electron.
 *
 * The runner polls the control plane for this user's subscription node jobs while the app is
 * open; its polls are the heartbeat the server's freshness check reads.
 */
function registerEngineIpc() {
  const userData = app.getPath("userData");
  const store = createStatusStore({ userDataDir: userData, safeStorage });
  const prefs = createEnginePrefs({ userDataDir: userData, providers: PROVIDERS });
  const registry = createRegistry({ loginScriptDir: path.join(userData, "login") });
  const statusSync = createStatusSync({ api, log: (m) => console.log(m) });
  const engines = createEngineController({
    providers: PROVIDERS,
    registry,
    store,
    prefs,
    statusSync,
    notify: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tvashtr:engines:status", status);
      }
    },
    log: (m) => console.log(m),
  });

  const booted = engines
    .boot()
    .catch((err) => console.error("[tvashtr-desktop] engine boot failed:", err));

  ipcMain.handle("tvashtr:engines:getStatus", async () => {
    await booted;
    return engines.getStatus();
  });
  ipcMain.handle("tvashtr:engines:connect", (_e, provider) => engines.connect(provider));
  ipcMain.handle("tvashtr:engines:disconnect", (_e, provider) => engines.disconnect(provider));
  ipcMain.handle("tvashtr:engines:refresh", (_e, provider) => engines.refresh(provider));
  ipcMain.handle("tvashtr:engines:cancelConnect", (e, provider) =>
    isAppPage(e) ? engines.cancelConnect(provider) : null,
  );

  // After Connect opened Terminal, re-ask the CLI when the user comes back to Tvashtr.
  app.on("browser-window-focus", () => {
    void engines.onWindowFocus();
  });

  const binaryCache = new Map();
  const workRoot = path.join(userData, "runner-jobs");
  fs.rmSync(workRoot, { recursive: true, force: true }); // leftovers of a crashed session
  runner = createRunner({
    api,
    workRoot,
    baseEnv: process.env,
    pathDirs: () => listCandidateDirs({ npmGlobalBin: null }),
    connectedProviders: () => engines.connectedProviders(),
    binaryFor: async (provider) => {
      if (!binaryCache.has(provider)) {
        const harness = registry.get(provider);
        const det = harness ? await harness.detect() : { installed: false, binaryPath: null };
        if (!det.installed) return null;
        binaryCache.set(provider, det.binaryPath);
      }
      return binaryCache.get(provider);
    },
    log: (m) => console.log(m),
    onPollOk: () => {
      if (statusSync.hasPending()) void statusSync.replayPending();
    },
  });
}

/** The `tv_session` cookie the UI holds for the loopback origin (runner + repo uploads). */
async function sessionCookieHeader() {
  const cookies = await session.defaultSession.cookies.get({ url: localOrigin });
  const parts = cookies.map((c) => `${c.name}=${c.value}`);
  return parts.length ? parts.join("; ") : null;
}

/**
 * repos.* for local-folder runs (P10). Handlers answer `{ok:true, value}` or
 * `{ok:false, code, message}`; the preload turns the latter into an Error whose message the UI can
 * show as is (Electron would otherwise wrap it in "Error invoking remote method …").
 */
function registerRepoIpc() {
  /** @type {Promise<NodeJS.ProcessEnv> | null} */
  let gitEnv = null;
  const repos = createRepoService({
    // Dock-launched apps have a thin PATH; use the same enriched env as the vendor CLIs.
    git: createGit({ env: () => (gitEnv ||= resolveCliEnv({ npmGlobalBin: null })) }),
    api,
    userDataDir: app.getPath("userData"),
    log: (m) => console.log(m),
  });

  /** @param {string} channel @param {(...args: any[]) => Promise<unknown>} fn */
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isAppPage(event)) {
        return { ok: false, code: "forbidden", message: "This page can't use Tvashtr Desktop." };
      }
      try {
        return { ok: true, value: await fn(...args) };
      } catch (e) {
        if (e instanceof RepoError) return { ok: false, code: e.code, message: e.message };
        console.error(`[tvashtr-desktop] ${channel} failed:`, e);
        return {
          ok: false,
          code: "unexpected",
          message: "Something went wrong on this computer. Try again.",
        };
      }
    });

  handle("tvashtr:repos:pickFolder", async () => {
    const options = { title: "Choose a folder", properties: /** @type {const} */ (["openDirectory"]) };
    const res =
      mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths.length) return null;
    const picked = res.filePaths[0];
    return { path: picked, displayPath: displayPath(picked) };
  });
  handle("tvashtr:repos:inspect", (p) => repos.inspect(p));
  handle("tvashtr:repos:recent:list", () => repos.recent.list());
  handle("tvashtr:repos:recent:add", async (p) => {
    await repos.recent.add(p);
    return null;
  });
  handle("tvashtr:repos:recent:remove", async (p) => {
    await repos.recent.remove(p);
    return null;
  });
  handle("tvashtr:repos:prepareRun", (args) => repos.prepareRun(args));
  handle("tvashtr:repos:bringBackBranch", (args) => repos.bringBackBranch(args));
}

/** navigation.* (deep links) and app.setUnsavedChanges. */
function registerShellIpc() {
  ipcMain.handle("tvashtr:navigation:consumePending", (event) =>
    isAppPage(event) ? navigationQueue.consumePending() : null,
  );
  ipcMain.on("tvashtr:navigation:ack", (event, id) => {
    if (isAppPage(event) && typeof id === "number") navigationQueue.ack(id);
  });
  ipcMain.on("tvashtr:app:unsaved", (event, state) => {
    if (isAppPage(event)) unsaved.set(state);
  });
}

/** Show, un-minimise and focus the main window (a deep link or a second launch). */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // macOS keeps running with no window: a link reopens it (like clicking the Dock icon). Before
    // the first window exists (still booting), boot itself opens it.
    if (app.isReady() && lastStartUrl && BrowserWindow.getAllWindows().length === 0) {
      reopenWindow();
    }
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** @param {string} link */
function handleDeepLink(link) {
  const target = parseDeepLink(link);
  if (!target) {
    console.log("[tvashtr-desktop] ignored a tvashtr:// link that isn't on the allow-list");
    return;
  }
  navigationQueue.deliver(target);
  focusMainWindow();
}

/**
 * Make Tvashtr the OS handler for tvashtr:// (the packaged app also declares it in its Info.plist
 * via electron-builder `protocols`). Dev runs don't claim it unless asked, so `npm run dev` never
 * steals the link from an installed Tvashtr.
 */
function registerProtocolClient() {
  if (!app.isPackaged && !envFlag("TVASHTR_DESKTOP_REGISTER_PROTOCOL")) return;
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(SCHEME);
  }
}

function envFlag(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
}

/**
 * GitHub OAuth / App-install URLs that return to our callback must stay in-window.
 * Unrelated github.com pages (docs, issues) still open externally.
 * @param {string} url
 */
function isGithubAuthUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
    const p = u.pathname;
    return (
      p.startsWith("/login/oauth/") ||
      p.includes("/installations/new") ||
      p.includes("/installations/select_permissions") ||
      /\/apps\/[^/]+\/installations/.test(p)
    );
  } catch {
    return false;
  }
}

/**
 * If Fly (or frontend_origin) would navigate the window off loopback after OAuth,
 * bounce back to the local SPA while keeping cookies already set for 127.0.0.1.
 * @param {string} url
 * @returns {string | null} local URL to force, or null to allow
 */
function localBounceTarget(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Never intercept the loopback itself or GitHub.
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return null;
    if (u.hostname === "github.com" || u.hostname === "www.github.com") return null;
    const fly = new URL(apiBaseOrigin);
    const isApiHost = u.hostname === fly.hostname;
    // Only bounce SPA-ish landings on the hosted frontend host (not /api — those
    // should have been proxied via loopback; if we somehow hit fly /api in-window,
    // still prefer returning home after auth rather than showing JSON).
    if (!isApiHost) return null;
    if (u.pathname.startsWith("/api/auth/github/callback")) return null;
    return `${localOrigin.replace(/\/$/, "")}/`;
  } catch {
    return null;
  }
}

async function startLocalFrontendServer() {
  const { startServer } = require("../scripts/local-server.cjs");
  const apiBase = process.env.TVASHTR_API_BASE || process.env.VITE_API_BASE || "https://tvashtr.fly.dev";
  const preferPort = Number(process.env.TVASHTR_DESKTOP_PORT || 5178);
  const distDir =
    process.env.TVASHTR_DESKTOP_DIST || path.join(DESKTOP_ROOT, "dist-fe");

  const result = await startServer({
    distDir,
    apiBase: String(apiBase).replace(/\/$/, ""),
    port: preferPort,
  });
  localServer = result.server;
  apiBaseOrigin = String(apiBase).replace(/\/$/, "");
  localOrigin = result.url.replace(/\/$/, "");
  return result.url;
}

/**
 * @param {import('electron').BrowserWindow} win
 */
function attachNavigationGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isGithubAuthUrl(url)) {
      void win.loadURL(url);
      return { action: "deny" };
    }
    // External docs / unrelated links → OS browser.
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("will-navigate", (event, url) => {
    if (isGithubAuthUrl(url)) {
      // Allow in-window navigation to GitHub OAuth.
      return;
    }
    const bounce = localBounceTarget(url);
    if (bounce) {
      event.preventDefault();
      void win.loadURL(bounce);
    }
  });

  win.webContents.on("will-redirect", (event, url) => {
    const bounce = localBounceTarget(url);
    if (bounce) {
      event.preventDefault();
      void win.loadURL(bounce);
    }
  });
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow(
    mainWindowOptions({
      platform: process.platform,
      preload: path.join(__dirname, "preload.cjs"),
    }),
  );

  attachNavigationGuards(mainWindow);
  attachUnsavedGuard(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  lastStartUrl = startUrl;
  return mainWindow.loadURL(startUrl);
}

/** @type {string | null} the page the window loads; reused when macOS reopens a window */
let lastStartUrl = null;

/** macOS: the app runs on with no window; the Dock icon or a deep link opens one again. */
function reopenWindow() {
  const opened = lastStartUrl ? createWindow(lastStartUrl) : boot();
  Promise.resolve(opened).catch((err) => {
    console.error("[tvashtr-desktop] failed to re-open:", err);
    app.exit(1);
  });
}

/**
 * Unsaved agent edits (PANEL-21). Closing the window asks first (`close` fires before the page's
 * beforeunload). A reload or a close the page itself blocks with `beforeunload` lands in
 * `will-prevent-unload`, which asks the same question — unless the user already chose "Discard
 * and close" for this close.
 * @param {BrowserWindow} win
 */
function attachUnsavedGuard(win) {
  let discardConfirmed = false;
  const ask = (options) => dialog.showMessageBoxSync(win, options);

  win.on("close", (event) => {
    if (unsaved.confirmDiscard(ask)) {
      discardConfirmed = true;
      return;
    }
    event.preventDefault();
  });
  win.webContents.on("will-prevent-unload", (event) => {
    // The page itself refused to unload, so ask even if it never reported its state.
    const proceed = discardConfirmed || ask(unsavedDialogOptions(unsaved.get())) === DISCARD;
    discardConfirmed = false;
    if (proceed) {
      unsaved.clear();
      event.preventDefault(); // ignore the page's beforeunload: go ahead and unload
    }
  });
  // A new document starts clean; a crashed page has nothing left to save.
  win.webContents.on("did-navigate", () => {
    discardConfirmed = false;
    unsaved.clear();
  });
  win.webContents.on("render-process-gone", () => unsaved.clear());
}

async function boot() {
  // Dev mode: Vite already running; Electron just points at it.
  const devUrl = process.env.TVASHTR_DESKTOP_DEV_URL;
  let startUrl = devUrl;

  if (devUrl) {
    try {
      const u = new URL(devUrl);
      localOrigin = u.origin;
    } catch {
      /* keep default */
    }
    apiBaseOrigin = (
      process.env.TVASHTR_API_BASE ||
      process.env.VITE_API_BASE ||
      "https://tvashtr.fly.dev"
    ).replace(/\/$/, "");
  }

  if (!startUrl) {
    startUrl = await startLocalFrontendServer();
  }

  await createWindow(startUrl);

  if (envFlag("TVASHTR_DESKTOP_SMOKE")) {
    // Headless/CI smoke: give the renderer a moment, then quit successfully.
    const ms = Number(process.env.TVASHTR_DESKTOP_SMOKE_MS || 4000);
    setTimeout(() => {
      console.log(`[tvashtr-desktop] smoke OK — loaded ${startUrl}`);
      app.quit();
    }, ms);
  }
}

/** Prevent re-entrant before-quit while we await stopAll (app.exit skips this handler). */
let quittingAfterStopAll = false;

function startApp() {
  registerProtocolClient();

  // macOS delivers tvashtr:// links here — possibly before `ready` on a cold start, which the
  // navigation queue holds until the page picks it up.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
  // Windows/Linux: a link (or a second launch) starts another process, which hands us its argv
  // and quits; a cold-start link is in our own argv.
  app.on("second-instance", (_event, argv) => {
    const link = findDeepLinkArg(argv);
    if (link) handleDeepLink(link);
    else focusMainWindow();
  });
  const coldStartLink = findDeepLinkArg(process.argv);
  if (coldStartLink) handleDeepLink(coldStartLink);

  app.whenReady().then(() => {
    registerEngineIpc();
    registerRepoIpc();
    registerShellIpc();
    boot()
      .then(() => {
        if (runner) runner.start();
      })
      .catch((err) => {
        console.error("[tvashtr-desktop] failed to start:", err);
        app.exit(1);
      });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) reopenWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", onBeforeQuit);
}

// One Tvashtr at a time: a second launch (or a deep link on Windows/Linux) focuses this one.
if (app.requestSingleInstanceLock()) {
  startApp();
} else {
  app.quit();
}

/** @param {import('electron').Event} event */
function onBeforeQuit(event) {
  if (quittingAfterStopAll) return;
  event.preventDefault();
  // Unsaved agent edits: "Keep editing" cancels the quit.
  if (mainWindow && !mainWindow.isDestroyed()) {
    const win = mainWindow;
    if (!unsaved.confirmDiscard((options) => dialog.showMessageBoxSync(win, options))) return;
  }
  quittingAfterStopAll = true;
  (async () => {
    try {
      // In-flight subscription jobs are killed and NOT reported; the control plane fails that node
      // with "Tvashtr Desktop went offline — reopen it and retry." once its heartbeat goes stale.
      if (runner) await runner.stop();
    } catch {
      /* ignore */
    }
    if (localServer) {
      try {
        localServer.close();
      } catch {
        /* ignore */
      }
      localServer = null;
    }
    app.exit(0);
  })();
}
