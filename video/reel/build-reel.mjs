#!/usr/bin/env node
/**
 * The V0 test reel (prompts/video-v0.md E): 20 s, 1920x1080, 30 fps, made with Product Demo
 * Director. The take sits in a styled frame in the Tvashtr look (the warm cream --surface-sunk
 * backdrop, the app window with a soft shadow and a coral #d97757 ring), with one connected zoom
 * onto the run view's Activity panel (placed from take.json) and one caption in Inter.
 *
 * No narration and no music: the clip carries a silent track and the project's QA contract
 * declares the whole runtime as intended silence (the audio waiver). `./pdd render` cannot finish
 * a silent master (its loudness pass cannot measure silence), so PDD's own stages run by hand:
 * preflight --strict → build --contracts strict → finish --no-loudnorm → qa --strict.
 *
 *   node video/reel/build-reel.mjs              # video/takes/v0/scene-3-2 → video/out/v0/test-reel.mp4
 *   node video/reel/build-reel.mjs --rehearse   # stand-in clip (the sharpness still) → test-reel-rehearsal.mp4
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../camera/capture.mjs";

const REHEARSE = process.argv.includes("--rehearse");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PDD = path.join(ROOT, "video", "vendor", "product-demo-director");
const OUT = path.join(ROOT, "video", "out", "v0");
const PROJECT = path.join(OUT, REHEARSE ? "reel-rehearsal" : "reel");
const FINAL = path.join(OUT, REHEARSE ? "test-reel-rehearsal.mp4" : "test-reel.mp4");
const SECONDS = 20;
const CAPTION = "Watch every agent, in plain words.";
// The 4K canvas the take is framed on: the 2880x1800 (1440x900 @2x) take at native size.
const CANVAS = { w: 3840, h: 2160 };
const WIN = { x: 480, y: 180, w: 2880, h: 1800, r: 36 };
const LOOK = { backdrop: "efece1", shadow: "3d3427", coral: "d97757", ring: 6 };
const log = (...a) => console.log("[reel]", ...a);

function take() {
  if (!REHEARSE) {
    const dir = path.join(ROOT, "video", "takes", "v0", "scene-3-2");
    const t = JSON.parse(fs.readFileSync(path.join(dir, "take.json"), "utf8"));
    const open = t.steps.find((s) => s.label === "Open run");
    const from = open ? open.t + 1 : (t.regions.activity?.t ?? 0);
    const start = Math.max(0, Math.min(from, t.seconds - SECONDS));
    return { clip: path.join(dir, t.clip), start, loop: false, target: t.regions.activity, label: "Activity panel" };
  }
  const still = path.join(OUT, "camera", "screencast");
  const r = JSON.parse(fs.readFileSync(path.join(still, "result.json"), "utf8"));
  return { clip: path.join(still, "still.mp4"), start: 0, loop: true, target: r.crop, label: "node cards (stand-in)" };
}

/** Backdrop (cream + shadow + coral ring) and the window's rounded mask, drawn once with geq. */
function frameAssets(dir) {
  const bg = path.join(dir, "frame-bg.png");
  const mask = path.join(dir, "frame-mask.png");
  const rr = (cx, cy, hw, hh, r, peak = 255) =>
    `${peak}*clip(${r}+0.5-hypot(max(abs(X-${cx})-(${hw}-${r})\\,0)\\,max(abs(Y-${cy})-(${hh}-${r})\\,0))\\,0\\,1)`;
  const cx = WIN.x + WIN.w / 2;
  const cy = WIN.y + WIN.h / 2;
  const solid = (c) => `color=c=0x${c}:s=${CANVAS.w}x${CANVAS.h}:d=1`;
  C.ffmpeg([
    "-f", "lavfi", "-i", solid(LOOK.backdrop),
    "-f", "lavfi", "-i", solid(LOOK.shadow),
    "-f", "lavfi", "-i", solid(LOOK.coral),
    "-f", "lavfi", "-i", `color=c=black:s=${CANVAS.w}x${CANVAS.h}:d=1`,
    "-filter_complex",
    `[3:v]format=gray,split[a][b];` +
      `[a]geq=lum='${rr(cx, cy + 30, WIN.w / 2, WIN.h / 2, WIN.r, 70)}',boxblur=56:3[sa];` +
      `[b]geq=lum='${rr(cx, cy, WIN.w / 2 + LOOK.ring, WIN.h / 2 + LOOK.ring, WIN.r + LOOK.ring)}'[ra];` +
      `[1:v][sa]alphamerge[shadow];[2:v][ra]alphamerge[ring];` +
      `[0:v][shadow]overlay[b1];[b1][ring]overlay,format=rgb24`,
    "-frames:v", "1", bg,
  ]);
  C.ffmpeg([
    "-f", "lavfi", "-i", `color=c=black:s=${WIN.w}x${WIN.h}:d=1`,
    "-vf", `format=gray,geq=lum='${rr(WIN.w / 2, WIN.h / 2, WIN.w / 2, WIN.h / 2, WIN.r)}'`,
    "-frames:v", "1", mask,
  ]);
  return { bg, mask };
}

