#!/usr/bin/env node
/**
 * The review files, from the takes on disk (V2b: the newest take of each scene, v2b over v2 over v1):
 *   node video/camera/sheet.mjs contact-sheet  → video/out/v2b/contact-sheet.png (one labelled frame per take)
 *   node video/camera/sheet.mjs preview <ch>   → video/out/v2b/ch<ch>-preview.mp4 (the chapter's takes joined, 1920×1080)
 *   node video/camera/sheet.mjs ch2-preview    → video/out/v1/ch2-preview.mp4 (V1's)
 *   node video/camera/sheet.mjs pairs <replay take> → video/out/v2b/pairs-<take>.png (live | replay, side by side)
 *   node video/camera/sheet.mjs scenes-table   → SCENES.md's status table (V1, V2 and V2b columns)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ffmpeg, probe } from "./capture.mjs";
import { repoRoot } from "./desktop.mjs";

const TAKES_DIR = (v) => path.join(repoRoot, "video", "takes", v);
/** Oldest first: a newer version wins among equals; the last is the one being filmed. */
const VERSIONS = ["v1", "v2", "v2b"];
const CUR = VERSIONS.at(-1);
const OUT = path.join(repoRoot, "video", "out", CUR);
fs.mkdirSync(OUT, { recursive: true });

const order = (id) => id.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x).toString().padStart(3, "0") : x)).join(".");
/** The takes of one version (v1 | v2 | v2b) on disk, in scene order; each knows its folder. */
function takes(v = CUR) {
  const dir = TAKES_DIR(v);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((d) => fs.existsSync(path.join(dir, d, "take.json")))
    .map((d) => ({ v, dir: d, path: path.join(dir, d), ...JSON.parse(fs.readFileSync(path.join(dir, d, "take.json"), "utf8")) }))
    .filter((t) => /^\d/.test(t.take))
    .sort((a, b) => order(a.take).localeCompare(order(b.take)));
}
/** The newest take of each take id (a rehearsal in `<take>-dry` counts as its take's): a filmed clip over
 *  a rehearsal over a failed take, a newer version over an older among equals — a newer rehearsal
 *  never replaces an older clip. */
