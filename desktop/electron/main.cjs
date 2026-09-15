/**
 * Tvashtr Desktop v1 — Electron shell.
 *
 * Architecture (option 2): thin desktop chrome around the existing React/Vite UI.
 * The UI is loaded from a local HTTP origin (never file://) so relative /api calls
 * and session cookies behave like the one-origin hosted app. A local reverse proxy
 * forwards /api and /health to the hosted backend (default https://tvashtr.fly.dev).
 */
const { app, BrowserWindow, shell } = require("electron");
const path = require("path");

const DESKTOP_ROOT = path.join(__dirname, "..");

/** @type {import('http').Server | null} */
let localServer = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;

function envFlag(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return !["0", "false", "no", "off"].includes(String(v).toLowerCase());
}

async function startLocalFrontendServer() {
  // Lazy-require so `electron .` without the helper still fails clearly.
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
  return result.url;
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // External links (GitHub OAuth manage URL, docs, etc.) open in the OS browser.
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(startUrl);
}

async function boot() {
  // Dev mode: Vite already running; Electron just points at it.
  const devUrl = process.env.TVASHTR_DESKTOP_DEV_URL;
  let startUrl = devUrl;

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

app.on("before-quit", () => {
  if (localServer) {
    try {
      localServer.close();
    } catch {
      /* ignore */
    }
    localServer = null;
  }
});
