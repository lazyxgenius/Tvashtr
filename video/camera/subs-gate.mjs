#!/usr/bin/env node
/**
 * The M-subs-desktop live gate (`run` phase of desktop/scripts/live-subscription-gate.mjs), ported
 * to the current UI. That script was last changed on 2026-09-24, before the Desktop setup wizard
 * and the Engines / launch revamp, so its locators no longer exist; V0 may not change the product,
 * so the port lives here. Same checks, same order, current locators (frontend/e2e/demo-proof.spec.ts):
 *
 *   node session · NO anthropic/xai key · Desktop sign-in through its own proxy · runner heartbeats
 *   fresh · the subscription disclosure · Engines: Claude + Grok Connected · 2-node team (PM on
 *   xai/…, Engineer on anthropic/…) · the Engineer's model reads "Your Claude subscription · runs on
 *   this computer" · Run posts a desktop-targeted launch the server accepts · the Grok node ran the
 *   user's own `grok` · the Claude node reported apiKeySource: none · run completed · PR opened.
 *
 *   node video/camera/subs-gate.mjs        # the real run: spends the operator's subscriptions
 *   node video/camera/subs-gate.mjs --dry  # everything up to Launch, then stops (no run)
 *
 * Needs the local stack (see video/README.md). Screenshots + summary: video/out/v0/subs-gate/.
 */
import fs from "node:fs";
import path from "node:path";
import * as D from "./desktop.mjs";

const DRY = process.argv.includes("--dry");
const OUT = path.join(D.repoRoot, "video", "out", "v0", "subs-gate");
const PM_MODEL = process.env.TVASHTR_SUBS_PM_MODEL || "xai/grok-4.7";
const ENG_MODEL = process.env.TVASHTR_SUBS_ENG_MODEL || "anthropic/claude-sonnet-5";
const IDEA =
  process.env.TVASHTR_SUBS_IDEA ||
  "Add a short 'Built with Tvashtr' line at the very end of README.md. Change nothing else.";
const DISCLOSURE = "Tvashtr never sees or stores your login";
const COVER = "Your Claude subscription · runs on this computer";

