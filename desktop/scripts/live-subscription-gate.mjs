#!/usr/bin/env node
/**
 * M-subs-desktop LIVE gate — drives the REAL Tvashtr Desktop (Electron) with Playwright against a
 * LOCAL backend (never fly.dev), and proves a team's Claude + Grok nodes run on the operator's OWN
 * installed CLIs with their own sign-in.
 *
 *   node desktop/scripts/live-subscription-gate.mjs run      # Engines → team → Run → gate → PR
 *   node desktop/scripts/live-subscription-gate.mjs offline  # quit Desktop mid-node → offline error
 *   node desktop/scripts/live-subscription-gate.mjs dry      # every check up to Launch; no run
 *
 * Needs: `make backend` on :8000, Vite on :5173 proxying /api → :8000 (see desktop/README.md),
 * `make seed` + scripts/demo_proof_seed.py (operator + its GitHub installation), the operator
 * signed in to `claude` and `grok` on this Mac (check with `claude auth status` from a plain
 * Terminal). The Electron app is launched with a Dock-style PATH and WITH the parent shell's
 * API-key / Claude Code session variables still set — the runner must strip them — in a fresh
 * profile, so every gate run starts signed out and goes through the Desktop's first-run setup.
 * Screenshots + a JSON summary land in artifacts/desktop-subs/ (gitignored).
 *
 * TVASHTR_SUBS_PM_MODEL / TVASHTR_SUBS_ENG_MODEL pick the two nodes' models (xai/… runs on the
 * Grok subscription, anthropic/… on the Claude one); the subscription checks follow them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..");
const require = createRequire(path.join(repoRoot, "frontend", "package.json"));
const { _electron: electron } = require("@playwright/test");

const PHASE = process.argv[2] || "run";
const OUT = path.join(repoRoot, "artifacts", "desktop-subs");
const DEV_URL = process.env.TVASHTR_DESKTOP_DEV_URL || "http://127.0.0.1:5173";
const API = process.env.TVASHTR_API_BASE || "http://localhost:8000";
const EMAIL = process.env.TVASHTR_SEED_EMAIL || "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_SEED_PASSWORD || "tvashtr-dev";
const REPO = process.env.TVASHTR_PROOF_REPO || "lazyxgenius/trade_mcp";
const PM_MODEL = process.env.TVASHTR_SUBS_PM_MODEL || "xai/grok-4.7";
const ENG_MODEL = process.env.TVASHTR_SUBS_ENG_MODEL || "anthropic/claude-sonnet-5";
const IDEA =
  process.env.TVASHTR_SUBS_IDEA ||
  (PHASE === "offline"
    ? // Long enough that Desktop is quit while the Engineer is still working (it never ships).
      "Write a thorough ARCHITECTURE.md (at least 1500 words) that documents every package and " +
      "module in the repository, how they fit together, and how data flows between them."
    : "Add a short 'Built with Tvashtr' line at the very end of README.md. Change nothing else.");
const ELECTRON_BIN = path.join(
  desktopRoot,
  "node_modules",
  "electron",
  "dist",
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron",
);
// A fresh profile per gate run: signed out, default zoom, setup not done — never the state of the
// profile the operator uses day to day. The offline phase's relaunch reuses it (still signed in).
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-subs-gate-"));
// Only a Claude desktop-app shell sets these (a terminal or the Dock doesn't), and the runner keeps
// them, so they stay out of Electron.
const HOST_ONLY_ENV = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_PREVIEW_CLASSIFIER_FLOOR",
];
// The subscription a model runs on, by its provider prefix.
const SUBSCRIPTIONS = {
  xai: { id: "grok", name: "Grok", cli: "Grok Build" },
  anthropic: { id: "claude", name: "Claude", cli: "Claude Code" },
};
const subscriptionOf = (model) => SUBSCRIPTIONS[String(model).split("/")[0]];
const PM_SUB = subscriptionOf(PM_MODEL);
const ENG_SUB = subscriptionOf(ENG_MODEL);
const SUBS = [PM_SUB, ENG_SUB].filter((s, i, all) => s && all.findIndex((x) => x?.id === s.id) === i);
const SUB_PROVIDERS = Object.keys(SUBSCRIPTIONS).filter((p) => SUBS.includes(SUBSCRIPTIONS[p]));

fs.mkdirSync(OUT, { recursive: true });
const summary = { phase: PHASE, started: new Date().toISOString(), checks: [] };
const log = (...a) => console.log("[subs-gate]", ...a);
function check(name, ok, detail) {
  summary.checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail || ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- a node-side session (for polling while/after the app is closed) --------------------------
let cookie = "";
async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

let current = null; // the running Desktop, closed on any exit before its profile is removed

async function launchDesktop(tag) {
  // Dock-style PATH + the leaky parent env (CLAUDECODE, CLAUDE_CODE_*, any API keys) on purpose.
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
  });
  current = app;
  const mainLog = fs.createWriteStream(path.join(OUT, `electron-main-${tag}.log`), { flags: "a" });
  app.process().stdout.on("data", (d) => mainLog.write(d));
  app.process().stderr.on("data", (d) => mainLog.write(d));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

const nav = (page) => page.locator('nav[aria-label="Dashboard"]');

async function signIn(page) {
  const status = await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      return r.status;
    },
    { email: EMAIL, password: PASSWORD },
  );
  check("signed in to the LOCAL backend through the Desktop's own proxy", status === 200, `HTTP ${status}`);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

async function finishSetup(page) {
  // A fresh profile opens the Desktop's first-run setup. Skip the Engines step (no consent is
  // ticked), let each run pick its target, and finish: the account has teams, so Project is last.
  await page.waitForURL(/#\/setup\//, { timeout: 30000 });
  if (page.url().includes("#/setup/engines")) {
    await page.getByRole("button", { name: "Skip for now" }).click();
  }
  await page.getByRole("radio", { name: "Decide when I launch a run" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await nav(page).waitFor({ timeout: 60000 });
  log("Desktop setup finished (Skip for now → Decide when I launch a run)");
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  log("screenshot", path.relative(repoRoot, file));
  return path.relative(repoRoot, file);
}

async function openEngines(page) {
  await nav(page).locator("button", { hasText: "Engines" }).click();
  await nav(page).locator("button", { hasText: "Subscriptions" }).click();
  await page.locator("section[aria-labelledby='tv-engines-subs']").waitFor({ timeout: 30000 });
}

async function cardState(page, sub, want = "Connected", timeoutMs = 30000) {
  // The page renders its cards before the Desktop answers — wait for the loaded state instead of
  // reading the placeholder.
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

async function waitMirrorFresh() {
  for (let i = 0; i < 40; i += 1) {
    const { json } = await api("GET", "/api/engines/subscriptions");
    const by = Object.fromEntries((json.subscriptions || []).map((s) => [s.provider, s]));
    if (SUBS.every((s) => by[s.id]?.runner_fresh)) return by;
    await sleep(1500);
  }
  return null;
}

async function makeTeam(page, name) {
  return page.evaluate(
    async ({ name, pmModel, engModel }) => {
      const j = (r) => r.json();
      const team = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template: "two_node", name }),
      }).then(j);
      const id = team.team_graph_id;
      const graph = await fetch(`/api/teams/${id}/graph`).then(j);
      const out = [];
      for (const n of graph.nodes) {
        if (!n.model) continue;
        const model = n.role_name === "pm" ? pmModel : engModel;
        const r = await fetch(`/api/teams/${id}/nodes/${n.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ prompt: n.prompt, model }),
        });
        out.push({ role: n.role_name, model, status: r.status });
      }
      return { id, nodes: out };
    },
    { name, pmModel: PM_MODEL, engModel: ENG_MODEL },
  );
}

function nodeCard(page, title) {
  return page
    .locator(".react-flow__node")
    .filter({ has: page.locator(".rf-node__role", { hasText: new RegExp(`^${title}$`) }) });
}

async function launchRun(page, tag, teamName) {
  // "Run this team" opens Home's composer with this team picked. On Desktop the target picker is
  // "Pick a folder"; the GitHub App repos sit under their own heading in its "Folders" list.
  await page.getByRole("button", { name: "Run this team", exact: true }).click();
  const composer = page.locator("section[aria-label='Start a run']");
  await composer.locator(".hm-picker--team", { hasText: teamName }).waitFor({ timeout: 30000 });
  await composer.getByRole("textbox", { name: "What should the team build?" }).fill(IDEA);
  await composer.locator(".hm-picker--repo").click();
  const option = page
    .getByRole("dialog", { name: /^Pick a (repo|folder)$/ })
    .getByRole("listbox", { name: /^(Repos|Folders)$/ })
    .locator("[role='option']", { has: page.locator(".hm-picker__code", { hasText: new RegExp(`^${REPO}$`) }) });
  await option.waitFor({ timeout: 60000 });
  await option.click();
  await composer.locator(".hm-picker--repo", { hasText: REPO }).waitFor({ timeout: 30000 });
  await shot(page, `${tag}-launch-composer.png`);
  if (PHASE === "dry") return null;
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/runs") && r.method() === "POST"),
    composer.getByRole("button", { name: "Launch", exact: true }).click(),
  ]);
  const body = JSON.parse(req.postData() || "{}");
  check("Run posts a desktop-targeted launch", body.desktop_target === true, JSON.stringify(body));
  const res = await req.response();
  const json = await res.json();
  check(
    `the server accepted it (no API key for ${SUB_PROVIDERS.join("/")} held)`,
    res.status() === 200,
    JSON.stringify(json).slice(0, 300),
  );
  return json.run_id;
}

async function openRun(page, teamId, runId) {
  await page.goto(`${DEV_URL}/#/teams/${teamId}/runs/${runId}`);
  await page.locator("section[aria-label='Activity']").waitFor({ timeout: 60000 });
}

async function events(runId) {
  const { json } = await api("GET", `/api/spike/run-events/${runId}`);
  return json.events || [];
}

async function waitFor(fn, { timeoutMs, everyMs = 3000, what }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function textOf(e) {
  const p = e.payload || {};
  return String(p.text || p.error || p.observation || p.action || "");
}

const startedOn = (sub) => new RegExp(`Running on this computer with your own ${sub.cli}`);
const WORKFLOW_DONE = ["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"];

async function main() {
  if (!["run", "offline", "dry"].includes(PHASE)) throw new Error(`unknown phase: ${PHASE}`);
  check("PM and Engineer each run on a subscription", Boolean(PM_SUB && ENG_SUB), `${PM_MODEL} · ${ENG_MODEL}`);
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  check("node-side session on the local backend", login.status === 200, `HTTP ${login.status}`);
  const provs = (await api("GET", "/api/providers")).json.providers.map((p) => p.provider);
  check(
    `the account holds NO ${SUB_PROVIDERS.join(" or ")} API key`,
    SUB_PROVIDERS.every((p) => !provs.includes(p)),
    provs.join(","),
  );

  let { app, page } = await launchDesktop(PHASE);
  summary.launchShot = await shot(page, `${PHASE}-01-launch.png`);
  await signIn(page);
  await finishSetup(page);
  const mirror = await waitMirrorFresh();
  check(
    "the Desktop pushed status + its runner heartbeats (mirror fresh)",
    Boolean(mirror),
    JSON.stringify(mirror && Object.fromEntries(SUBS.map((s) => [s.id, mirror[s.id]]))),
  );
  await page.reload(); // what the app read before the first heartbeat is stale
  await openEngines(page);
  const disclosure = page.getByRole("note").filter({ hasText: "Tvashtr never sees or stores your login" });
  const shown = await disclosure.waitFor({ timeout: 30000 }).then(() => true, () => false);
  check("Engines: the disclosure shows (exact wording)", shown);
  for (const sub of SUBS) {
    const state = await cardState(page, sub.id);
    check(`Engines: ${sub.name} — Connected`, state === "Connected", state);
  }
  const checkIn = (await page.getByRole("note", { name: "Tvashtr Desktop check-in" }).innerText()).trim();
  check("Engines: Tvashtr Desktop is checking in", /is open and checking in/.test(checkIn), checkIn);
  summary.enginesShot = await shot(page, `${PHASE}-02-engines-connected.png`);

  const teamName = `M-subs-desktop ${PHASE} ${new Date().toISOString().slice(11, 19)}`;
  const team = await makeTeam(page, teamName);
  summary.team = team;
  check(
    `2-node team: PM on ${PM_MODEL}, Engineer on ${ENG_MODEL}`,
    team.nodes.length === 2 && team.nodes.every((n) => n.status === 200),
    JSON.stringify(team.nodes),
  );
  await page.goto(`${DEV_URL}/#/teams/${team.id}`);
  await nodeCard(page, "Engineer").locator(".rf-node__model").click();
  const label = `Your ${ENG_SUB.name} subscription · runs on this computer`;
  await page.getByRole("complementary", { name: "Engineer settings" }).getByText(label).waitFor({ timeout: 30000 });
  check(`Engineer settings: '${label}'`, true);
  summary.pickerShot = await shot(page, `${PHASE}-03-engineer-model.png`);
  await page.keyboard.press("Escape");
  const run = page.getByRole("button", { name: "Run this team", exact: true });
  check("Run this team is enabled (the subscriptions cover both nodes)", await run.isEnabled());

  const runId = await launchRun(page, `${PHASE}-04`, teamName);
  if (PHASE === "dry") {
    check(`the composer is ready to launch at ${REPO} (dry: stops before Launch)`, true);
    return;
  }
  summary.runId = runId;
  log("run", runId);
  await openRun(page, team.id, runId);

  // The PM runs first, then the PRD gate.
  const gate = page.locator("article.tv-task").filter({ hasText: "Awaiting your approval" }).first();
  await gate.waitFor({ timeout: 20 * 60 * 1000 });
  summary.gateShot = await shot(page, `${PHASE}-05-pm-done-gate.png`);
  let evs = await events(runId);
  const pmRan = evs.find((e) => startedOn(PM_SUB).test(textOf(e)));
  check(`the PM ran the user's own ${PM_SUB.cli}`, Boolean(pmRan), pmRan && textOf(pmRan));
  await gate.getByRole("button", { name: "Approve", exact: true }).click();

  if (PHASE === "offline") {
    await waitFor(async () => (await events(runId)).find((e) => startedOn(ENG_SUB).test(textOf(e))), {
      timeoutMs: 10 * 60 * 1000,
      everyMs: 1000,
      what: `the ${ENG_SUB.cli} job to start on this Desktop`,
    });
    summary.midNodeShot = await shot(page, `${PHASE}-06-engineer-running.png`);
    log("quitting Tvashtr Desktop mid-node");
    await app.close();
    const failed = await waitFor(
      async () => {
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        return r.run && r.run.status === "failed" ? r : null;
      },
      { timeoutMs: 6 * 60 * 1000, everyMs: 5000, what: "the run to fail offline" },
    );
    const graph = (await api("GET", `/api/runs/${runId}/graph`)).json;
    const eng = graph.nodes.find((n) => n.role_name === "engineer");
    const inv = (eng.invocations || []).slice(-1)[0] || {};
    summary.offline = { runStatus: failed.run.status, engineer: { status: eng.status, outcome_detail: inv.outcome_detail } };
    check(
      "quitting Desktop mid-node fails it with the offline message",
      inv.outcome_detail === "Tvashtr Desktop went offline — reopen it and retry.",
      JSON.stringify(summary.offline),
    );
    ({ app, page } = await launchDesktop(`${PHASE}-relaunch`));
    await nav(page).waitFor({ timeout: 60000 }); // the same profile: still signed in, setup done
    await openRun(page, team.id, runId);
    await nodeCard(page, "Engineer").click().catch(() => {});
    await sleep(2000);
    summary.offlineShot = await shot(page, `${PHASE}-07-offline-failed.png`);
  } else {
    const done = await waitFor(
      async () => {
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        const terminal = r.run && ["completed", "failed", "rejected", "cancelled", "over_budget"].includes(r.run.status);
        return terminal && WORKFLOW_DONE.includes(r.workflow_status) ? r : null;
      },
      { timeoutMs: 30 * 60 * 1000, everyMs: 5000, what: "the run to reach a terminal status" },
    );
    await sleep(3000);
    summary.finalShot = await shot(page, `${PHASE}-06-terminal.png`);
    evs = await events(runId);
    const pick = (re) => evs.filter((e) => re.test(textOf(e))).map((e) => textOf(e));
    summary.evidence = {
      claudeStarted: pick(/Running on this computer with your own Claude Code/),
      claudeAuth: pick(/apiKeySource/),
      claudePlanWindow: pick(/Claude plan usage window/),
      grokStarted: pick(/Running on this computer with your own Grok Build/),
      grokFinished: pick(/Grok Build finished/),
      sentToDesktop: pick(/Sent to your Tvashtr Desktop/),
    };
    summary.run = {
      status: done.run.status,
      pr_url: done.run.pr_url,
      ship_commit_sha: done.run.ship_commit_sha,
      ship_branch: done.run.ship_branch,
      failure: done.run.failure || null,
    };
    if (SUBS.some((s) => s.id === "claude")) {
      check(
        "the Claude node's own output says it used the subscription (apiKeySource: none)",
        summary.evidence.claudeAuth.some((t) => /apiKeySource: none/.test(t)),
        summary.evidence.claudeAuth.join(" | "),
      );
    }
    check("run reached terminal status completed", done.run.status === "completed", JSON.stringify(summary.run));
    check("the run opened a PR (or shipped a commit)", Boolean(done.run.pr_url || done.run.ship_commit_sha), JSON.stringify(summary.run));
  }
}

main()
  .then(() => {
    summary.ok = true;
  })
  .catch((err) => {
    summary.ok = false;
    summary.error = String(err && err.stack ? err.stack : err);
    console.error(err);
  })
  .finally(async () => {
    summary.finished = new Date().toISOString();
    await current?.close().catch(() => {});
    fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.writeFileSync(path.join(OUT, `summary-${PHASE}.json`), JSON.stringify(summary, null, 2));
    log("summary", path.relative(repoRoot, path.join(OUT, `summary-${PHASE}.json`)), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
