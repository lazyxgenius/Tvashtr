#!/usr/bin/env node
/**
 * Stall probe (prompts/video-v0.md F, report only). Needs the backend started with
 * TVASHTR_QUIET_AFTER_S=20 TVASHTR_STALLED_AFTER_S=60 TVASHTR_STALL_FAIL_AFTER_S=180.
 *
 * A two-node run whose Engineer runs on this Desktop (Grok subscription). Once the Engineer's
 * Desktop job is working, its CLI process — found strictly through the PID tree of the Electron
 * this script launched, by the job's own command line — is paused (SIGSTOP). The run view is
 * screenshotted at Quiet, Stalled and Failed; then the paused process is stopped (SIGTERM, then
 * SIGKILL), nothing of the job may still run, and the run must offer "Resume from here" (not used).
 *
 *   node video/camera/stall-probe.mjs      → video/out/v0/stall-probe/ (screens + result.json)
 *
 * With --force-hang the backend also runs with TVASHTR_FORCE_HANG_ROLE=pm: the PM waits host-side
 * like a model that never answers (it never reaches the Desktop runner), nothing is paused, the
 * PM's card is watched, and the run is cancelled at the end if the sweep did not end it.
 */
import fs from "node:fs";
import path from "node:path";
import * as D from "./desktop.mjs";

const FORCE_HANG = process.argv.includes("--force-hang");
const OUT = path.join(D.repoRoot, "video", "out", "v0", FORCE_HANG ? "stall-probe-force-hang" : "stall-probe");
const PM_MODEL = process.env.STALL_PM_MODEL || "deepseek/deepseek-chat";
const ENG_MODEL = process.env.STALL_ENG_MODEL || "xai/grok-4.7";
const IDEA =
  "Add a short 'Stall probe' section with one sentence at the very end of README.md. Change nothing else.";
