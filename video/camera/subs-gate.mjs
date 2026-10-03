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
 * With --take it is also the camera take (prompts/video-v0.md D2, scene 3.2): the story team and
 * task, filmed with the CDP PNG screencast (the method that passed the sharpness gate) from "Run
 * this team" through ~TAKE_SECONDS of the live run view; take.json beside the clip lists every
 * click and typing step (time, screen position) and the run view's regions.
 *
 *   node video/camera/subs-gate.mjs               # the real run: spends the operator's subscriptions
 *   node video/camera/subs-gate.mjs --take        # the same run, filmed (gate + take in one run)
 *   node video/camera/subs-gate.mjs [--take] --dry   # everything up to Launch, then stops (no run)
 *
 * Needs the local stack (see video/README.md). Output: video/out/v0/subs-gate/ (+ video/takes/v0/).
 */
import fs from "node:fs";
import path from "node:path";
import * as C from "./capture.mjs";
import * as D from "./desktop.mjs";

const DRY = process.argv.includes("--dry");
const TAKE = process.argv.includes("--take");
const OUT = path.join(D.repoRoot, "video", "out", "v0", "subs-gate");
const TAKE_DIR = path.join(D.repoRoot, "video", "takes", "v0", DRY ? "rehearsal" : "scene-3-2");
const TAKE_SECONDS = Number(process.env.TAKE_SECONDS || 60);
const PM_MODEL = process.env.TVASHTR_SUBS_PM_MODEL || "xai/grok-4.7";
const ENG_MODEL = process.env.TVASHTR_SUBS_ENG_MODEL || "anthropic/claude-sonnet-5";
const TEAM = TAKE ? "Indicator sprint team" : `V0 subs gate ${new Date().toISOString().slice(11, 19)}`;
const IDEA =
  process.env.TVASHTR_SUBS_IDEA ||
  (TAKE
    ? "Add an RSI indicator note to the end of README.md: one line, 'RSI: rsi(df, length=14) in " +
      "core/indicators.py'. Change nothing else."
    : "Add a short 'Built with Tvashtr' line at the very end of README.md. Change nothing else.");
const DISCLOSURE = "Tvashtr never sees or stores your login";
const COVER = "Your Claude subscription · runs on this computer";
const WF_TERMINAL = ["SUCCESS", "ERROR", "CANCELLED", "MAX_RECOVERY_ATTEMPTS_EXCEEDED"];

fs.mkdirSync(OUT, { recursive: true });
const summary = { dry: DRY, take: TAKE, started: new Date().toISOString(), checks: [] };
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

