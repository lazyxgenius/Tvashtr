#!/usr/bin/env node
/**
 * MAC-3's free check (V3b, brief video-v3b D5): can a macOS banner from the dev Desktop reach the
 * screen? Opens the dev Desktop (a throwaway profile, focused as in a take) and shows one test
 * notification from its page — the same renderer `new Notification` the product's stall banner uses
 * (frontend/src/lib/runNotifier.ts). A banner lasts a few seconds and the operator reads the ask
 * later, so the one notification is shown again every SHOW_EVERY_S (the previous one closed first)
 * until this process is stopped (SIGTERM) or MAX_MIN passes.
 *
 *   node video/camera/notify-check.mjs      # the stack's Vite must be up (video/stack/up)
 *
 * A macOS "“Electron” Would Like to Send You Notifications" prompt is the operator's: never clicked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { frontmost, launchDesktop, repoRoot } from "./desktop.mjs";

const SHOW_EVERY_S = 12;
const MAX_MIN = 120; // the operator answers in chat; stopped (SIGTERM) as soon as they do
const out = path.join(repoRoot, "video", "out", "v3b", "notify-check");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-notify-check-"));
const { app, page } = await launchDesktop(out, "notify-check", {}, profile);
let stopping = false;
const stop = async (code = 0) => {
  if (stopping) return;
  stopping = true;
  await page.evaluate(() => window.__tvNote?.close()).catch(() => {});
  await app.close().catch(() => {});
  fs.rmSync(profile, { recursive: true, force: true });
  console.log("NOTIFY_CHECK_STOPPED");
  process.exit(code);
};
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void stop(0));

// Focused as in a take, then let go of always-on-top so the operator can bring the chat forward.
await frontmost(app, true);
await frontmost(app, false);
console.log(`NOTIFY_PERMISSION ${await page.evaluate(() => (typeof Notification === "undefined" ? "none" : Notification.permission))}`);
const show = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        window.__tvNote?.close();
        const n = new Notification("Tvashtr test", { body: "If you can see this, MAC-3 will work.", tag: "tvashtr-mac3-check" });
        window.__tvNote = n;
        n.onshow = () => resolve("shown");
        n.onerror = (e) => resolve(`error ${e?.message ?? e?.type ?? ""}`);
        setTimeout(() => resolve("no show/error event in 3 s"), 3000);
      }),
  );
const end = Date.now() + MAX_MIN * 60000;
for (let i = 1; Date.now() < end && !stopping; i += 1) {
  console.log(`NOTIFY_SHOW ${i} ${new Date().toISOString()} ${await show().catch((e) => `failed ${e.message}`)}`);
  await new Promise((r) => setTimeout(r, SHOW_EVERY_S * 1000));
}
await stop(0);
