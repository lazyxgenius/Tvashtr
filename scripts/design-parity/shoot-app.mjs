// Screenshot + measure the REAL frontend with canned API data, at a design artboard's size.
//
// Usage:
//   APP_URL=http://localhost:5199 node scripts/design-parity/shoot-app.mjs <outDir> <scenarios.mjs> [name ...]
// Start the app first: `cd frontend && npx vite --port 5199` (no backend needed — every /api call
// is answered from the scenario's fixtures).
//
// A scenario file default-exports an array of:
//   { name, width=1440, height=900, desktop=false, platform="darwin", path="/#/home",
//     routes: { "GET /api/teams": json | (req) => ({status, json}), "GET /api/teams/:id/graph": … },
//     steps: async (page) => {}, settle=400, fullPage=false }
// Unmatched API calls answer 404 and are listed, so missing fixtures are visible.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { routeFonts } from "./fonts-route.mjs";
import { loadChromium, MEASURE } from "./lib.mjs";

const [outDir, scenarioFile, ...only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const scenarios = (await import(pathToFileURL(path.resolve(scenarioFile)).href)).default;
const BASE = process.env.APP_URL || "http://localhost:5199";

const DEFAULT_ROUTES = {
  "GET /health": { status: "ok", db: "ok" },
  "GET /api/auth/me": {
    id: "00000000-0000-4000-8000-000000000001",
    email: "lazyx@tvashtr.dev",
    github_login: "lazyx",
    display_name: "Lazyx",
  },
  "GET /api/config": {
    hosted_mode: true,
    github_install_url: "https://github.com/apps/tvashtr/installations/new",
    github_manage_url: "https://github.com/apps/tvashtr/installations/new",
    provider_catalogue: [],
    provider_directory: [],
    default_run_budget_usd: 5,
  },
};

function match(routes, method, pathname, search) {
  const key = `${method} ${pathname}`;
  if (routes[`${key}${search}`] !== undefined) return routes[`${key}${search}`];
  if (routes[key] !== undefined) return routes[key];
  for (const [k, v] of Object.entries(routes)) {
    const [m, p] = k.split(" ");
    if (m !== method || !p.includes(":")) continue;
    if (new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname)) return v;
  }
  return undefined;
}

const browser = await loadChromium();
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.name)) continue;
  const context = await browser.newContext({
    viewport: { width: sc.width ?? 1440, height: sc.height ?? 900 },
    deviceScaleFactor: 1,
  });
  await routeFonts(context);
  const routes = { ...DEFAULT_ROUTES, ...(sc.routes ?? {}) };
  const missing = new Set();
  await context.route(/\/(api\/|health)/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const hit = match(routes, req.method(), u.pathname, u.search);
    if (hit === undefined) {
      missing.add(`${req.method()} ${u.pathname}`);
      return route.fulfill({ status: 404, json: { detail: "no fixture" } });
    }
    if (typeof hit === "function") {
      const r = await hit(req);
      return route.fulfill({ status: r.status ?? 200, json: r.json ?? null });
    }
    return route.fulfill({ status: 200, json: hit });
  });
  if (sc.desktop) {
    await context.addInitScript((platform) => {
      const status = (provider, connected) => ({
        provider,
        connected,
        state: connected ? "connected" : "disconnected",
        account_hint: null,
        source: connected ? "harness" : null,
        checked_at: new Date().toISOString(),
      });
      window.tvashtrDesktop = {
        engines: {
          getStatus: async () => [status("claude", true), status("grok", true), status("codex", false)],
          connect: async (p) => status(p, true),
          disconnect: async (p) => status(p, false),
          refresh: async (p) => status(p, true),
          onStatus: () => () => {},
        },
      };
      window.tvashtrDesktopInfo = { shell: "electron", version: 5, platform };
    }, sc.platform ?? "darwin");
  }
  if (sc.init) await context.addInitScript(sc.init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text());
  });
  await page.goto(BASE + (sc.path ?? "/"), { waitUntil: "networkidle" });
  if (sc.steps) await sc.steps(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(sc.settle ?? 400);
  await page.screenshot({ path: path.join(outDir, `${sc.name}.png`), fullPage: Boolean(sc.fullPage) });
  fs.writeFileSync(path.join(outDir, `${sc.name}.json`), JSON.stringify(await page.evaluate(MEASURE)));
  console.log(
    sc.name,
    `${sc.width ?? 1440}x${sc.height ?? 900}`,
    missing.size ? `MISSING ${[...missing].join(", ")}` : "",
    errors.length ? `ERRORS ${errors.slice(0, 3).join(" | ")}` : "",
  );
  await context.close();
}
await browser.close();
