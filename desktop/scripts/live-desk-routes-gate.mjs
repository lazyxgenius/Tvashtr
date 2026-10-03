#!/usr/bin/env node
/**
 * M-desk-routes LIVE gate — drives the REAL Tvashtr Desktop (Electron) with Playwright against a
 * LOCAL backend and proves that Ask, an agent test and a Compare run on the operator's OWN
 * Claude/Grok CLI sign-ins through the Desktop runner, with NO anthropic/xai API key on the account
 * (brief prompts/m-desk-routes.md, acceptance 4). A sibling of live-subscription-gate.mjs.
 *
 *   node desktop/scripts/live-desk-routes-gate.mjs
 *
 * Needs: the local stack on :8000 (backend started with TVASHTR_AUTO_APPROVE_GATES=1) and Vite on
 * :5173, `make seed` done with no anthropic/xai credential on the operator, and the operator signed
 * in to `claude` and `grok` on this Mac. Budget: one setup run, one Ask, one replay, one compare (two
 * runs). Screenshots + summary-desk-routes.json land in artifacts/desk-routes/ (gitignored).
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

const OUT = path.join(repoRoot, "artifacts", "desk-routes");
const DEV_URL = process.env.TVASHTR_DESKTOP_DEV_URL || "http://127.0.0.1:5173";
const API = process.env.TVASHTR_API_BASE || "http://localhost:8000";
const EMAIL = process.env.TVASHTR_SEED_EMAIL || "operator@tvashtr.local";
const PASSWORD = process.env.TVASHTR_SEED_PASSWORD || "tvashtr-dev";
const PM_MODEL = process.env.TVASHTR_SUBS_PM_MODEL || "xai/grok-4.7";
const ENG_MODEL = process.env.TVASHTR_SUBS_ENG_MODEL || "anthropic/claude-sonnet-5";
const IDEA = "Create README.md containing exactly one line: Built with Tvashtr. Change nothing else.";
const QUESTION = "Why did you change README.md?";
const COMPARE_TASK = "Create NOTES.md containing exactly one line: hello. Change nothing else.";
const WORK_LINE =
  "On your Desktop, both versions share your subscription and take turns, so this counts working time only.";
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
const summary = { started: new Date().toISOString(), checks: [], shots: {} };
const log = (...a) => console.log("[desk-routes]", ...a);
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

async function launchDesktop() {
  // Dock-style PATH + the parent env (any API keys, Claude Code session vars) on purpose: the
  // runner must strip them, so the CLIs can only use the operator's own sign-in.
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TVASHTR_DESKTOP_DEV_URL: DEV_URL,
    TVASHTR_API_BASE: API,
    ELECTRON_ENABLE_LOGGING: "1",
  };
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [desktopRoot], env, cwd: desktopRoot });
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

async function runEvents(runId) {
  const { json } = await api("GET", `/api/spike/run-events/${runId}`);
  return (json && json.events) || [];
}
const textOf = (e) => String((e.payload || {}).text || (e.payload || {}).error || "");

/** The stack answering on :8000 and :5173 must be THIS checkout's — never another session's. */
function ownStack() {
  const { execSync } = require("node:child_process");
  const cwdOf = (port) => {
    const pids = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`).toString().split(/\s+/).filter(Boolean);
    return pids.map((pid) => execSync(`lsof -a -p ${pid} -d cwd -Fn || true`).toString().split("\n").find((l) => l.startsWith("n"))?.slice(1) || "");
  };
  const cwds = [...cwdOf(8000), ...cwdOf(5173)];
  return { ok: cwds.length >= 2 && cwds.every((c) => c.startsWith(repoRoot + path.sep)), cwds };
}

async function main() {
  const own = ownStack();
  check("the backend (:8000) and Vite (:5173) are this checkout's", own.ok, own.cwds.join(" | ") || "nothing listening");
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  check("node-side session on the LOCAL backend", login.status === 200, `HTTP ${login.status}`);
  const provs = (await api("GET", "/api/providers")).json.providers.map((p) => p.provider);
  check("the account holds NO anthropic or xai API key", !provs.includes("anthropic") && !provs.includes("xai"), provs.join(",") || "(none)");

  const { app, page } = await launchDesktop();
  try {
    const signIn = await inPage(page, "POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
    check("signed in through the Desktop's own origin", signIn.status === 200, `HTTP ${signIn.status}`);
    // A fresh local account has this Mac's first-run setup unfinished, and the app holds every
    // address on #/setup until it is: finish it the way "Skip for now" does (this account only).
    // The plan-usage consent is left to the operator.
    const me = await inPage(page, "GET", "/api/auth/me");
    await page.evaluate(async (id) => {
      const s = await window.tvashtrDesktop.setup.get(id);
      if (!s || !s.finishedAt) await window.tvashtrDesktop.setup.update(id, { finishedAt: new Date().toISOString() });
    }, me.json.id);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    const fresh = await waitFor(
      async () => {
        const { json } = await api("GET", "/api/engines/subscriptions");
        const by = Object.fromEntries(((json && json.subscriptions) || []).map((s) => [s.provider, s]));
        return by.claude?.runner_fresh && by.grok?.runner_fresh ? by : null;
      },
      { timeoutMs: 90_000, everyMs: 1500, what: "Claude + Grok connected and the runner fresh" },
    );
    check("Claude and Grok connected; the Desktop runner is polling", Boolean(fresh), JSON.stringify({ claude: fresh.claude.state, grok: fresh.grok.state }));
    await go(page, "#/engines");
    await shot(page, "00-engines.png", "engines");

    // ---- setup: a 2-node library team (PM on Grok, Engineer on Claude), v1 + v2, one run --------
    const team = await inPage(page, "POST", "/api/teams", { template: "two_node", name: `M-desk ${new Date().toISOString().slice(11, 19)}` });
    const teamId = team.json.team_graph_id;
    const graph = (await inPage(page, "GET", `/api/teams/${teamId}/graph`)).json;
    for (const n of graph.nodes) {
      if (!n.model) continue;
      const model = n.role_name === "pm" ? PM_MODEL : ENG_MODEL;
      const r = await inPage(page, "PATCH", `/api/teams/${teamId}/nodes/${n.id}`, { model });
      check(`team node ${n.role_name} on ${model}`, r.status === 200, `HTTP ${r.status}`);
    }
    const libEng = graph.nodes.find((n) => n.role_name === "engineer").id;
    summary.team = teamId;

    const launch = await inPage(page, "POST", "/api/runs", { team_graph_id: teamId, idea: IDEA, desktop_target: true });
    check("setup run accepted from the Desktop with no anthropic/xai key", launch.status === 200, JSON.stringify(launch.json).slice(0, 200));
    const runId = launch.json.run_id;
    summary.setupRun = runId;
    const done = await waitFor(
      async () => {
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        return r && r.run && TERMINAL.includes(r.run.status) ? r.run : null;
      },
      { timeoutMs: 30 * 60_000, everyMs: 5000, what: "the setup run to end" },
    );
    check("setup run completed through the Desktop", done.status === "completed", done.status);
    const evs = await runEvents(runId);
    const keySource = evs.map(textOf).filter((t) => /apiKeySource/.test(t));
    summary.setupEvidence = {
      claude: evs.map(textOf).filter((t) => /Running on this computer with your own Claude Code/.test(t)),
      grok: evs.map(textOf).filter((t) => /Running on this computer with your own Grok Build/.test(t)),
      keySource,
    };
    check("the setup run's Claude CLI used the subscription (apiKeySource: none)", keySource.some((t) => /apiKeySource: none/.test(t)), keySource.join(" | "));

    // ---- (a) Ask the Engineer, in the Desktop ---------------------------------------------------
    const runGraph = (await api("GET", `/api/runs/${runId}/graph`)).json;
    const runEng = runGraph.nodes.find((n) => n.role_name === "engineer").id;
    await go(page, `#/teams/${teamId}/runs/${runId}`);
    await page.locator(`[data-id="${runEng}"]`).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Ask", exact: true }).click({ timeout: 60_000 });
    await page.getByLabel("Ask this node").fill(QUESTION);
    const [askReq] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith(`/nodes/${runEng}/ask`) && r.method() === "POST"),
      page.getByRole("button", { name: "Send", exact: true }).click(),
    ]);
    const askBody = JSON.parse(askReq.postData() || "{}");
    check("Ask posts desktop_target from the Desktop", askBody.desktop_target === true, JSON.stringify(askBody));
    const askRes = await askReq.response();
    const askJson = await askRes.json();
    check("Ask answered 202 with an ask_id (a Desktop job, no API key)", askRes.status() === 202 && Boolean(askJson.ask_id), JSON.stringify(askJson));
    summary.askId = askJson.ask_id;
    await page.locator(".tv-chat__msg--assistant").first().waitFor({ timeout: 15 * 60_000 });
    const asked = (await api("GET", `/api/runs/${runId}/nodes/${runEng}/asks/${askJson.ask_id}`)).json;
    summary.ask = asked;
    check("the Ask's answer came back through the Desktop", asked.status === "completed" && Boolean(asked.answer), (asked.answer || asked.error || "").slice(0, 200));
    await shot(page, "a-ask-answered.png", "ask");

    // ---- (b) make a test from the Engineer's round, run it in the Desktop -------------------------
    await go(page, `#/teams/${teamId}?node=${libEng}&tab=runs`);
    const drawer = page.getByRole("complementary", { name: /settings$/ });
    const more = drawer.getByRole("button", { name: "More for round 1" });
    await more.first().waitFor({ timeout: 60_000 });
    await more.first().click();
    await drawer.getByRole("menu", { name: "More for round 1" }).getByRole("menuitem", { name: /Make this a test/ }).click();
    const dialog = page.getByRole("dialog", { name: "New test from round 1" });
    await dialog.waitFor({ timeout: 30_000 });
    await dialog.getByLabel("Test name").fill("Names README.md");
    const prefilled = dialog.getByRole("button", { name: /^Remove / });
    while ((await prefilled.count()) > 0) await prefilled.first().click();
    await dialog.getByRole("button", { name: "Add a check" }).click();
    await page.getByRole("menuitem", { name: /Must name a file/ }).click();
    await dialog.getByRole("textbox", { name: "Must name a file", exact: true }).fill("README.md");
    await dialog.getByRole("button", { name: "Save test" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 30_000 });
    await go(page, `#/teams/${teamId}?node=${libEng}&tab=tests`);
    const runAll = page.getByRole("button", { name: /^Run all 1$/ });
    await runAll.waitFor({ timeout: 30_000 });
    const [testReq] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith(`/nodes/${libEng}/tests/run`) && r.method() === "POST"),
      runAll.click(),
    ]);
    check("Run all posts desktop_target from the Desktop", JSON.parse(testReq.postData() || "{}").desktop_target === true, testReq.postData());
    const testsBase = `/api/teams/${teamId}/nodes/${libEng}/tests`;
    const testRun = await waitFor(
      async () => {
        const r = (await api("GET", testsBase)).json;
        return r && r.run && r.run.status !== "running" ? r.run : null;
      },
      { timeoutMs: 20 * 60_000, everyMs: 4000, what: "the test run to end" },
    );
    summary.testRun = { status: testRun.status, results: testRun.results.map((r) => ({ id: r.id, status: r.status, error: r.error, answer: (r.answer || "").slice(0, 200) })) };
    const result = testRun.results[0];
    check("the replay's result came back through a Desktop job", testRun.status === "done" && ["passed", "failed"].includes(result.status) && !result.error, JSON.stringify(summary.testRun.results));
    summary.replayId = result.id;
    await sleep(2500);
    await shot(page, "b-test-result.png", "test");

    // ---- (c) compare v1 and v2 in the Desktop ------------------------------------------------------
    await inPage(page, "GET", `/api/teams/${teamId}/versions`); // v1
    await inPage(page, "PATCH", `/api/teams/${teamId}/nodes/${libEng}`, { prompt: `${graph.nodes.find((n) => n.id === libEng).prompt}\nKeep every change tiny.` });
    const v2 = await inPage(page, "POST", `/api/teams/${teamId}/versions`, {});
    check("v2 saved", v2.status === 201, `HTTP ${v2.status}`);
    await go(page, `#/teams/${teamId}/compare`);
    const task = page.getByRole("textbox", { name: "Task" });
    await task.waitFor({ timeout: 30_000 });
    await task.fill(COMPARE_TASK);
    const [cmpReq] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith(`/teams/${teamId}/compare`) && r.method() === "POST"),
      page.getByRole("button", { name: "Start compare" }).click(),
    ]);
    const cmpBody = JSON.parse(cmpReq.postData() || "{}");
    check("Start compare posts desktop_target from the Desktop", cmpBody.desktop_target === true, JSON.stringify(cmpBody));
    const cmpJson = await (await cmpReq.response()).json();
    const cid = cmpJson.id;
    summary.compare = { id: cid, runs: cmpJson.runs };
    check("the compare launched both runs at once", cmpJson.status === "running" && cmpJson.runs.every((r) => r.run_id), JSON.stringify(cmpJson));
    let sawWaiting = null;
    const ended = await waitFor(
      async () => {
        const v = (await api("GET", `/api/compares/${cid}`)).json;
        const waiting = (v.sides || []).find((s) => s.current && /^Waiting for your (Claude|Grok) subscription/.test(s.current.text || ""));
        if (waiting && !sawWaiting) {
          sawWaiting = { side: waiting.label, current: waiting.current, other: (v.sides || []).find((s) => s.label !== waiting.label)?.current };
          await shot(page, "c-compare-lane-waiting.png", "compareWaiting");
        }
        return ["finished", "stopped"].includes(v.status) ? v : null;
      },
      { timeoutMs: 40 * 60_000, everyMs: 2000, what: "the compare to finish" },
    );
    summary.compare.waiting = sawWaiting;
    check("one lane showed the waiting line while the other worked", Boolean(sawWaiting), JSON.stringify(sawWaiting));
    summary.compare.sides = ended.sides.map((s) => ({ label: s.label, status: s.status, run_id: s.run_id }));
    check("both lanes finished through the Desktop", ended.status === "finished" && ended.sides.every((s) => s.status === "finished"), JSON.stringify(summary.compare.sides));
    const timeRow = ended.results.rows.find((r) => r.key === "time");
    summary.compare.timeRow = timeRow;
    summary.compare.note = ended.results.note;
    check("results show Work time", timeRow && timeRow.label === "Work time", JSON.stringify(timeRow));
    check("results add D3's line", ended.results.note === WORK_LINE, ended.results.note);
    for (const s of ended.sides) {
      const lane = await runEvents(s.run_id);
      const src = lane.map(textOf).filter((t) => /apiKeySource/.test(t));
      check(`lane ${s.label}'s Claude CLI used the subscription (apiKeySource: none)`, src.some((t) => /apiKeySource: none/.test(t)), src.join(" | "));
    }
    await go(page, `#/teams/${teamId}/compare/${cid}`);
    await page.getByText(WORK_LINE).waitFor({ timeout: 30_000 });
    await shot(page, "c-compare-results-work-time.png", "compareResults");
  } finally {
    await app.close().catch(() => {});
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
    fs.writeFileSync(path.join(OUT, "summary-desk-routes.json"), JSON.stringify(summary, null, 2));
    log("summary", path.relative(repoRoot, path.join(OUT, "summary-desk-routes.json")), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
