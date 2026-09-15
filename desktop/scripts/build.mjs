#!/usr/bin/env node
/**
 * Build the shared Vite frontend into desktop/dist-fe for the Electron shell.
 * VITE_API_BASE is left empty on purpose: the desktop local server keeps the UI
 * same-origin and proxies /api → TVASHTR_API_BASE (default https://tvashtr.fly.dev).
 * Absolute VITE_API_BASE would reintroduce CORS + third-party cookie issues.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..");
const frontendDir = path.join(repoRoot, "frontend");
const outDir = path.join(desktopRoot, "dist-fe");

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!fs.existsSync(path.join(frontendDir, "package.json"))) {
  console.error(`Frontend not found at ${frontendDir}`);
  process.exit(1);
}

// Ensure frontend deps exist (idempotent).
if (!fs.existsSync(path.join(frontendDir, "node_modules"))) {
  run("npm", ["ci"], { cwd: frontendDir, env: process.env });
}

fs.rmSync(outDir, { recursive: true, force: true });

run("npm", ["run", "build", "--", "--outDir", outDir, "--emptyOutDir"], {
  cwd: frontendDir,
  env: {
    ...process.env,
    // Explicit empty: document the contract. Proxy target is TVASHTR_API_BASE at runtime.
    VITE_API_BASE: process.env.VITE_API_BASE || "",
  },
});

console.log(`[tvashtr-desktop] frontend build → ${outDir}`);
console.log(`[tvashtr-desktop] API at runtime via local proxy → ${process.env.TVASHTR_API_BASE || "https://tvashtr.fly.dev"}`);
