// Render design artboards to PNG + a measurement JSON, at each artboard's native size.
//
// Usage:
//   DESIGN_DIR=<export>/project node scripts/design-parity/shoot-design.mjs <outDir> [Name ...]
// DESIGN_DIR is the design canvas's `project/` folder (the `*.dc.html` artboards, `canvas.json`,
// `tvashtr-tokens.css`, `ds/…`) with the canvas runtime saved beside them as `support.js`.
// With no names, every artboard in canvas.json is rendered.
import fs from "node:fs";
import path from "node:path";

import { routeFonts } from "./fonts-route.mjs";
import { loadChromium, MEASURE, REPO, serveDir } from "./lib.mjs";

const DESIGN_DIR = process.env.DESIGN_DIR;
if (!DESIGN_DIR || !fs.existsSync(path.join(DESIGN_DIR, "canvas.json"))) {
  console.error("Set DESIGN_DIR to the design export's project/ folder (it must contain canvas.json).");
  process.exit(2);
}
const [outDir, ...names] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const canvas = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, "canvas.json"), "utf8"));
const boards = names.length ? names : Object.keys(canvas.boards).map((k) => k.replace(/\.dc\.html$/, ""));

// The design's logo points at a canvas-hosted blob; serve the repo's mark instead.
const MARK = fs.readFileSync(path.join(REPO, "frontend", "public", "mark-coral.png"));

const { server, port } = await serveDir(DESIGN_DIR);
const browser = await loadChromium();
let failures = 0;
for (const name of boards) {
  const b = canvas.boards[`${name}.dc.html`] ?? { w: 1440, h: 900 };
  const context = await browser.newContext({ viewport: { width: b.w, height: b.h }, deviceScaleFactor: 1 });
  await routeFonts(context);
  await context.route(/\/_blob\//, (route) =>
    route.fulfill({ status: 200, body: MARK, headers: { "content-type": "image/png" } }),
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/${name}.dc.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fontsOk = await page.evaluate(() =>
    [...document.fonts].some((f) => f.family.includes("Inter") && f.status === "loaded"),
  );
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(await page.evaluate(MEASURE)));
  if (!fontsOk || errors.length) failures += 1;
  console.log(name, `${b.w}x${b.h}`, fontsOk ? "fonts-ok" : "FONTS-MISSING", errors[0] ?? "");
  await context.close();
}
await browser.close();
server.close();
process.exit(failures ? 1 : 0);
