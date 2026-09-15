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
const { app, BrowserWindow, shell, ipcMain, safeStorage } = require("electron");
const path = require("path");
const { createRegistry } = require("./harness/registry.cjs");
const { createStatusStore, sanitizeStatus } = require("./harness/statusStore.cjs");
const { createLocalRunSupervisor } = require("./harness/localRuns.cjs");

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

/** Local subscription-run supervisor (skeleton); stopped on before-quit. */
let localRunSupervisor = createLocalRunSupervisor({
  sendLog(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tvashtr:runs:log", payload);
    }
  },
});

function emptyStatus(provider) {
  return {
    provider,
    connected: false,
    state: "disconnected",
    account_hint: null,
    source: null,
    checked_at: null,
  };
}

/**
 * Strip non-status keys before any IPC return to the renderer.
 * @param {unknown} row
 * @param {string} provider
 */
function toRendererStatus(row, provider) {
  const cleaned = sanitizeStatus(row) || emptyStatus(provider);
  if (cleaned.provider !== provider) cleaned.provider = provider;
  return cleaned;
}

function registerEngineIpc() {
  const store = createStatusStore({
    userDataDir: app.getPath("userData"),
    safeStorage,
  });
  const registry = createRegistry();

  ipcMain.handle("tvashtr:engines:getStatus", async () => {
    const out = [];
    for (const provider of PROVIDERS) {
      const harness = registry.get(provider);
      if (harness) {
        const status = toRendererStatus(await harness.toStatus(), provider);
        store.write(provider, status);
        out.push(status);
      } else {
        const stored = store.read(provider);
        out.push(stored ? toRendererStatus(stored, provider) : emptyStatus(provider));
      }
    }
    return out;
  });

  ipcMain.handle("tvashtr:engines:connect", async (_e, provider) => {
    const id = String(provider || "");
    const harness = registry.get(id);
    if (!harness) {
      return emptyStatus(id || "claude");
    }
    const status = toRendererStatus(await harness.connect(), id);
    store.write(id, status);
    return status;
  });

  ipcMain.handle("tvashtr:engines:disconnect", async (_e, provider) => {
    const id = String(provider || "");
    store.clear(id);
    return emptyStatus(id);
  });

  ipcMain.handle("tvashtr:engines:refresh", async (_e, provider) => {
    const id = String(provider || "");
    const harness = registry.get(id);
    if (!harness) {
      const stored = store.read(id);
      return stored ? toRendererStatus(stored, id) : emptyStatus(id);
    }
    const status = toRendererStatus(await harness.toStatus(), id);
    store.write(id, status);
    return status;
  });
}

function registerRunsIpc() {
  ipcMain.handle("tvashtr:runs:startLocal", async (_e, payload) => {
    return localRunSupervisor.startLocal(payload || {});
  });
  ipcMain.handle("tvashtr:runs:stopLocal", async (_e, localRunId) => {
    await localRunSupervisor.stopLocal(localRunId);
  });
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
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: "Tvashtr",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachNavigationGuards(mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(startUrl);
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

app.whenReady().then(() => {
  registerEngineIpc();
  registerRunsIpc();
  boot().catch((err) => {
    console.error("[tvashtr-desktop] failed to start:", err);
    app.exit(1);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      boot().catch((err) => {
        console.error("[tvashtr-desktop] failed to re-open:", err);
        app.exit(1);
      });
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/** Prevent re-entrant before-quit while we await stopAll (app.exit skips this handler). */
let quittingAfterStopAll = false;

app.on("before-quit", (event) => {
  if (quittingAfterStopAll) return;
  event.preventDefault();
  quittingAfterStopAll = true;
  (async () => {
    try {
      await localRunSupervisor.stopAll();
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
});