/** The camera: screencast + a step recorder whose times are relative to the first frame. */
async function startCamera(page) {
  fs.rmSync(TAKE_DIR, { recursive: true, force: true });
  const sc = await C.startScreencast(page, path.join(TAKE_DIR, "frames"));
  const steps = [];
  const step = async (kind, label, locator, fn, extra = {}) => {
    const b = await locator.boundingBox().catch(() => null);
    steps.push({
      kind, label, wall: Date.now() / 1000, ...extra,
      ...(b && { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2),
        box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } }),
    });
    await fn();
  };
  const regions = {};
  const region = async (name, locator) => {
    const b = await locator.boundingBox().catch(() => null);
    if (b) regions[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), wall: Date.now() / 1000 };
  };
  async function stop() {
    const endTs = await sc.stop();
    const clip = C.assemble(sc.frames, endTs, path.join(TAKE_DIR, "take.mp4"));
    const t0 = sc.frames[0].ts;
    const rel = (w) => Number((w - t0).toFixed(3));
    const stream = C.probe(clip).streams.find((s) => s.codec_type === "video");
    const take = {
      clip: "take.mp4",
      seconds: Number(C.probe(clip).format.duration),
      fps: 30,
      size: { width: stream.width, height: stream.height },
      css: { width: 1440, height: 900, scale: 2 },
      method: "CDP screencast (PNG frames) → 30 fps from their timestamps",
      frames: sc.frames.length,
      team: TEAM,
      task: IDEA,
      runId: summary.runId || null,
      steps: steps.map(({ wall, ...s }) => ({ t: rel(wall), ...s })),
      regions: Object.fromEntries(Object.entries(regions).map(([k, { wall, ...r }]) => [k, { t: rel(wall), ...r }])),
    };
    fs.writeFileSync(path.join(TAKE_DIR, "take.json"), JSON.stringify(take, null, 2));
    fs.rmSync(path.join(TAKE_DIR, "frames"), { recursive: true, force: true });
    fs.rmSync(`${clip}.ffconcat`, { force: true });
    summary.take = { clip: path.relative(D.repoRoot, clip), seconds: take.seconds, steps: take.steps.length };
    log(`TAKE: ${path.relative(D.repoRoot, clip)} ${take.seconds.toFixed(1)}s (${take.frames} frames, ${take.steps.length} steps)`);
    return take;
  }
  return { step, region, stop };
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
  let camera = null;
  try {
    const signed = await D.signIn(page);
    check("signed in to the LOCAL backend through the Desktop's own proxy", signed === 200, `HTTP ${signed}`);
    const mirror = await D.waitRunnerFresh(api);
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

    const team = await D.makeTeam(page, TEAM, PM_MODEL, ENG_MODEL, { reuse: TAKE });
    summary.team = { name: TEAM, ...team };
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

    let step;
    if (TAKE) {
      await D.openTeam(page, team.id); // a clean canvas for the opening frames
      await page.mouse.move(5, 5);
      await D.frontmost(app);
      await D.sleep(1500);
      camera = await startCamera(page);
      step = camera.step;
      await D.sleep(2000);
    }
    const launch = await D.launchFromComposer(page, {
      teamName: TEAM, idea: IDEA, step, typeDelay: TAKE ? 28 : 0, dry: DRY,
    });
    if (DRY) {
      check(`the composer is ready to launch at ${D.REPO}`, true);
      summary.composerShot = await shot(page, "03-dry-composer.png");
      if (camera) {
        await camera.region("composer", page.locator("section[aria-label='Start a run']"));
        await D.sleep(2500);
        await camera.stop();
      }
      return;
    }
    check("Run posts a desktop-targeted launch", launch.body.desktop_target === true, JSON.stringify(launch.body));
    check(
      "the server accepted it (no API key for anthropic/xai held)",
      launch.status === 200,
      JSON.stringify(launch.json).slice(0, 300),
    );
    const runId = launch.json.run_id;
    summary.runId = runId;
    log("run", runId);
    const open = page.getByRole("button", { name: "Open run", exact: true });
    const toast = await open.waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (toast) await (step || ((_k, _l, _loc, fn) => fn()))("click", "Open run", open, () => open.click());
    else await page.goto(`${D.DEV_URL}/#/teams/${team.id}/runs/${runId}`);
    await page.locator("section[aria-label='Activity']").waitFor({ timeout: 60000 });

    const gates = [];
    const approve = async () => {
      const title = await D.approveVisibleGate(page, step);
      if (title) {
        gates.push(title);
        log(`approved gate: ${title}`);
      }
    };
    if (camera) {
      await camera.region("now", page.locator("section[aria-label='Now']"));
      await camera.region("activity", page.locator("section[aria-label='Activity']"));
      const until = Date.now() + TAKE_SECONDS * 1000;
      while (Date.now() < until) {
        await approve();
        await D.sleep(1000);
      }
      await camera.region("activity-end", page.locator("section[aria-label='Activity']"));
      await camera.stop();
      camera = null;
      step = undefined;
      await D.frontmost(app, false);
    }

    // The Desktop stays open until the run ends: its Claude/Grok jobs run here.
    const done = await D.waitFor(
      async () => {
        await approve();
        const r = (await api("GET", `/api/runs/${runId}`)).json;
        const terminal = r.run && D.TERMINAL.includes(r.run.status);
        return terminal && WF_TERMINAL.includes(r.workflow_status) ? r : null;
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
      failure: done.run.failure || null,
    };
    check("the Grok node ran the user's own `grok` CLI", summary.evidence.grokStarted.length > 0, summary.evidence.grokStarted[0]);
    check(
      "the Claude node's own output says it used the subscription (apiKeySource: none)",
      summary.evidence.claudeAuth.some((t) => /apiKeySource: none/.test(t)),
      summary.evidence.claudeAuth.join(" | "),
    );
    check("run reached terminal status completed", done.run.status === "completed", JSON.stringify(summary.run));
    check("the run opened a PR (or shipped a commit)", Boolean(done.run.pr_url || done.run.ship_commit_sha), JSON.stringify(summary.run));
    log(`SUBS_GATE: PASS pr=${done.run.pr_url}`);
  } finally {
    if (camera) await camera.stop().catch(() => {});
    await D.frontmost(app, false).catch(() => {});
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
    const file = path.join(OUT, `summary-${DRY ? "dry" : "run"}${TAKE ? "-take" : ""}.json`);
    fs.writeFileSync(file, JSON.stringify(summary, null, 2));
    log("summary", path.relative(D.repoRoot, file), summary.ok ? "OK" : "FAILED");
    process.exit(summary.ok ? 0 : 1);
  });
