/**
 * Drives the REAL Tvashtr Desktop (the dev Electron binary) with Playwright against the LOCAL stack,
 * launched the same way desktop/scripts/live-subscription-gate.mjs launches it: a Dock-style PATH,
 * the parent shell's Claude Code / API-key variables left in (the runner must strip them), the
 * Desktop loading Vite on :5173 whose proxy forwards /api to the backend on :8000.
 *
 * Shared by the V0 subscription gate, the camera takes and the stall probe. Selectors follow the
 * current UI (the same ones frontend/e2e/demo-proof.spec.ts uses).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const desktopRoot = path.join(repoRoot, "desktop");
export const DEV_URL = process.env.TVASHTR_DESKTOP_DEV_URL || "http://127.0.0.1:5173";
export const API = process.env.TVASHTR_API_BASE || "http://localhost:8000";
export const REPO = process.env.TVASHTR_PROOF_REPO || "lazyxgenius/trade_mcp";
const EMAIL = process.env.TVASHTR_SEED_EMAIL || "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_SEED_PASSWORD || "tvashtr-dev";
const ELECTRON_BIN = path.join(
  desktopRoot, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron",
);
// A throwaway Electron profile, so filming never touches the operator's own Desktop profile (its
// zoom level, sign-in and setup state). A fresh profile opens at 1440x900 CSS px on a 2x display.
export const PROFILE =
  process.env.TVASHTR_VIDEO_PROFILE || path.join(os.tmpdir(), "tvashtr-video-profile");
// Only the Claude desktop app's Code tab sets these (an operator's terminal or the Dock doesn't),
// and the runner doesn't strip them, so they must not reach Electron.
const HOST_ONLY_ENV = [
  "ANTHROPIC_BASE_URL", "CLAUDE_AGENT_SDK_VERSION", "CLAUDE_EFFORT", "CLAUDE_PID",
  "CLAUDE_PREVIEW_CLASSIFIER_FLOOR",
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function logger(prefix) {
  return (...a) => console.log(`[${prefix}]`, ...a);
}

/** A node-side session on the backend (polls while, or after, the app is closed). */
export function apiSession() {
  let cookie = "";
  return async function api(method, p, body) {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}

export async function loginApi(api) {
  return api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
}

export async function launchDesktop(outDir, tag, launchOptions = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TVASHTR_DESKTOP_DEV_URL: DEV_URL,
    TVASHTR_API_BASE: API,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  for (const k of HOST_ONLY_ENV) delete env[k];
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [desktopRoot, `--user-data-dir=${PROFILE}`],
    env,
    cwd: desktopRoot,
    ...launchOptions,
  });
  const mainLog = fs.createWriteStream(path.join(outDir, `electron-main-${tag}.log`), { flags: "a" });
  app.process().stdout.on("data", (d) => mainLog.write(d));
  app.process().stderr.on("data", (d) => mainLog.write(d));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

/** Sign in through the Desktop's own proxy (the page's origin), then reload into the app. */
export async function signIn(page) {
  const status = await page.evaluate(
    async ({ email, password }) =>
      (await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })).status,
    { email: EMAIL, password: PASSWORD },
  );
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await finishSetup(page);
  return status;
}

export const nav = (page) => page.getByRole("navigation", { name: "Dashboard" });

/**
 * A fresh profile opens in Desktop setup. Skip the Engines step (no consent is ticked: nothing but
 * that step's Continue reads it), let each run pick its target, and finish — the account has teams
 * already, so Project is the last step. Returns whether setup was shown.
 */
