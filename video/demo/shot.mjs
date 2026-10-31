// Demo D1: screenshot a local HTML page (the thumbnail) with the film's Chromium.
//   PLAYWRIGHT_MODULE=$PWD/video/node_modules/playwright/index.mjs node video/demo/shot.mjs page.html out.jpg 1280 720
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const [html, out, w, h] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(pathToFileURL(html).href);
await page.evaluate(() => document.fonts.ready); // the brand type comes from Google Fonts, as in the cards
await page.waitForTimeout(500);
await page.screenshot({ path: out, type: out.endsWith(".jpg") ? "jpeg" : "png", ...(out.endsWith(".jpg") ? { quality: 90 } : {}) });
await browser.close();
