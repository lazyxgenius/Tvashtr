#!/usr/bin/env node
/**
 * D3: does Testreel's animated cursor attach to the Desktop (an Electron page)? Hovers the PM card
 * and clicks the Engineer's model chip on the story team's canvas (no run), through
 * testreel.recordPage on a recordVideo-enabled Electron launch, then lets Testreel post-process.
 *
 *   node video/camera/testreel-cursor.mjs     → video/out/v0/cursor/
 */
import fs from "node:fs";
import path from "node:path";
import { recordPage } from "testreel";
import * as D from "./desktop.mjs";

const OUT = path.join(D.repoRoot, "video", "out", "v0", "cursor");
const log = D.logger("testreel-cursor");
fs.rmSync(OUT, { recursive: true, force: true });
const startedAt = Date.now();
const { app, page } = await D.launchDesktop(OUT, "cursor", {
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
let outcome;
try {
  await D.signIn(page);
  await D.frontmost(app);
  const team = await D.ensureTeam(page, "Indicator sprint team", "xai/grok-4.7", "anthropic/claude-sonnet-5");
  await D.openTeam(page, team.id);
  await page.locator(".react-flow__node").nth(1).waitFor({ timeout: 30000 });
  // Electron pages have no Playwright viewport; Testreel requires one.
  await page.setViewportSize({ width: 1440, height: 900 });
  const rec = await recordPage(page, {
    outputDir: OUT, name: "testreel-cursor", cursor: true, chrome: false, background: false,
    videoStartedAt: startedAt,
  });
  log("recordPage attached");
  await rec.hover(D.nodeCard(page, "Product manager"));
  await rec.click(D.nodeCard(page, "Engineer").locator(".rf-node__model"));
  await rec.wait(1500);
  const result = await rec.stop();
  outcome = { attached: true, result };
} catch (err) {
  outcome = { attached: false, error: String(err && err.message ? err.message : err).slice(0, 600) };
} finally {
  await D.frontmost(app, false).catch(() => {});
  await app.close().catch(() => {});
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(outcome, null, 2));
log(JSON.stringify(outcome).slice(0, 900));
