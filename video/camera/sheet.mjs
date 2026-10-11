#!/usr/bin/env node
/**
 * V1's two review files, from the takes on disk:
 *   node video/camera/sheet.mjs contact-sheet  → video/out/v1/contact-sheet.png (one labelled frame per take)
 *   node video/camera/sheet.mjs ch2-preview    → video/out/v1/ch2-preview.mp4 (chapter 2's takes joined, 1920×1080)
 *   node video/camera/sheet.mjs pairs <replay take> → video/out/v1/pairs-<take>.png (live | replay, side by side)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ffmpeg, probe } from "./capture.mjs";
import { repoRoot } from "./desktop.mjs";

const TAKES = path.join(repoRoot, "video", "takes", "v1");
const OUT = path.join(repoRoot, "video", "out", "v1");
fs.mkdirSync(OUT, { recursive: true });

const order = (id) => id.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x).toString().padStart(3, "0") : x)).join(".");
function takes() {
  return fs
    .readdirSync(TAKES)
    .filter((d) => fs.existsSync(path.join(TAKES, d, "take.json")))
    .map((d) => ({ dir: d, ...JSON.parse(fs.readFileSync(path.join(TAKES, d, "take.json"), "utf8")) }))
    .filter((t) => /^\d/.test(t.take))
    .sort((a, b) => order(a.take).localeCompare(order(b.take)));
}

async function htmlShot(html, file, width = 1920) {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
  // A file:// page, so its file:// images load (a page set from a string can't reach them).
  const htmlFile = file.replace(/\.png$/, ".html");
  fs.writeFileSync(htmlFile, html);
  await p.goto(`file://${htmlFile}`, { waitUntil: "load" });
  await p.screenshot({ path: file, fullPage: true });
  await b.close();
}
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

async function contactSheet() {
  const list = takes().filter((t) => fs.existsSync(path.join(TAKES, t.dir, "poster.png")));
  const cells = list
    .map(
      (t) => `<figure><img src="file://${path.join(TAKES, t.dir, "poster.png")}"><figcaption><b>${esc(t.take)}</b> · ${esc(t.mode)} · ${esc(t.status)}${t.duration_s ? ` · ${t.duration_s}s` : ""}<br><span>${esc(t.title)}</span></figcaption></figure>`,
    )
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#efece1;font:14px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#141413}
    h1{font:600 22px Georgia,serif;margin:0 0 16px} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
    figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px #0002}
    img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover} figcaption{padding:8px 10px} span{color:#555}
  </style><h1>Tvashtr demo film — V1 takes (${list.length})</h1><div class="g">${cells}</div>`;
  const file = path.join(OUT, "contact-sheet.png");
  await htmlShot(html, file);
  console.log(`CONTACT_SHEET: ${path.relative(repoRoot, file)} (${list.length} takes)`);
}

function ch2Preview() {
  const list = takes().filter((t) => /^2\.\d$/.test(t.take) && t.status === "ok");
  if (!list.length) throw new Error("no chapter 2 takes");
  const inputs = list.flatMap((t) => ["-i", path.join(TAKES, t.dir, "take.mp4")]);
  const fit = list
    .map((_, i) => `[${i}:v]scale=1728:1080:flags=lanczos,pad=1920:1080:96:0:color=#efece1,setsar=1,fps=30[v${i}]`)
    .join(";");
  const cat = `${list.map((_, i) => `[v${i}]`).join("")}concat=n=${list.length}:v=1:a=0[out]`;
  const file = path.join(OUT, "ch2-preview.mp4");
  ffmpeg([...inputs, "-filter_complex", `${fit};${cat}`, "-map", "[out]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file]);
  const dur = Number(probe(file).format.duration).toFixed(1);
  console.log(`CH2_PREVIEW: ${path.relative(repoRoot, file)} ${dur}s (${list.map((t) => t.take).join(", ")})`);
}

async function pairs(replayTake) {
  const t = JSON.parse(fs.readFileSync(path.join(TAKES, replayTake, "take.json"), "utf8"));
  const rows = (t.pairs ?? [])
    .map(
      (p, i) => `<tr><td>${i + 1}<br>${esc(p.name)}<br>${(p.t_ms / 1000).toFixed(1)}s<br><b>${p.match ? "identical" : "differs"}</b></td><td><img src="file://${path.join(repoRoot, p.live)}"></td><td><img src="file://${path.join(repoRoot, p.file)}"></td></tr>`,
    )
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#fff;font:13px Helvetica,Arial}
    table{border-collapse:collapse} td{border:1px solid #ddd;padding:6px;vertical-align:top} img{width:860px;display:block}</style>
    <h2>${esc(replayTake)}: live (left) vs replay (right) — ${esc(t.pairs_matched)} identical Now bar + Activity texts</h2>
    <table><tr><th></th><th>live</th><th>replay</th></tr>${rows}</table>`;
  const file = path.join(OUT, `pairs-${replayTake}.png`);
  await htmlShot(html, file, 1860);
  console.log(`PAIRS: ${path.relative(repoRoot, file)} ${t.pairs_matched}`);
}

/** SCENES.md's status table: one row per take on disk (and per registry entry without one). */
async function scenesTable() {
  const { registry, takesOf } = await import("./take.mjs");
  const CH = { 0: 20, 1: 55, 2: 70, 3: 90, 4: 45, 5: 30, 6: 75, 7: 30, 8: 25 };
  const onDisk = Object.fromEntries(takes().map((t) => [t.take, t]));
  const rows = ["| take | mode | status | raw length | scene budget · chapter budget |", "|---|---|---|---|---|"];
  for (const sc of await registry())
    for (const t of takesOf(sc)) {
      const real = onDisk[t.take];
      const dry = onDisk[`${t.take}-dry`];
      const got = real ?? dry;
      const status = !got
        ? t.mode === "mac" || t.mode === "motion" ? t.mode.toUpperCase() : "not filmed"
        : got.status === "dry"
          ? `dry · stopped before “${got.stopped_before}”`
          : got.status === "ok"
            ? "clip"
            : `${got.status}: ${(got.error ?? "").split("\n")[0].slice(0, 90)}`;
      const ch = Number(t.id.split(".")[0]);
      rows.push(`| ${t.take} | ${got?.mode ?? t.mode} | ${status} | ${got?.duration_s ? `${got.duration_s} s` : "—"} | ${t.budget ?? "—"} s · ch ${ch}: ${CH[ch]} s |`);
    }
  console.log(rows.join("\n"));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "contact-sheet") await contactSheet();
else if (cmd === "ch2-preview") ch2Preview();
else if (cmd === "pairs") await pairs(arg);
else if (cmd === "scenes-table") await scenesTable();
else console.log("usage: sheet.mjs contact-sheet | ch2-preview | pairs <replay take>");