const JOB = /--prompt-file\s+\S*runner-jobs\//; // a runner job's CLI, never the status probe
const log = D.logger("stall-probe");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const result = { started: new Date().toISOString(), pm: PM_MODEL, engineer: ENG_MODEL, screens: {} };

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const api = D.apiSession();
await D.loginApi(api);
const { app, page } = await D.launchDesktop(OUT, "stall");
const electronPid = app.process().pid;
let paused = [];
try {
  await D.signIn(page);
  const fresh = await D.waitFor(
    async () => {
      const s = (await api("GET", "/api/engines/subscriptions")).json.subscriptions || [];
      return s.find((x) => x.provider === "grok" && x.runner_fresh);
    },
    { timeoutMs: 60000, everyMs: 1500, what: "the Grok subscription to be fresh" },
  );
  log("grok fresh:", Boolean(fresh));
  await page.reload();
  await D.nav(page).waitFor({ timeout: 60000 });
  const teamName = `V0 stall probe ${new Date().toISOString().slice(11, 19)}`;
  const team = await D.makeTeam(page, teamName, PM_MODEL, ENG_MODEL);
  result.team = { name: teamName, ...team };
  await D.openTeam(page, team.id);
  const launch = await D.launchFromComposer(page, { teamName, idea: IDEA });
  result.runId = launch.json.run_id;
  result.desktopTarget = launch.body.desktop_target === true;
  log("run", result.runId, "status", launch.status);
  await page.goto(`${D.DEV_URL}/#/teams/${team.id}/runs/${result.runId}`);
  await page.locator("section[aria-label='Activity']").waitFor({ timeout: 60000 });
  await D.frontmost(app);

  if (FORCE_HANG) {
    result.pausedAt = new Date().toISOString(); // the hang starts with the PM's step
    log("force-hang: the PM waits host-side; nothing is paused");
  } else {
    // PM (host) → PRD gate → the Engineer's Desktop job: pause its CLI the moment it is running.
    const job = await D.waitFor(
      async () => {
        await D.approveVisibleGate(page);
        return D.processTree(electronPid).find((p) => JOB.test(p.command)) || null;
      },
      { timeoutMs: 15 * 60 * 1000, everyMs: 250, what: "the Engineer's Desktop job" },
    );
    const tree = [job, ...D.processTree(job.pid)];
    for (const p of tree) process.kill(p.pid, "SIGSTOP");
    paused = tree.map((p) => p.pid);
    result.pausedAt = new Date().toISOString();
    result.paused = tree.map((p) => ({ pid: p.pid, command: p.command.replace(/\s+--prompt-file.*$/, " --prompt-file …") }));
    log(`SIGSTOP ${paused.join(",")} (${result.paused[0].command})`);
  }
  await D.sleep(3000);
  result.screens.paused = path.relative(D.repoRoot, path.join(OUT, "00-paused.png"));
  await page.screenshot({ path: path.join(OUT, "00-paused.png") });

  const engineer = D.nodeCard(page, FORCE_HANG ? "Product manager" : "Engineer");
  const stateShot = async (label, file, test, timeoutMs) => {
    const t0 = Date.now();
    const seen = await D.waitFor(test, { timeoutMs, everyMs: 1000, what: label }).then(() => true, () => false);
    const at = ((Date.now() - Date.parse(result.pausedAt)) / 1000).toFixed(0);
    await page.screenshot({ path: path.join(OUT, file) });
    result.screens[label] = { seen, afterPauseSec: Number(at), file: path.relative(D.repoRoot, path.join(OUT, file)) };
    log(`${label}: ${seen ? "seen" : "NOT seen"} ${at}s after the pause (waited ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  };
  const cardSays = (word) => async () => (await engineer.innerText().catch(() => "")).includes(word);
  await stateShot("Quiet", "01-quiet.png", cardSays("Quiet"), 90000);
  await stateShot("Stalled", "02-stalled.png", cardSays("Stalled"), 120000);
  await stateShot("Failed", "03-failed.png", async () => {
    const r = (await api("GET", `/api/runs/${result.runId}`)).json;
    return r.run && r.run.status === "failed" ? r : null;
  }, 300000);
  const r = (await api("GET", `/api/runs/${result.runId}`)).json;
  result.run = { status: r.run?.status, failure: r.run?.failure || null };
  if (FORCE_HANG && r.run?.status === "running") {
    const c = await api("POST", `/api/runs/${result.runId}/cancel`);
    result.cancelled = c.status;
    log(`the sweep did not end it: cancelled the run (HTTP ${c.status})`);
    await D.sleep(5000);
  }

  // Stop the paused process: SIGTERM (delivered once continued), then SIGKILL if needed.
  for (const pid of paused) if (alive(pid)) process.kill(pid, "SIGTERM");
  for (const pid of paused) if (alive(pid)) process.kill(pid, "SIGCONT");
  await D.sleep(3000);
  result.killed = paused.filter(alive);
  for (const pid of result.killed) process.kill(pid, "SIGKILL");
  await D.sleep(1000);
  const left = D.processTree(electronPid).filter((p) => JOB.test(p.command) || paused.includes(p.pid));
  result.leftRunning = left.map((p) => p.pid);
  result.stillAlive = paused.filter(alive);
  log(`stopped: SIGKILL needed for [${result.killed.join(",")}]; job processes left: ${left.length}; paused pids alive: ${result.stillAlive.length}`);

  await page.reload();
  await page.locator("section[aria-label='Activity']").waitFor({ timeout: 60000 }).catch(() => {});
  const resume = page.getByText("Resume from here").first();
  result.resumeOffered = await resume.waitFor({ timeout: 30000 }).then(() => true, () => false);
  await page.screenshot({ path: path.join(OUT, "04-resume-offered.png") });
  result.screens.resume = path.relative(D.repoRoot, path.join(OUT, "04-resume-offered.png"));
  log(`"Resume from here" offered: ${result.resumeOffered}`);
} catch (err) {
  result.error = String(err && err.stack ? err.stack : err).slice(0, 1500);
  console.error(err);
} finally {
  for (const pid of paused) if (alive(pid)) process.kill(pid, "SIGKILL");
  await D.frontmost(app, false).catch(() => {});
  await app.close().catch(() => {});
}
const s = result.screens;
result.verdict =
  !result.error && s.Quiet?.seen && s.Stalled?.seen && s.Failed?.seen && result.resumeOffered &&
  result.leftRunning?.length === 0 && result.stillAlive?.length === 0
    ? "PASS"
    : "FINDING";
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
log(
  `STALL_PROBE: ${result.verdict} quiet=${s.Quiet?.seen}@${s.Quiet?.afterPauseSec}s ` +
    `stalled=${s.Stalled?.seen}@${s.Stalled?.afterPauseSec}s failed=${s.Failed?.seen}@${s.Failed?.afterPauseSec}s ` +
    `resume=${result.resumeOffered} left_running=${result.leftRunning?.length}`,
);