const rank = (t) => (/-dry$/.test(t.take) ? 1 : t.status === "ok" ? 2 : 0) + VERSIONS.indexOf(t.v) * 0.25;
function newest() {
  const by = new Map();
  for (const t of VERSIONS.flatMap((v) => takes(v))) {
    const id = t.take.replace(/-dry$/, "");
    if (!by.has(id) || rank(t) > rank(by.get(id))) by.set(id, t);
  }
  return [...by.values()].sort((a, b) => order(a.take).localeCompare(order(b.take)));
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
  const list = newest().filter((t) => fs.existsSync(path.join(t.path, "poster.png")));
  const cells = list
    .map(
      (t) => `<figure><img src="file://${path.join(t.path, "poster.png")}"><figcaption><b>${esc(t.take)}</b> · ${esc(t.v)} · ${esc(t.mode)} · ${esc(t.status)}${t.duration_s ? ` · ${t.duration_s}s` : ""}<br><span>${esc(t.title)}</span></figcaption></figure>`,
    )
    .join("");
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:24px;background:#efece1;font:14px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#141413}
    h1{font:600 22px Georgia,serif;margin:0 0 16px} .g{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
    figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px #0002}
    img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover} figcaption{padding:8px 10px} span{color:#555}
  </style><h1>Tvashtr demo film — the newest take of every scene, V2b over V2 over V1 (${list.length})</h1><div class="g">${cells}</div>`;
  const file = path.join(OUT, "contact-sheet.png");
  await htmlShot(html, file);
  console.log(`CONTACT_SHEET: ${path.relative(repoRoot, file)} (${list.length} takes: ${[...VERSIONS].reverse().map((v) => `${list.filter((t) => t.v === v).length} ${v.replace("v", "V")}`).join(", ")})`);
}

/** A record take's own scene is its first minute (the run it records is shown by its replays). */
const RECORD_HEAD_S = 60;

/** Chapter `ch`'s newest filmed takes joined at 1920×1080 (no narration). */
function chapterPreview(ch, out = path.join(OUT, `ch${ch}-preview.mp4`), pick = newest) {
  const list = pick().filter(
    (t) => t.take.split(".")[0] === String(ch) && t.status === "ok" && !/dry/.test(t.mode) && fs.existsSync(path.join(t.path, "take.mp4")) && !/-(proof|replay)$/.test(t.take),
  );
  if (!list.length) throw new Error(`no chapter ${ch} takes`);
  const inputs = list.flatMap((t) => [...(t.mode === "record" ? ["-t", String(RECORD_HEAD_S)] : []), "-i", path.join(t.path, "take.mp4")]);
  const fit = list
    .map((_, i) => `[${i}:v]scale=1728:1080:flags=lanczos,pad=1920:1080:96:0:color=#efece1,setsar=1,fps=30[v${i}]`)
    .join(";");
  const cat = `${list.map((_, i) => `[v${i}]`).join("")}concat=n=${list.length}:v=1:a=0[out]`;
  ffmpeg([...inputs, "-filter_complex", `${fit};${cat}`, "-map", "[out]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
  const dur = Number(probe(out).format.duration).toFixed(1);
  console.log(`PREVIEW: ${path.relative(repoRoot, out)} ${dur}s (${list.map((t) => `${t.take}${t.v === CUR ? "" : ` [${t.v}]`}`).join(", ")})`);
}

async function pairs(replayTake) {
  const { ageless } = await import("./take.mjs");
  const T = TAKES_DIR(fs.existsSync(path.join(TAKES_DIR("v2"), replayTake)) ? "v2" : "v1");
  const t = JSON.parse(fs.readFileSync(path.join(T, replayTake, "take.json"), "utf8"));
  const live = JSON.parse(fs.readFileSync(path.join(T, t.pairs?.[0]?.live?.split("/").at(-3) ?? "3.2-proof", "take.json"), "utf8")).pairs;
  // Each pair: exact (identical texts), ages (identical apart from relative ages), or differs.
  const cls = (t.pairs ?? []).map((p, i) =>
    p.match ? "exact" : JSON.stringify(ageless(p.texts)) === JSON.stringify(ageless(live[i]?.texts)) ? "ages" : "differs",
  );
  const n = (c) => cls.filter((x) => x === c).length;
  const summary = `${n("exact")}/${cls.length} identical · ${n("exact") + n("ages")}/${cls.length} identical apart from relative ages · ${n("differs")}/${cls.length} differ`;
  const label = { exact: "identical", ages: "identical apart from relative ages", differs: "differs" };
  const rows = (t.pairs ?? [])
    .map(
      (p, i) => `<tr><td>${i + 1}<br>${esc(p.name)}<br>${(p.t_ms / 1000).toFixed(1)}s<br><b>${label[cls[i]]}</b></td><td><img src="file://${path.join(repoRoot, p.live)}"></td><td><img src="file://${path.join(repoRoot, p.file)}"></td></tr>`,
    )
    .join("");
  t.pairs_matched = summary;
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:20px;background:#fff;font:13px Helvetica,Arial}
    table{border-collapse:collapse} td{border:1px solid #ddd;padding:6px;vertical-align:top} img{width:860px;display:block}</style>
    <h2>${esc(replayTake)}: live (left) vs replay (right) — ${esc(t.pairs_matched)} identical Now bar + Activity texts</h2>
    <table><tr><th></th><th>live</th><th>replay</th></tr>${rows}</table>`;
  const file = path.join(OUT, `pairs-${replayTake}.png`);
  await htmlShot(html, file, 1860);
  console.log(`PAIRS: ${path.relative(repoRoot, file)} ${summary}`);
  console.log(`  differ: ${cls.map((c, i) => (c === "differs" ? i + 1 : null)).filter(Boolean).join(", ")}`);
}

/** SCENES.md's status table: one row per registry take, its status in each version side by side. */
async function scenesTable() {
  const { registry, takesOf } = await import("./take.mjs");
  const CH = { 0: 20, 1: 55, 2: 70, 3: 90, 4: 45, 5: 30, 6: 75, 7: 30, 8: 25 };
  const disk = Object.fromEntries(VERSIONS.map((v) => [v, Object.fromEntries(takes(v).map((t) => [t.take, t]))]));
  const status = (t, v) => {
    const real = disk[v][t.take];
    const dry = disk[v][`${t.take}-dry`];
    const got = real ?? dry;
    const err = (got?.error ?? "").split("\n")[0];
    if (!got) return t.mode === "mac" || t.mode === "motion" ? t.mode.toUpperCase() : "—";
    if (/BLOCKED/.test(err)) return `blocked: ${err.replace(/^Error: BLOCKED: /, "")}`;
    if (real) return real.status === "ok" ? `clip (${real.mode})${real.duration_s ? ` ${real.duration_s} s` : ""}` : `${real.status}: ${err.slice(0, 80)}`;
    return dry.status === "dry" ? `rehearsed · stopped before “${dry.stopped_before}”` : dry.status === "ok" ? `rehearsed (${dry.mode.replace(" (dry)", "")}, no spend)` : `rehearsal ${dry.status}: ${err.slice(0, 80)}`;
  };
  const rows = [
    `| take | script | ${VERSIONS.map((v) => v.replace("v", "V")).join(" | ")} | scene budget · chapter budget |`,
    `|${"---|".repeat(VERSIONS.length + 3)}`,
  ];
  for (const sc of await registry())
    for (const t of takesOf(sc)) {
      const ch = Number(t.id.split(".")[0]);
      rows.push(`| ${t.take} | \`scenes/${t.id}.mjs\` (${t.mode}) | ${VERSIONS.map((v) => status(t, v)).join(" | ")} | ${t.budget ?? "—"} s · ch ${ch}: ${CH[ch]} s |`);
    }
  console.log(rows.join("\n"));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "contact-sheet") await contactSheet();
else if (cmd === "preview") chapterPreview(Number(arg));
else if (cmd === "ch2-preview") chapterPreview(2, path.join(repoRoot, "video", "out", "v1", "ch2-preview.mp4"), () => takes("v1"));
else if (cmd === "pairs") await pairs(arg);
else if (cmd === "scenes-table") await scenesTable();
else console.log("usage: sheet.mjs contact-sheet | preview <chapter> | ch2-preview | pairs <replay take> | scenes-table");
