#!/usr/bin/env node
/**
 * M-desk-2 LIVE gate — drives the REAL Tvashtr Desktop (Electron) with Playwright against a LOCAL
 * backend and proves that saving a version with "Run tests" and with "Save and check" runs those
 * agents on the operator's OWN Claude/Grok CLI sign-ins through the Desktop runner, with NO
 * anthropic/xai API key on the account, and that each Desktop string of E2 renders as drawn on its
 * board (brief prompts/m-desk-2.md, acceptance 4). A sibling of live-desk-routes-gate.mjs.
 *
 *   node desktop/scripts/live-desk-2-gate.mjs
 *   node desktop/scripts/live-desk-2-gate.mjs --subtitle <team id> <compare id>
 *
 * The second form only opens a finished one-task Desktop compare's results (no run is started) for
 * the results subtitle. Needs: the local stack on :8000 (backend with TVASHTR_AUTO_APPROVE_GATES=1)
 * and Vite on :5173, both THIS checkout's; the account seeded with no anthropic/xai credential; the
 * operator signed in to `claude` and `grok`. The Desktop runs in a throwaway Electron profile
 * (--user-data-dir), never the Mac's own. Budget: one setup run, one save with tests (one replay),
 * one save-and-check (two runs). Screenshots + summary land in artifacts/desk-2/ (gitignored).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.join(__dirname, "..");
const repoRoot = path.join(desktopRoot, "..");
const require = createRequire(path.join(repoRoot, "frontend", "package.json"));
const { _electron: electron } = require("@playwright/test");

const OUT = path.join(repoRoot, "artifacts", "desk-2");
const DEV_URL = process.env.TVASHTR_DESKTOP_DEV_URL || "http://127.0.0.1:5173";
const API = process.env.TVASHTR_API_BASE || "http://localhost:8000";
const EMAIL = process.env.TVASHTR_SEED_EMAIL || "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_SEED_PASSWORD || "tvashtr-dev";
const PM_MODEL = process.env.TVASHTR_SUBS_PM_MODEL || "xai/grok-4.7";
const ENG_MODEL = process.env.TVASHTR_SUBS_ENG_MODEL || "anthropic/claude-sonnet-5";
const IDEA = "Create README.md containing exactly one line: Built with Tvashtr. Change nothing else.";
const SET_TASK = "Create NOTES.md containing exactly one line: hello. Change nothing else.";
const HIDDEN_CHECK = "grep -qx 'hello' NOTES.md";
const BOTH = "your Claude and Grok subscriptions";
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
const SUBTITLE = process.argv[2] === "--subtitle" ? { team: process.argv[3], compare: process.argv[4] } : null;

fs.mkdirSync(OUT, { recursive: true });
const summary = { started: new Date().toISOString(), mode: SUBTITLE ? "subtitle" : "full", checks: [], shots: {} };
const log = (...a) => console.log("[desk-2]", ...a);
function check(name, ok, detail) {
  summary.checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail || ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TERMINAL = ["completed", "failed", "rejected", "cancelled", "over_budget"];

// ---- a node-side session (polling, evidence) --------------------------------------------------
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

async function waitFor(fn, { timeoutMs, everyMs = 3000, what }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function shot(page, name, key) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  const rel = path.relative(repoRoot, file);
  summary.shots[key || name] = rel;
  log("screenshot", rel);
  return rel;
}

/** The stack answering on :8000 and :5173 must be THIS checkout's — never another session's. */
function ownStack() {
  const cwdOf = (port) => {
    const pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`).toString().split(/\s+/).filter(Boolean);
    return pids.map((pid) => execSync(`lsof -a -p ${pid} -d cwd -Fn || true`).toString().split("\n").find((l) => l.startsWith("n"))?.slice(1) || "");
  };
  const cwds = [...cwdOf(8000), ...cwdOf(5173)];
  return { ok: cwds.length >= 2 && cwds.every((c) => c.startsWith(repoRoot + path.sep)), cwds };
}

/** No other Tvashtr Desktop (another checkout's Electron, or the installed app) may be running. */
function otherDesktops() {
  const lines = execSync("ps -axo command || true").toString().split("\n");
  return lines.filter(
    (l) =>
      (/Tvashtr\.app\/Contents\/MacOS\//.test(l) || (/Electron\.app\/Contents\/MacOS\/Electron/.test(l) && /tvashtr|Tvashtr/.test(l))) &&
      !l.includes(repoRoot),
  );
}

async function launchDesktop(profile) {
  // Dock-style PATH + the parent env (any API keys, Claude Code session vars) on purpose: the
  // runner must strip them, so the CLIs can only use the operator's own sign-in. A throwaway
  // profile (--user-data-dir): the Mac's own Desktop settings are never read or written.
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TVASHTR_DESKTOP_DEV_URL: DEV_URL,
    TVASHTR_API_BASE: API,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [`--user-data-dir=${profile}`, desktopRoot],
    env,
    cwd: desktopRoot,
  });
  const mainLog = fs.createWriteStream(path.join(OUT, "electron-main.log"), { flags: "a" });
  app.process().stdout.on("data", (d) => mainLog.write(d));
  app.process().stderr.on("data", (d) => mainLog.write(d));
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}

async function inPage(page, method, p, body) {
  return page.evaluate(
    async ({ method, p, body }) => {
      const r = await fetch(p, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const t = await r.text();
      let j = null;
      try {
        j = JSON.parse(t);
      } catch {
        j = t;
      }
      return { status: r.status, json: j };
    },
    { method, p, body },
  );
}

async function go(page, hash) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await sleep(1500);
}

/** Open a hash afresh (the app reads the team's versions again). */
async function reopen(page, hash) {
  await go(page, hash);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
  await sleep(2000);
}

async function runEvents(runId) {
  const { json } = await api("GET", `/api/spike/run-events/${runId}`);
  return (json && json.events) || [];
}
const textOf = (e) => String((e.payload || {}).text || (e.payload || {}).error || "");
const keySourceOf = async (runId) => (await runEvents(runId)).map(textOf).filter((t) => /apiKeySource/.test(t));

/** Sign in in the Desktop's own origin and finish this account's first-run setup (in the throwaway
 *  profile, as "Skip for now" does; the plan consent is left to the operator). */
async function signIn(page) {
  const signedIn = await inPage(page, "POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  check("signed in through the Desktop's own origin", signedIn.status === 200, `HTTP ${signedIn.status}`);
  const me = await inPage(page, "GET", "/api/auth/me");
  await page.evaluate(async (id) => {
    const s = await window.tvashtrDesktop.setup.get(id);
    if (!s || !s.finishedAt) await window.tvashtrDesktop.setup.update(id, { finishedAt: new Date().toISOString() });
  }, me.json.id);
  await page.reload();
  await page.waitForLoadState("domcontentloaded");
}

async function preflight() {
  const own = ownStack();
  check("the backend (:8000) and Vite (:5173) are this checkout's", own.ok, own.cwds.join(" | ") || "nothing listening");
  const others = otherDesktops();
  check("no other Tvashtr Desktop is running", others.length === 0, others.join(" | ") || "none");
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  check("node-side session on the LOCAL backend", login.status === 200, `HTTP ${login.status}`);
  const provs = (await api("GET", "/api/providers")).json.providers.map((p) => p.provider);
  check("the account holds NO anthropic or xai API key", !provs.includes("anthropic") && !provs.includes("xai"), provs.join(",") || "(none)");
}

// ---- --subtitle: a finished one-task Desktop compare's results (no run started) -----------------
async function subtitle(page) {
  await go(page, `#/teams/${SUBTITLE.team}/compare/${SUBTITLE.compare}`);
  const sub = page.locator(".cmp-res__sub");
  await sub.waitFor({ timeout: 60_000 });
  const text = await sub.textContent();
  summary.subtitle = text;
  check("Cmp-ResultsDesktop: the subtitle says the lanes took turns on the Desktop", /^Same task, same repo, taking turns on your Desktop · finished /.test(text || ""), text);
  await shot(page, "c5-compare-results-subtitle.png", "resultsSubtitle");
}

// ---- the full gate ------------------------------------------------------------------------------
async function full(page) {
  const fresh = await waitFor(
    async () => {
      const { json } = await api("GET", "/api/engines/subscriptions");
      const by = Object.fromEntries(((json && json.subscriptions) || []).map((s) => [s.provider, s]));
      return by.claude?.runner_fresh && by.grok?.runner_fresh ? by : null;
    },
    { timeoutMs: 120_000, everyMs: 1500, what: "Claude + Grok connected and the runner fresh" },
  );
  check("Claude and Grok connected; the Desktop runner is polling", Boolean(fresh), JSON.stringify({ claude: fresh.claude.state, grok: fresh.grok.state }));
  await go(page, "#/engines");
  await shot(page, "00-engines.png", "engines");

  // ---- setup: a 2-node library team (PM on Grok, Engineer on Claude), one run (v1) -------------
  const team = await inPage(page, "POST", "/api/teams", { template: "two_node", name: `M-desk-2 ${new Date().toISOString().slice(11, 19)}` });
  const teamId = team.json.team_graph_id;
  const graph = (await inPage(page, "GET", `/api/teams/${teamId}/graph`)).json;
  for (const n of graph.nodes) {
    if (!n.model) continue;
    const model = n.role_name === "pm" ? PM_MODEL : ENG_MODEL;
    const r = await inPage(page, "PATCH", `/api/teams/${teamId}/nodes/${n.id}`, { model });
    check(`team node ${n.role_name} on ${model}`, r.status === 200, `HTTP ${r.status}`);
  }
  const libEng = graph.nodes.find((n) => n.role_name === "engineer");
  const libPm = graph.nodes.find((n) => n.role_name === "pm");
  summary.team = teamId;
  const launch = await inPage(page, "POST", "/api/runs", { team_graph_id: teamId, idea: IDEA, desktop_target: true });
  check("setup run accepted from the Desktop with no anthropic/xai key", launch.status === 200, JSON.stringify(launch.json).slice(0, 200));
  const runId = launch.json.run_id;
  summary.setupRun = { id: runId, version: launch.json.team_version_number };
  const done = await waitFor(
    async () => {
      const r = (await api("GET", `/api/runs/${runId}`)).json;
      return r && r.run && TERMINAL.includes(r.run.status) ? r.run : null;
    },
    { timeoutMs: 30 * 60_000, everyMs: 5000, what: "the setup run to end" },
  );
  check("setup run completed through the Desktop", done.status === "completed", done.status);
  const setupKeys = await keySourceOf(runId);
  check("the setup run's Claude CLI used the subscription (apiKeySource: none)", setupKeys.some((t) => /apiKeySource: none/.test(t)), setupKeys.join(" | "));

  // ---- (c) New test footer, then the test itself (from the Engineer's round 1) -----------------
  await go(page, `#/teams/${teamId}?node=${libEng.id}&tab=runs`);
  const drawer = page.getByRole("complementary", { name: /settings$/ });
  const more = drawer.getByRole("button", { name: "More for round 1" });
  await more.first().waitFor({ timeout: 60_000 });
  await more.first().click();
  await drawer.getByRole("menu", { name: "More for round 1" }).getByRole("menuitem", { name: /Make this a test/ }).click();
  const dialog = page.getByRole("dialog", { name: "New test from round 1" });
  await dialog.waitFor({ timeout: 30_000 });
  const footer = dialog.getByText("Replaying runs on your Claude subscription", { exact: true });
  await footer.waitFor({ timeout: 30_000 });
  check("Test-EstimateDesktop: the New test footer names the subscription", (await dialog.getByText(/on your keys/).count()) === 0, await footer.textContent());
  await shot(page, "c1-new-test-footer.png", "newTestFooter");
  await dialog.getByLabel("Test name").fill("Names README.md");
  const prefilled = dialog.getByRole("button", { name: /^Remove / });
  while ((await prefilled.count()) > 0) await prefilled.first().click();
  await dialog.getByRole("button", { name: "Add a check" }).click();
  await page.getByRole("menuitem", { name: /Must name a file/ }).click();
  await dialog.getByRole("textbox", { name: "Must name a file", exact: true }).fill("README.md");
  await dialog.getByRole("button", { name: "Save test" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 30_000 });

  // ---- (c) the Tests tab's estimate box ---------------------------------------------------------
  await go(page, `#/teams/${teamId}?node=${libEng.id}&tab=tests`);
  const box = page.locator(".tt-estimate");
  await page.getByRole("button", { name: /^Run all 1$/ }).waitFor({ timeout: 30_000 });
  const boxText = await waitFor(async () => {
    const t = (await box.textContent()) || "";
    return /on your Claude subscription · about \d+ min\./.test(t) ? t : null;
  }, { timeoutMs: 30_000, everyMs: 1000, what: "the Desktop estimate box" });
  check("Test-EstimateDesktop: the estimate box names the subscription", /^Replays only the .+, on saved inputs, on your Claude subscription · about \d+ min\./.test(boxText) && !/on your keys/.test(boxText), boxText);
  await shot(page, "c2-tests-estimate.png", "testsEstimate");

  // ---- (a) save v2 with "Run tests" ticked; (c) the save dialog ---------------------------------
  const eng2 = await inPage(page, "PATCH", `/api/teams/${teamId}/nodes/${libEng.id}`, { prompt: `${libEng.prompt}\nKeep every change tiny.` });
  check("the Engineer's instructions changed (v2 to save)", eng2.status === 200, `HTTP ${eng2.status}`);
  await reopen(page, `#/teams/${teamId}`);
  await page.getByRole("button", { name: "Save as v2" }).click({ timeout: 60_000 });
  const save = page.getByRole("dialog", { name: "Save as v2" });
  await save.waitFor({ timeout: 30_000 });
  const option = save.getByText(/^About \d+ min on your Claude subscription\. Results show next to v2 in History\.$/);
  await option.waitFor({ timeout: 30_000 });
  check("Save-NudgeDesktop: the option names the subscription", (await save.getByText(/on your keys/).count()) === 0, await option.textContent());
  await shot(page, "c3-save-dialog.png", "saveDialog");
  const [saveReq] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith(`/api/teams/${teamId}/versions`) && r.method() === "POST"),
    save.getByRole("button", { name: "Save and run tests" }).click(),
  ]);
  const saveBody = JSON.parse(saveReq.postData() || "{}");
  check("Save and run tests posts desktop_target from the Desktop", saveBody.run_tests === true && saveBody.desktop_target === true, JSON.stringify(saveBody));
  const saved = await (await saveReq.response()).json();
  summary.saveWithTests = { number: saved.number, tests_started: saved.tests_started };
  check("v2 saved and its tests started", saved.number === 2 && (saved.tests_started || []).length === 1, JSON.stringify(saved.tests_started));
  const testsBase = `/api/teams/${teamId}/nodes/${libEng.id}/tests`;
  const testRun = await waitFor(
    async () => {
      const r = (await api("GET", testsBase)).json;
      return r && r.run && r.run.status !== "running" ? r.run : null;
    },
    { timeoutMs: 20 * 60_000, everyMs: 4000, what: "the save's test run to end" },
  );
  const result = testRun.results[0];
  summary.testRun = { id: testRun.id, version: testRun.version, trigger: testRun.trigger, status: testRun.status, result: { id: result.id, status: result.status, error: result.error, answer: (result.answer || "").slice(0, 200) } };
  check("the save's replay came back through a Desktop job", testRun.status === "done" && testRun.version === 2 && ["passed", "failed"].includes(result.status) && !result.error, JSON.stringify(summary.testRun));
  await go(page, `#/teams/${teamId}?node=${libEng.id}&tab=tests`);
  await sleep(2500);
  await shot(page, "a-save-tests-result.png", "saveTestsResult");

  // ---- (c) Compare start line + estimate (nothing is started) -------------------------------------
  const set = await inPage(page, "POST", `/api/teams/${teamId}/task-sets`, {
    name: "One task",
    items: [{ task: SET_TASK, starts_from: null, hidden_check: HIDDEN_CHECK }],
  });
  check("a one-task set", set.status === 201, `HTTP ${set.status}`);
  await go(page, `#/teams/${teamId}/compare`);
  await page.getByRole("button", { name: "Start compare" }).waitFor({ timeout: 30_000 });
  const lede = await waitFor(async () => {
    const t = (await page.locator(".cmp-lede").textContent()) || "";
    return /taking turns/.test(t) ? t : null;
  }, { timeoutMs: 30_000, everyMs: 1000, what: "the Desktop start line" });
  check("Cmp-StartDesktop: the start line says the versions take turns", lede === `Both run on separate copies of the repo, taking turns on ${BOTH}. Nothing ships and no pull request is opened.`, lede);
  const foot = (await page.locator(".cmp-start__foot span").first().textContent()) || "";
  check("Cmp-StartDesktop: the estimate names the subscriptions", new RegExp(`^On ${BOTH} · about \\d+ min$`).test(foot), foot);
  await shot(page, "c4-compare-start.png", "compareStart");
  await page.getByRole("radio", { name: "A task set" }).click();
  const setFoot = page.getByText(/× 2 versions/);
  await setFoot.waitFor({ timeout: 30_000 });
  const setText = (await setFoot.textContent()) || "";
  check("Cmp-StartDesktop: the task set's estimate names the subscriptions", new RegExp(`^On ${BOTH} · about \\d+ min · 1 task × 2 versions$`).test(setText), setText);
  await shot(page, "c4b-compare-start-set.png", "compareStartSet");

  // ---- (b) "Save and check" on the one-task set (v3 changes the PM only: no tests offered) ------
  const pm3 = await inPage(page, "PATCH", `/api/teams/${teamId}/nodes/${libPm.id}`, { prompt: `${libPm.prompt}\nKeep the spec short.` });
  check("the PM's instructions changed (v3 to save)", pm3.status === 200, `HTTP ${pm3.status}`);
  await reopen(page, `#/teams/${teamId}`);
  await page.getByRole("button", { name: "Save as v3" }).click({ timeout: 60_000 });
  const save3 = page.getByRole("dialog", { name: "Save as v3" });
  await save3.waitFor({ timeout: 30_000 });
  await save3.getByText("Compare v3 with v2 on One task").waitFor({ timeout: 30_000 });
  const [checkReq] = await Promise.all([
    page.waitForRequest((r) => r.url().endsWith(`/api/teams/${teamId}/versions`) && r.method() === "POST"),
    save3.getByRole("button", { name: "Save and check" }).click(),
  ]);
  const checkBody = JSON.parse(checkReq.postData() || "{}");
  check("Save and check posts desktop_target from the Desktop", Boolean(checkBody.check_set) && checkBody.desktop_target === true && !checkBody.run_tests, JSON.stringify(checkBody));
  const checked = await (await checkReq.response()).json();
  check("v3 saved and its set check started (no refusal)", checked.number === 3 && checked.check_error === null && Boolean(checked.check_started), JSON.stringify({ check_started: checked.check_started, check_error: checked.check_error }));
  const cid = checked.check_started.compare_id;
  summary.saveAndCheck = { compare: cid };
  const ended = await waitFor(
    async () => {
      const v = (await api("GET", `/api/compares/${cid}`)).json;
      return ["finished", "stopped"].includes(v.status) ? v : null;
    },
    { timeoutMs: 40 * 60_000, everyMs: 4000, what: "the set check to finish" },
  );
  const cells = (ended.items || []).flatMap((it) => [it.a, it.b]);
  summary.saveAndCheck.cells = cells.map((c) => ({ status: c.status, run_id: c.run_id, check: c.check }));
  check("both runs of the check finished through the Desktop", ended.status === "finished" && cells.length === 2 && cells.every((c) => c.status === "finished" && c.run_id), JSON.stringify(summary.saveAndCheck.cells));
  for (const c of cells) {
    const src = await keySourceOf(c.run_id);
    check(`check run ${c.run_id.slice(0, 8)}'s Claude CLI used the subscription (apiKeySource: none)`, src.some((t) => /apiKeySource: none/.test(t)), src.join(" | "));
  }
  await go(page, `#/teams/${teamId}/compare/${cid}`);
  await page.getByRole("table", { name: "Results" }).waitFor({ timeout: 30_000 });
  await sleep(1500);
  await shot(page, "b-save-check-results.png", "saveCheckResults");
}

async function main() {
  await preflight();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-desk2-profile-"));
  summary.profile = "throwaway (--user-data-dir under the OS temp dir; removed after)";
  const { app, page } = await launchDesktop(profile);
  try {
    await signIn(page);
    if (SUBTITLE) await subtitle(page);
    else await full(page);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
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
    const name = SUBTITLE ? "summary-desk-2-subtitle.json" : "summary-desk-2.json";
    fs.writeFileSync(path.join(OUT, name), JSON.stringify(summary, null, 2));
    log("summary", path.relative(repoRoot, path.join(OUT, name)), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