export async function finishSetup(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if ((await nav(page).count()) > 0) return false;
    if (page.url().includes("#/setup/")) break;
    await sleep(500);
  }
  if (page.url().includes("#/setup/engines")) {
    await page.getByRole("button", { name: "Skip for now" }).click();
  }
  await page.getByRole("radio", { name: "Decide when I launch a run" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await nav(page).waitFor({ timeout: 60000 });
  return true;
}

export async function openSubscriptions(page) {
  await nav(page).getByRole("button", { name: /^Engines/ }).click();
  await nav(page).getByRole("button", { name: /^Subscriptions/ }).click();
  const section = page.locator("section[aria-labelledby='tv-engines-subs']");
  await section.waitFor({ timeout: 30000 });
  return section;
}

/** The badge text of a subscription card ("Connected", "Checking…", …), once it settles. */
export async function subscriptionBadge(page, sub, want = "Connected", timeoutMs = 30000) {
  const badges = page.locator(`article.eng-sub[data-sub="${sub}"] .eng-sub__badges`);
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = (await badges.innerText().catch(() => "")).trim();
    if (text === want) return text;
    await sleep(500);
  }
  return text;
}

/**
 * The team named `name` — made from the two-node template when missing — with the PM on `pmModel`
 * and the Engineer on `engModel`, through the Desktop's own session. Returns its id and the
 * PATCH status of each model it set.
 */
export async function makeTeam(page, name, pmModel, engModel, { reuse = false } = {}) {
  return page.evaluate(
    async ({ name, pmModel, engModel, reuse }) => {
      const j = (r) => r.json();
      const teams = reuse ? (await fetch("/api/teams").then(j)).teams : [];
      const found = teams.find((t) => t.name === name);
      const id = found
        ? found.team_graph_id
        : (await fetch("/api/teams", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ template: "two_node", name }),
          }).then(j)).team_graph_id;
      const graph = await fetch(`/api/teams/${id}/graph`).then(j);
      const nodes = [];
      for (const n of graph.nodes) {
        if (!n.model) continue;
        const model = n.role_name === "pm" ? pmModel : engModel;
        const r = await fetch(`/api/teams/${id}/nodes/${n.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: n.prompt, model }),
        });
        nodes.push({ role: n.role_name, model, status: r.status });
      }
      return { id, nodes };
    },
    { name, pmModel, engModel, reuse },
  );
}

/** The team named `name`, reused when it exists (its models set as given). */
export const ensureTeam = (page, name, pmModel, engModel) =>
  makeTeam(page, name, pmModel, engModel, { reuse: true });

/** Wait until the server counts the Desktop runner's heartbeats fresh for Claude and Grok. */
export async function waitRunnerFresh(api, tries = 40) {
  for (let i = 0; i < tries; i += 1) {
    const { json } = await api("GET", "/api/engines/subscriptions");
    const by = Object.fromEntries((json.subscriptions || []).map((s) => [s.provider, s]));
    if (by.claude?.runner_fresh && by.grok?.runner_fresh) return by;
    await sleep(1500);
  }
  return null;
}

/** Keep the Desktop window on top (an occluded window may drop frames) — or let it go. */
export async function frontmost(app, on = true) {
  await app.evaluate(({ BrowserWindow }, on) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setAlwaysOnTop(on);
    if (on) {
      w.show();
      w.focus();
    }
  }, on);
}

/** The union of the canvas's node cards (CSS px), padded and clamped to the viewport. */
export async function nodeCardsBox(page, pad = 24) {
  const boxes = (await page.locator(".react-flow__node").evaluateAll((ns) =>
    ns.map((n) => n.getBoundingClientRect().toJSON()),
  )).filter((b) => b.width > 0);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.left)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.top)) - pad);
  const x1 = Math.min(vp.w, Math.max(...boxes.map((b) => b.right)) + pad);
  const y1 = Math.min(vp.h, Math.max(...boxes.map((b) => b.bottom)) + pad);
  const even = (v) => Math.floor(v / 2) * 2;
  return { x: even(x0), y: even(y0), w: even(x1 - x0), h: even(y1 - y0) };
}

export async function openTeam(page, teamId) {
  await page.goto(`${DEV_URL}/#/teams/${teamId}`);
  await page.getByRole("button", { name: "Run this team", exact: true }).waitFor({ timeout: 60000 });
}

export function nodeCard(page, roleTitle) {
  return page
    .locator(".react-flow__node")
    .filter({ has: page.locator(".rf-node__role", { hasText: new RegExp(`^${roleTitle}$`) }) });
}

/** Opens a node's settings drawer from its model chip; returns the drawer. */
export async function openNodeSettings(page, roleTitle) {
  await nodeCard(page, roleTitle).locator(".rf-node__model").click();
  const drawer = page.getByRole("complementary", { name: `${roleTitle} settings` });
  await drawer.waitFor({ timeout: 30000 });
  return drawer;
}

/**
 * "Run this team" → Home's composer → idea → repo → Launch. Returns the POST /api/runs exchange
 * (null with `dry`, which stops before Launch). On Desktop the picker is "Pick a folder" and the
 * GitHub App repos sit under their own heading in its "Folders" list.
 */
export async function launchFromComposer(
  page,
  { teamName, idea, repo = REPO, step = (_kind, _label, _loc, fn) => fn(), typeDelay = 0, dry = false },
) {
  const runBtn = page.getByRole("button", { name: "Run this team", exact: true });
  await step("click", "Run this team", runBtn, () => runBtn.click());
  const composer = page.locator("section[aria-label='Start a run']");
  await composer.waitFor({ timeout: 30000 });
  await composer.locator(".hm-picker--team", { hasText: teamName }).waitFor({ timeout: 30000 });
  const box = composer.getByRole("textbox", { name: "What should the team build?" });
  await step("type", "the task", box, () =>
    typeDelay ? box.pressSequentially(idea, { delay: typeDelay }) : box.fill(idea),
  );
  const picker = composer.locator(".hm-picker--repo");
  await step("click", "the repo picker", picker, () => picker.click());
  const repoPop = page.getByRole("dialog", { name: /^Pick a (repo|folder)$/ });
  await repoPop.waitFor({ timeout: 30000 });
  const option = repoPop
    .getByRole("listbox", { name: /^(Repos|Folders)$/ })
    .locator("[role='option']", {
      has: page.locator(".hm-picker__code", { hasText: new RegExp(`^${repo}$`) }),
    });
  await option.waitFor({ timeout: 60000 });
  await step("click", repo, option, () => option.click());
  await composer.locator(".hm-picker--repo", { hasText: repo }).waitFor({ timeout: 30000 });
  if (dry) return null;
  const launch = composer.getByRole("button", { name: "Launch", exact: true });
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/runs") && r.method() === "POST", {
      timeout: 120000,
    }),
    step("click", "Launch", launch, () => launch.click()),
  ]);
  const body = JSON.parse(req.postData() || "{}");
  const res = await req.response();
  return { body, status: res.status(), json: await res.json() };
}

