#!/usr/bin/env node
/**
 * Dev: Vite (proxy → fly.dev) + Electron window on http://localhost:5173.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import waitOn from "wait-on";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..");
const frontendDir = path.join(repoRoot, "frontend");
const apiBase = (process.env.TVASHTR_API_BASE || process.env.VITE_API_BASE || "https://tvashtr.fly.dev").replace(
  /\/$/,
  "",
);
const viteUrl = process.env.TVASHTR_DESKTOP_DEV_URL || "http://127.0.0.1:5173";

const children = [];

function spawnInherit(cmd, args, opts) {
  const child = spawn(cmd, args, { stdio: "inherit", ...opts });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code && code !== 0) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`[tvashtr-desktop] dev — Vite at ${viteUrl}, API proxy → ${apiBase}`);

spawnInherit("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"], {
  cwd: frontendDir,
  env: {
    ...process.env,
    TVASHTR_API_PROXY_TARGET: apiBase,
    // Empty absolute base — Vite proxy keeps same-origin /api.
    VITE_API_BASE: "",
  },
});

await waitOn({ resources: [viteUrl], timeout: 120_000 });

spawnInherit(
  path.join(desktopRoot, "node_modules", ".bin", "electron"),
  ["."],
  {
    cwd: desktopRoot,
    env: {
      ...process.env,
      TVASHTR_DESKTOP_DEV_URL: viteUrl,
      TVASHTR_API_BASE: apiBase,
      // Electron on Linux CI / headless boxes
      ELECTRON_ENABLE_LOGGING: "1",
    },
  },
);