function pdd(stage, args) {
  const env = {
    ...process.env,
    PATH: `${path.dirname(C.FFMPEG)}:${path.dirname(C.FFPROBE)}:${process.env.PATH}`,
  };
  const r = spawnSync(path.join(PDD, ".venv", "bin", "python"), [path.join(PDD, "tools", stage), ...args], {
    cwd: PDD, env, encoding: "utf8", maxBuffer: 64 << 20,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  fs.writeFileSync(path.join(PROJECT, `${stage.replace(".py", "")}.log`), out);
  return { ok: r.status === 0, out };
}

const t = take();
fs.rmSync(PROJECT, { recursive: true, force: true });
fs.mkdirSync(path.join(PROJECT, "assets"), { recursive: true });
const { bg, mask } = frameAssets(PROJECT);
const framed = path.join(PROJECT, "assets", "take-framed.mp4");
C.ffmpeg([
  ...(t.loop ? ["-stream_loop", "-1"] : ["-ss", t.start.toFixed(3)]), "-i", t.clip,
  "-loop", "1", "-i", bg,
  "-loop", "1", "-i", mask,
  "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
  "-filter_complex",
  `[0:v]fps=30,scale=${WIN.w}:${WIN.h}:flags=lanczos,format=yuva420p[v];[2:v]format=gray[m];` +
    `[v][m]alphamerge[win];[1:v][win]overlay=${WIN.x}:${WIN.y},format=yuv420p[out]`,
  "-map", "[out]", "-map", "3:a", "-t", String(SECONDS), "-r", "30",
  "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-c:a", "aac", "-b:a", "128k", framed,
]);

// The zoom lands on the target region (CSS px in the 1440x900 take) mapped into the framed canvas.
const focusX = ((WIN.x + (t.target.x + t.target.w / 2) * 2) / CANVAS.w) * 100;
const focusY = ((WIN.y + (t.target.y + t.target.h / 2) * 2) / CANVAS.h) * 100;
const script = {
  fps: 30,
  brand: { name: "Tvashtr", accent: "" },
  production: { qa: { allowedSilenceRanges: [{ startSec: 0, endSec: SECONDS }] } },
  shots: [
    {
      n: 1, kind: "clip", src: "take-framed.mp4", inSec: 0, durSec: SECONDS, sound: true,
      caption: CAPTION, captionStyle: "label",
      zooms: [{ atSec: 4, durSec: 11, scale: 1.8, focusX: +focusX.toFixed(2), focusY: +focusY.toFixed(2) }],
      sourceType: "product", liveState: true, continuityId: "run-view", stateId: "agents-working",
    },
  ],
};
const brand = {
  name: "Tvashtr",
  theme: { bg: "#faf9f5", ink: "#1f1e1b", accent: "#d97757", font: "Inter" },
};
fs.writeFileSync(path.join(PROJECT, "script.json"), `${JSON.stringify(script, null, 2)}\n`);
fs.writeFileSync(path.join(PROJECT, "brand.json"), `${JSON.stringify(brand, null, 2)}\n`);
log(`take ${path.relative(ROOT, t.clip)} from ${t.start.toFixed(2)}s; zoom on the ${t.label} at ${focusX.toFixed(1)}%, ${focusY.toFixed(1)}%`);

const creative = path.join(PROJECT, "out", "demo.mp4");
const master = path.join(PROJECT, "out", "demo-final.mp4");
const stages = [
  ["preflight.py", ["--project", PROJECT, "--strict"]],
  ["build.py", ["--project", PROJECT, "--contracts", "strict"]],
  ["finish.py", ["--input", creative, "--out", master, "--require-artifact", "--no-loudnorm"]],
  ["qa.py", ["--video", master, "--project", PROJECT, "--require-artifact", "--strict"]],
];
const results = {};
for (const [stage, args] of stages) {
  const r = pdd(stage, args);
  results[stage] = r.ok;
  const tail = r.out.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
  log(`${stage}: ${r.ok ? "OK" : "FAILED"} — ${tail.slice(0, 600)}`);
  if (!r.ok && stage !== "qa.py") process.exit(1);
}
fs.copyFileSync(master, FINAL);
const p = C.probe(FINAL);
const v = p.streams.find((s) => s.codec_type === "video");
const qa = JSON.parse(fs.readFileSync(path.join(PROJECT, "out", "qa-demo-final", "qa-report.json"), "utf8"));
const issues = (qa.issues || []).map((i) => i.code);
log(
  `REEL: ${path.relative(ROOT, FINAL)} ${v.width}x${v.height} ${v.r_frame_rate} ` +
    `${Number(p.format.duration).toFixed(2)}s qa=${results["qa.py"] ? "PASS" : "FAIL"}` +
    `${issues.length ? ` (${issues.join(",")})` : ""}`,
);
