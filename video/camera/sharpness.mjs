#!/usr/bin/env node
/**
 * Camera sharpness gate (prompts/video-v0.md D1). On a still screen (the story team's canvas,
 * nothing changing for 5 s) a lossless page.screenshot is compared with the matching frame of the
 * recording, both at 1440x900, with ffmpeg's ssim: the full frame and a crop around the node cards.
 * Gate: SSIM >= 0.97 on both.
 *
 *   node video/camera/sharpness.mjs recordvideo   # Playwright recordVideo, size set explicitly
 *   node video/camera/sharpness.mjs screencast    # CDP screencast PNG frames → 30 fps from timestamps
 *
 * Output: video/out/v0/camera/<method>/ (screenshot, frame, video, result.json).
 */
import fs from "node:fs";
import path from "node:path";
import * as D from "./desktop.mjs";
import * as C from "./capture.mjs";

const METHOD = process.argv[2];
if (!["recordvideo", "screencast"].includes(METHOD)) {
  console.error("usage: sharpness.mjs recordvideo|screencast");
  process.exit(2);
}
const GATE = 0.97;
const SIZE = { width: 1440, height: 900 };
const OUT = path.join(D.repoRoot, "video", "out", "v0", "camera", METHOD);
const log = D.logger(`sharpness:${METHOD}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const launchOptions = METHOD === "recordvideo" ? { recordVideo: { dir: OUT, size: SIZE } } : {};
const { app, page } = await D.launchDesktop(OUT, "sharpness", launchOptions);
let result;
try {
  await D.signIn(page);
  await D.frontmost(app);
  const team = await D.ensureTeam(page, "Indicator sprint team", "xai/grok-4.7", "anthropic/claude-sonnet-5");
  await D.openTeam(page, team.id);
  await page.locator(".react-flow__node").nth(1).waitFor({ timeout: 30000 });
  await page.mouse.move(5, 5);
  await D.sleep(2500); // let the canvas finish its fit-view animation
  const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }));
  const crop = await D.nodeCardsBox(page);

  const sc = METHOD === "screencast" ? await C.startScreencast(page, path.join(OUT, "frames")) : null;
  await D.sleep(2500);
  const shotAt = Date.now();
  const shot = path.join(OUT, "still-screenshot.png");
  await page.screenshot({ path: shot }); // lossless PNG at device scale
  await D.sleep(2500);

  let video;
  let tVideo;
  if (sc) {
    const endTs = await sc.stop();
    video = C.assemble(sc.frames, endTs, path.join(OUT, "still.mp4"));
    tVideo = shotAt / 1000 - sc.frames[0].ts;
    log(`screencast frames: ${sc.frames.length}`);
    await D.frontmost(app, false);
    await app.close();
  } else {
    const pv = page.video();
    await D.frontmost(app, false);
    await app.close();
    const closedAt = Date.now();
    video = await pv.path();
    // The recording ends at close: its start is close time minus its duration.
    const dur = Number(C.probe(video).format.duration);
    tVideo = (shotAt - (closedAt - dur * 1000)) / 1000;
  }
  const frame = C.extractFrame(video, tVideo, path.join(OUT, "still-frame.png"));
  const stream = C.probe(video).streams.find((s) => s.codec_type === "video");
  const full = C.ssim(shot, frame);
  const nodes = C.ssim(shot, frame, crop);
  result = {
    method: METHOD,
    viewport,
    video: path.relative(D.repoRoot, video),
    videoSize: `${stream.width}x${stream.height}`,
    codec: stream.codec_name,
    frameAtSec: Number(tVideo.toFixed(3)),
    screenshot: path.relative(D.repoRoot, shot),
    frame: path.relative(D.repoRoot, frame),
    crop,
    ssim_full: full,
    ssim_crop: nodes,
    pass: full >= GATE && nodes >= GATE,
  };
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
  log(JSON.stringify(result));
  log(`CAMERA: method=${METHOD} ssim_full=${full.toFixed(4)} ssim_crop=${nodes.toFixed(4)} ${result.pass ? "PASS" : "FAIL"} (gate ${GATE})`);
} catch (err) {
  await app.close().catch(() => {});
  throw err;
}
process.exit(result && result.pass ? 0 : 1);
