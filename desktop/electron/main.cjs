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
const { app, BrowserWindow, shell, ipcMain, safeStorage, session } = require("electron");
const fs = require("fs");
const path = require("path");
const { createRegistry } = require("./harness/registry.cjs");
const { createStatusStore, sanitizeStatus } = require("./harness/statusStore.cjs");
const { listCandidateDirs } = require("./harness/pathDetect.cjs");
const { createRunnerApi } = require("./runner/api.cjs");
const { createStatusSync } = require("./runner/statusSync.cjs");
const { bootEngines } = require("./runner/engineBoot.cjs");
const { createRunner } = require("./runner/runner.cjs");

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

/** How long after Connect a window-focus re-probe still counts as "finishing a login". */
const LOGIN_REPROBE_WINDOW_MS = 30 * 60 * 1000;

/** @type {ReturnType<typeof createRunner> | null} */
let runner = null;

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

/**
 * M-subs-desktop: engines + the Desktop runner.
 *
 * - Status is asked of each user's OWN CLI once at launch (bootEngines), then only on Connect /
 *   Refresh / window focus after a Connect — never on a timer (A3). getStatus returns the cache.
 * - Every status change is pushed to the secret-free server mirror (A3) — launch included.
 * - Connect opens the vendor's own login in Terminal and returns at once (§3.0).
 * - The runner polls the control plane for this user's subscription node jobs while the app is
 *   open; its polls are the heartbeat the server's freshness check reads.
 */
function registerEngineIpc() {
  const userData = app.getPath("userData");
  const store = createStatusStore({ userDataDir: userData, safeStorage });
  const registry = createRegistry({ loginScriptDir: path.join(userData, "login") });
  const api = createRunnerApi({
    baseUrl: () => localOrigin,
    cookieHeader: async () => {
      const cookies = await session.defaultSession.cookies.get({ url: localOrigin });
      const parts = cookies.map((c) => `${c.name}=${c.value}`);
      return parts.length ? parts.join("; ") : null;
    },
  });
  const statusSync = createStatusSync({ api, log: (m) => console.log(m) });
  /** @type {Map<string, number>} provider -> when Connect opened the vendor login */
  const pendingLogins = new Map();

  const cached = (provider) => {
    const stored = store.read(provider);
    return stored ? toRendererStatus(stored, provider) : emptyStatus(provider);
  };
  const notifyRenderer = (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tvashtr:engines:status", status);
    }
  };
  const record = async (provider, raw) => {
    const status = toRendererStatus(raw, provider);
    store.write(provider, status);
    await statusSync.push(status);
    notifyRenderer(status);
    return status;
  };
  const probe = async (provider) => {
    const harness = registry.get(provider);
    if (!harness) return cached(provider);
    return record(provider, await harness.toStatus());
  };

  const booted = bootEngines({
    providers: PROVIDERS,
    registry,
    store: { write: (p, st) => store.write(p, toRendererStatus(st, p)) },
    statusSync,
    log: (m) => console.log(m),
  }).catch((err) => console.error("[tvashtr-desktop] engine boot failed:", err));

  ipcMain.handle("tvashtr:engines:getStatus", async () => {
    await booted;
    return PROVIDERS.map(cached);
  });

  ipcMain.handle("tvashtr:engines:connect", async (_e, provider) => {
    const id = String(provider || "");
    const harness = registry.get(id);
    if (!harness) return emptyStatus(id || "claude");
    const status = await record(id, await harness.connect());
    if (!status.connected && status.state !== "needs_install") pendingLogins.set(id, Date.now());
    return status;
  });

  ipcMain.handle("tvashtr:engines:disconnect", async (_e, provider) => {
    const id = String(provider || "");
    pendingLogins.delete(id);
    store.clear(id);
    await statusSync.clear(id);
    const status = emptyStatus(id);
    notifyRenderer(status);
    return status;
  });

  ipcMain.handle("tvashtr:engines:refresh", async (_e, provider) => {
    const id = String(provider || "");
    const status = await probe(id);
    if (status.connected) pendingLogins.delete(id);
    return status;
  });

  // After Connect opened Terminal, re-ask the CLI when the user comes back to Tvashtr.
  app.on("browser-window-focus", () => {
    const now = Date.now();
    for (const [id, startedAt] of [...pendingLogins]) {
      if (now - startedAt > LOGIN_REPROBE_WINDOW_MS) {
        pendingLogins.delete(id);
        continue;
      }
      void probe(id)
        .then((st) => {
          if (st.connected) pendingLogins.delete(id);
        })
        .catch(() => {});
    }
  });

  const binaryCache = new Map();
  const workRoot = path.join(userData, "runner-jobs");
  fs.rmSync(workRoot, { recursive: true, force: true }); // leftovers of a crashed session
  runner = createRunner({
    api,
    workRoot,
    baseEnv: process.env,
    pathDirs: () => listCandidateDirs({ npmGlobalBin: null }),
    connectedProviders: () =>
      PROVIDERS.filter((p) => {
        const st = store.read(p);
        return Boolean(st && st.connected === true);
      }),
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
  boot()
    .then(() => {
      if (runner) runner.start();
    })
    .catch((err) => {
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
});