/** Approves a waiting gate on the run view if one is showing; returns its title or null. */
export async function approveVisibleGate(page, step = (_kind, _label, _loc, fn) => fn()) {
  const card = page.locator("article.tv-task").filter({ hasText: "Awaiting your approval" }).first();
  if ((await card.count()) === 0) return null;
  const title = (await card.locator(".tv-task__title").first().innerText()).trim();
  const approve = card.getByRole("button", { name: "Approve", exact: true });
  await step("click", "Approve", approve, () => approve.click());
  await card.waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
  return title;
}

export async function runEvents(api, runId) {
  const { json } = await api("GET", `/api/spike/run-events/${runId}`);
  return (json && json.events) || [];
}

export function eventText(e) {
  const p = e.payload || {};
  return String(p.text || p.error || p.observation || p.action || "");
}

export async function waitFor(fn, { timeoutMs, everyMs = 3000, what }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export const TERMINAL = ["completed", "failed", "rejected", "cancelled", "over_budget"];

/** Every process in the tree under `pid` (pid, ppid, command), found through `ps`, never by name. */
export function processTree(rootPid) {
  const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: +pid, ppid: +ppid, command }));
  const out = [];
  const walk = (p) => {
    for (const r of rows.filter((x) => x.ppid === p)) {
      out.push(r);
      walk(r.pid);
    }
  };
  walk(rootPid);
  return out;
}
