#!/usr/bin/env node
// Operator, once (V2): trade_mcp is private, so scene 0.1's PR page needs a signed-in GitHub
// session. This opens a visible Chromium at github.com/login; sign in yourself, then close the
// window. The session is saved to video/out/github-session.json (ignored; never committed).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { repoRoot } from "./desktop.mjs";

const file = path.join(repoRoot, "video", "out", "github-session.json");
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("https://github.com/login");
console.log("Sign in to GitHub in the window, then close it.");
await page.waitForEvent("close", { timeout: 0 });
fs.mkdirSync(path.dirname(file), { recursive: true });
await context.storageState({ path: file });
await browser.close();
console.log(`saved ${path.relative(repoRoot, file)}`);