fs.mkdirSync(OUT, { recursive: true });
const summary = { dry: DRY, started: new Date().toISOString(), checks: [] };
const log = D.logger("subs-gate");
function check(name, ok, detail) {
  summary.checks.push({ name, ok, detail });
  log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail || ""}`);
}
async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  return path.relative(D.repoRoot, file);
}

async function waitRunnerFresh(api) {
  for (let i = 0; i < 40; i += 1) {
    const { json } = await api("GET", "/api/engines/subscriptions");
    const by = Object.fromEntries((json.subscriptions || []).map((s) => [s.provider, s]));
    if (by.claude?.runner_fresh && by.grok?.runner_fresh) return by;
    await D.sleep(1500);
  }
  return null;
}

async function main() {
  const api = D.apiSession();
  const login = await D.loginApi(api);
  check("node-side session on the local backend", login.status === 200, `HTTP ${login.status}`);
  const provs = (await api("GET", "/api/providers")).json.providers.map((p) => p.provider);
  check(
    "the account holds NO anthropic or xai API key",
    !provs.includes("anthropic") && !provs.includes("xai"),
    provs.join(","),
  );

  const { app, page } = await D.launchDesktop(OUT, "gate");
  try {
    const signed = await D.signIn(page);
    check("signed in to the LOCAL backend through the Desktop's own proxy", signed === 200, `HTTP ${signed}`);
    const mirror = await waitRunnerFresh(api);
    check(
      "the Desktop pushed status + its runner heartbeats (mirror fresh)",
      Boolean(mirror),
      JSON.stringify(mirror && { claude: mirror.claude, grok: mirror.grok }),
    );
    await page.reload();
    await D.nav(page).waitFor({ timeout: 60000 });
    await D.openSubscriptions(page);
    const disclosure = page.getByRole("note").filter({ hasText: DISCLOSURE });
    const shown = await disclosure.waitFor({ timeout: 30000 }).then(() => true, () => false);
    check("the subscription disclosure shows (exact wording)", shown);
    await page.locator("article.eng-sub[data-sub='claude']").waitFor({ timeout: 30000 });
    const checkIn = (await page.getByRole("note", { name: "Tvashtr Desktop check-in" }).innerText()).trim();
    check("Engines: Tvashtr Desktop is checking in", /is open and checking in/.test(checkIn), checkIn);
    const claude = await D.subscriptionBadge(page, "claude");
    const grok = await D.subscriptionBadge(page, "grok");
    check("Engines: Claude — Connected", claude === "Connected", claude);
    check("Engines: Grok — Connected", grok === "Connected", grok);
    summary.enginesShot = await shot(page, "01-engines-connected.png");

    const teamName = `V0 subs gate ${new Date().toISOString().slice(11, 19)}`;
    const team = await D.makeTeam(page, teamName, PM_MODEL, ENG_MODEL);
    summary.team = team;
    check(
      "2-node team: PM on xai/…, Engineer on anthropic/…",
      team.nodes.length === 2 && team.nodes.every((n) => n.status === 200),
      JSON.stringify(team.nodes),
    );
    await D.openTeam(page, team.id);
    const drawer = await D.openNodeSettings(page, "Engineer");
    await drawer.getByText(COVER).waitFor({ timeout: 30000 });
    check(`node settings: '${COVER}'`, true);
    summary.pickerShot = await shot(page, "02-engineer-model.png");
    await drawer.getByRole("button", { name: /^Close/ }).first().click().catch(() => page.keyboard.press("Escape"));
    const run = page.getByRole("button", { name: "Run this team", exact: true });
    check("Run this team is enabled (the subscriptions cover both nodes)", await run.isEnabled());

    if (DRY) {
      await D.launchFromComposer(page, { teamName, idea: IDEA, dry: true });
      check(`the composer is ready to launch at ${D.REPO}`, true);
      summary.composerShot = await shot(page, "03-dry-composer.png");
      return;
    }

    const launch = await D.launchFromComposer(page, { teamName, idea: IDEA });
    check("Run posts a desktop-targeted launch", launch.body.desktop_target === true, JSON.stringify(launch.body));
    check(
      "the server accepted it (no API key for anthropic/xai held)",
      launch.status === 200,
      JSON.stringify(launch.json).slice(0, 300),
    );
    const runId = launch.json.run_id;
    summary.runId = runId;
    log("run", runId);
    await page.goto(`${D.DEV_URL}/#/teams/${team.id}/runs/${runId}`);

    const gates = [];
    const done = await D.waitFor(
      async () => {
        const title = await D.approveVisibleGate(page);
        if (title) {
          gates.push(title);
          log(`approved gate: ${title}`);
          await shot(page, `04-gate-${gates.length}-approved.png`);
        }
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        const terminal = r.run && D.TERMINAL.includes(r.run.status);
        const wfDone = ["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"].includes(r.workflow_status);
        return terminal && wfDone ? r : null;
      },
      { timeoutMs: 40 * 60 * 1000, everyMs: 4000, what: "the run to reach a terminal status" },
    );
    summary.gates = gates;
    await D.sleep(3000);
    summary.finalShot = await shot(page, "05-terminal.png");
    const evs = await D.runEvents(api, runId);
    const pick = (re) => evs.filter((e) => re.test(D.eventText(e))).map((e) => D.eventText(e));
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
    };
    check("the Grok node ran the user's own `grok` CLI", summary.evidence.grokStarted.length > 0, summary.evidence.grokStarted[0]);
    check(
      "the Claude node's own output says it used the subscription (apiKeySource: none)",
      summary.evidence.claudeAuth.some((t) => /apiKeySource: none/.test(t)),
      summary.evidence.claudeAuth.join(" | "),
    );
    check("run reached terminal status completed", done.run.status === "completed", JSON.stringify(summary.run));
    check("the run opened a PR (or shipped a commit)", Boolean(done.run.pr_url || done.run.ship_commit_sha), JSON.stringify(summary.run));
  } finally {
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
    const file = path.join(OUT, `summary-${DRY ? "dry" : "run"}.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    log("summary", path.relative(D.repoRoot, file), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
