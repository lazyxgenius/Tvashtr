/**
 * Capture + measurement helpers for the camera: a CDP screencast of lossless PNG frames (each with
 * its own frame-swap timestamp), their assembly into a 30 fps video, frame extraction and SSIM —
 * all with the ffmpeg pinned in video/package.json.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const FFMPEG = require("ffmpeg-static");
export const FFPROBE = require("@ffprobe-installer/ffprobe").path;

export function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-y", ...args], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}\n${(r.stderr || "").slice(-1500)}`);
  return r.stderr;
}

export function probe(file) {
  const r = spawnSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], {
    encoding: "utf8",
  });
  return JSON.parse(r.stdout);
}

/** Start a PNG screencast of `page`; frames land in `dir` as fNNNNNN.png with their timestamps. */
export async function startScreencast(page, dir, { every = 1 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  // V2: time spent paused (an off-camera wait) is cut out — later frames move back by it.
  let cut = 0;
  let pausedAt = null;
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `f${String(frames.length).padStart(6, "0")}.png`);
    frames.push({ file, ts: (metadata.timestamp ?? Date.now() / 1000) - cut });
    writes.push(fs.promises.writeFile(file, Buffer.from(data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: every });
  return {
    frames,
    /** An off-camera stretch (V2: a long wait inside a take): no frames until resume(). */
    async pause() {
      if (pausedAt !== null) return;
      pausedAt = Date.now() / 1000;
      await cdp.send("Page.stopScreencast").catch(() => {});
    },
    /** Back on camera: the paused time is cut from the video (a jump cut). Returns it in seconds. */
    async resume() {
      if (pausedAt === null) return 0;
      const gap = Date.now() / 1000 - pausedAt;
      cut += gap;
      pausedAt = null;
      await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: every });
      return gap;
    },
    /** Stops the screencast; returns the end time (epoch seconds) for the last frame's duration. */
    async stop() {
      if (pausedAt !== null) await this.resume();
      const endTs = Date.now() / 1000 - cut;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      return endTs;
    },
  };
}

/** Frames (with timestamps) → a constant 30 fps H.264 video; frame i holds until frame i+1. */
export function assemble(frames, endTs, out, { fps = 30, crf = 12, preset = "slow" } = {}) {
  if (!frames.length) throw new Error("no screencast frames to assemble");
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].ts : endTs;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(6)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file}'`); // concat drops the last duration otherwise
  const list = `${out}.ffconcat`;
  fs.writeFileSync(list, `${lines.join("\n")}\n`);
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", `fps=${fps},format=yuv420p`, "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
    "-movflags", "+faststart", out,
  ]);
  return out;
}

export function extractFrame(video, tSec, out) {
  ffmpeg(["-ss", tSec.toFixed(3), "-i", video, "-frames:v", "1", out]);
  return out;
}

/** SSIM (ffmpeg's "All") of two images at 1440x900; `crop` is a rect in that 1440x900 space. */
export function ssim(a, b, crop) {
  const c = crop ? `,crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : "";
  const prep = (i, o) => `[${i}:v]scale=1440:900:flags=lanczos,format=yuv444p${c}[${o}]`;
  const err = ffmpeg(["-i", a, "-i", b, "-lavfi", `${prep(0, "a")};${prep(1, "b")};[a][b]ssim`, "-f", "null", "-"]);
  const m = err.match(/All:([0-9.]+)/);
  if (!m) throw new Error(`no SSIM in ffmpeg output: ${err.slice(-400)}`);
  return Number(m[1]);
}
