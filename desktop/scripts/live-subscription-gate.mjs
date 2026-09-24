#!/usr/bin/env node
/**
 * M-subs-desktop LIVE gate — drives the REAL Tvashtr Desktop (Electron) with Playwright against a
 * LOCAL backend (never fly.dev), and proves a team's Claude + Grok nodes run on the operator's OWN
 * installed CLIs with their own sign-in.
 *
 *   node desktop/scripts/live-subscription-gate.mjs run      # Engines → team → Run → gate → PR
 *   node desktop/scripts/live-subscription-gate.mjs offline  # quit Desktop mid-node → offline error
 *
 * Needs: `make backend` on :8000, Vite on :5173 proxying /api → :8000 (see desktop/README.md),
 * `make seed` + scripts/demo_proof_seed.py (operator + its GitHub installation), the operator
 * signed in to `claude` and `grok` on this Mac. The Electron app is launched with a Dock-style PATH
 * and WITH the parent shell's API-key / Claude Code session variables still set — the runner must
 * strip them. Screenshots + a JSON summary land in artifacts/desktop-subs/ (gitignored).
 */
import fs from "node:fs";
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
    ? // Long enough that Desktop is quit while the Claude node is still working (it never ships).
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

async function launchDesktop(tag) {
  // Dock-style PATH + the leaky parent env (CLAUDECODE, CLAUDE_CODE_*, any API keys) on purpose.
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TVASHTR_DESKTOP_DEV_URL: DEV_URL,
    TVASHTR_API_BASE: API,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [desktopRoot], env, cwd: desktopRoot });
  const mainLog = fs.createWriteStream(path.join(OUT, `electron-main-${tag}.log`), { flags: "a" });
  app.process().stdout.on("data", (d) => mainLog.write(d));
  app.process().stderr.on("data", (d) => mainLog.write(d));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

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

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  log("screenshot", path.relative(repoRoot, file));
  return path.relative(repoRoot, file);
}

async function openEngines(page) {
  await page.locator('nav[aria-label="Dashboard"] button', { hasText: "Engines" }).click();
  await page.getByRole("heading", { name: "Subscriptions" }).waitFor({ timeout: 30000 });
}

async function cardState(page, name, want = "Connected", timeoutMs = 30000) {
  // The shelf renders its default cards first and fills them in once the Desktop answers — wait
  // for the loaded state instead of reading the placeholder.
  const card = page.locator(".tv-engines__card", { has: page.locator(".tv-engines__card-name", { hasText: name }) });
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = (await card.locator(".tv-engines__pill").innerText()).trim();
    if (text === want) return text;
    await sleep(500);
  }
  return text;
}

async function waitMirrorFresh() {
  for (let i = 0; i < 40; i += 1) {
    const { json } = await api("GET", "/api/engines/subscriptions");
    const by = Object.fromEntries((json.subscriptions || []).map((s) => [s.provider, s]));
    if (by.claude?.runner_fresh && by.grok?.runner_fresh) return by;
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

async function openTeam(page, name) {
  await page.reload(); // the Home team list was fetched before the team was created
  await page.waitForLoadState("domcontentloaded");
  await page.locator('nav[aria-label="Dashboard"] button', { hasText: "Home" }).click();
  await page.getByRole("button", { name: `Open ${name}`, exact: true }).first().click();
  await page.getByRole("button", { name: "Run this team" }).waitFor({ timeout: 60000 });
}

async function launchRun(page, tag) {
  await page.getByRole("button", { name: "Run this team" }).click();
  await page.getByLabel("Feature request").fill(IDEA);
  const repoGroup = page.getByRole("group", { name: "Work on a GitHub repo" });
  await repoGroup.getByRole("button", { name: "On" }).click();
  const select = page.locator('select[aria-label="Repository"]');
  await select.waitFor({ timeout: 30000 });
  await select.selectOption(REPO);
  await shot(page, `${tag}-launch-panel.png`);
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith("/api/runs") && r.method() === "POST"),
    page.getByRole("button", { name: "Run", exact: true }).click(),
  ]);
  const body = JSON.parse(req.postData() || "{}");
  check("Run posts a desktop-targeted launch", body.desktop_target === true, JSON.stringify(body));
  const res = await req.response();
  const json = await res.json();
  check("the server accepted it (no API key for anthropic/xai held)", res.status() === 200, JSON.stringify(json).slice(0, 300));
  return json.run_id;
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

