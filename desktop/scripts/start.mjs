#!/usr/bin/env node
/**
 * Production-ish local start: require desktop/dist-fe, launch Electron
 * (which boots the static+proxy server and opens the window).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const distFe = path.join(desktopRoot, "dist-fe", "index.html");
const apiBase = (process.env.TVASHTR_API_BASE || process.env.VITE_API_BASE || "https://tvashtr.fly.dev").replace(
  /\/$/,
  "",
);

if (!fs.existsSync(distFe)) {
  console.error(`[tvashtr-desktop] missing ${distFe} — run \`npm run build\` first`);
  process.exit(1);
}

const electronBin = path.join(desktopRoot, "node_modules", ".bin", "electron");
const child = spawn(electronBin, ["."], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    TVASHTR_API_BASE: apiBase,
    VITE_API_BASE: apiBase, // documented equivalent; runtime path uses TVASHTR_API_BASE proxy target
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING || "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