async function main() {
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  check("node-side session on the local backend", login.status === 200, `HTTP ${login.status}`);
  const provs = (await api("GET", "/api/providers")).json.providers.map((p) => p.provider);
  check("the account holds NO anthropic or xai API key", !provs.includes("anthropic") && !provs.includes("xai"), provs.join(","));

  let { app, page } = await launchDesktop(PHASE);
  const note = page.getByRole("note", { name: /subscriptions on this computer/i });
  await note.waitFor({ timeout: 30000 });
  check("the disclosure shows at Desktop launch", (await note.innerText()).includes("never sees or stores your login"));
  summary.launchShot = await shot(page, `${PHASE}-01-launch-disclosure.png`);
  await signIn(page);
  await openEngines(page);
  const mirror = await waitMirrorFresh();
  check("the Desktop pushed status + its runner heartbeats (mirror fresh)", Boolean(mirror), JSON.stringify(mirror && { claude: mirror.claude, grok: mirror.grok }));
  await page.reload();
  await openEngines(page);
  const claude = await cardState(page, "Claude");
  const grok = await cardState(page, "Grok");
  check("Engines: Claude — Connected", claude === "Connected", claude);
  check("Engines: Grok — Connected", grok === "Connected", grok);
  check(
    "Engines: the disclosure is on the cards",
    await page.getByRole("note", { name: "How subscriptions work" }).isVisible(),
  );
  summary.enginesShot = await shot(page, `${PHASE}-02-engines-connected.png`);

  const teamName = `M-subs-desktop ${PHASE} ${new Date().toISOString().slice(11, 19)}`;
  const team = await makeTeam(page, teamName);
  summary.team = team;
  check("2-node team: PM on xai/…, Engineer on anthropic/…", team.nodes.every((n) => n.status === 200), JSON.stringify(team.nodes));
  await openTeam(page, teamName);
  await page.getByText("Engineer", { exact: false }).first().click();
  const label = page.getByText("via your Claude subscription · runs on this computer");
  await label.waitFor({ timeout: 30000 });
  check("node picker: 'via your Claude subscription · runs on this computer'", true);
  summary.pickerShot = await shot(page, `${PHASE}-03-node-picker.png`);
  await page.keyboard.press("Escape");

  const runId = await launchRun(page, `${PHASE}-04`);
  summary.runId = runId;
  log("run", runId);

  // The PM (Grok) runs first, then the PRD gate.
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.waitFor({ timeout: 20 * 60 * 1000 });
  summary.gateShot = await shot(page, `${PHASE}-05-pm-done-gate.png`);
  let evs = await events(runId);
  const grokRan = evs.find((e) => /Running on this computer with your own Grok Build/.test(textOf(e)));
  check("the Grok node ran the user's own `grok` CLI", Boolean(grokRan), grokRan && textOf(grokRan));
  await approve.click();

  if (PHASE === "offline") {
    await waitFor(
      async () => (await events(runId)).find((e) => /Running on this computer with your own Claude Code/.test(textOf(e))),
      { timeoutMs: 10 * 60 * 1000, everyMs: 1000, what: "the Claude job to start on this Desktop" },
    );
    summary.midNodeShot = await shot(page, `${PHASE}-06-claude-running.png`);
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
    await page.locator('nav[aria-label="Dashboard"] button', { hasText: "Home" }).click().catch(() => {});
    await page.getByRole("button", { name: new RegExp(`runs for ${teamName}`) }).first().click().catch(() => {});
    await page.getByRole("button", { name: /Open run:/ }).first().click().catch(() => {});
    await sleep(4000);
    await page.getByText("Engineer", { exact: false }).first().click().catch(() => {});
    await sleep(2000);
    summary.offlineShot = await shot(page, `${PHASE}-07-offline-failed.png`);
    await app.close();
  } else {
    const done = await waitFor(
      async () => {
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        return r.run && ["completed", "failed", "rejected", "cancelled", "over_budget"].includes(r.run.status) ? r : null;
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
    summary.run = { status: done.run.status, pr_url: done.run.pr_url, ship_commit_sha: done.run.ship_commit_sha, ship_branch: done.run.ship_branch };
    check("the Claude node's own output says it used the subscription (apiKeySource: none)", summary.evidence.claudeAuth.some((t) => /apiKeySource: none/.test(t)), summary.evidence.claudeAuth.join(" | "));
    check("run reached terminal status completed", done.run.status === "completed", JSON.stringify(summary.run));
    check("the run opened a PR (or shipped a commit)", Boolean(done.run.pr_url || done.run.ship_commit_sha), JSON.stringify(summary.run));
    await app.close();
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
  .finally(() => {
    summary.finished = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `summary-${PHASE}.json`), JSON.stringify(summary, null, 2));
    log("summary", path.relative(repoRoot, path.join(OUT, `summary-${PHASE}.json`)), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
