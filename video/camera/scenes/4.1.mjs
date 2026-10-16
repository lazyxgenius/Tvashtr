// 4.1 The Engineer goes Quiet → Stalled → Failed (shortened timers; its CLI paused on purpose).
// Start the stack with QUIET=20 STALLED=60 FAIL=180. The Mac notification is a MAC shot (MAC-3): V3
// turns notifications on through the run toolbar's bell so macOS shows the stall banner the operator
// records; a macOS permission prompt is the operator's, never clicked here. V3 (D4): on chapter 6's
// team under the plain name.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chapter6Team } from "../film.mjs";
import { repoRoot } from "../desktop.mjs";
import { activity, answerNotifyAsk, composeAndLaunch, editAndApproveSpec, gateWaiting, nowBar, smoke, watch } from "../flows.mjs";
import { processTree } from "../desktop.mjs";

const state = (page, word) => nowBar(page).getByRole("button", { name: /^Engineer/ }).filter({ hasText: word });
export const SEED = path.join(repoRoot, "video", "out", "v2b", "seed.json");
/** V3: the run 4.1 fails, for 4.2 to resume (Needs you lists oldest first; an older failed run must not win). */
export const STALL = path.join(repoRoot, "video", "out", "v3", "stall.json");

/** MAC-3: the run toolbar's bell → "When a run stalls or fails" ticked → Turn on. */
async function turnOnNotifications(ctx) {
  const { page, cam, api } = ctx;
  await cam.click(page.getByRole("button", { name: "Notifications", exact: true }).first(), "Notifications");
  const pop = page.getByRole("dialog", { name: "Notifications" });
  await pop.waitFor({ timeout: 15000 });
  await cam.roi("notify", pop);
  await cam.pause(1200);
  const stalls = pop.getByRole("checkbox", { name: /When a run stalls or fails/ });
  if (!(await stalls.isChecked())) await cam.click(stalls, "When a run stalls or fails");
  await cam.click(pop.getByRole("button", { name: "Turn on", exact: true }), "Turn on");
  await pop.waitFor({ state: "hidden", timeout: 120000 }).catch(() => {});
  // The popover closes on the click; the choices are saved once the OS permission resolves.
  let prefs = {};
  for (let i = 0; i < 20 && !prefs.notify_stalls_fails; i += 1) {
    prefs = (await api("GET", "/api/account/preferences")).json ?? {};
    if (!prefs.notify_stalls_fails) await page.waitForTimeout(500);
  }
  ctx.note(`MAC-3: notifications ${prefs.notify_stalls_fails ? "on" : "NOT on"} for stalls/fails (${JSON.stringify(prefs)})`);
  console.log(`MAC3_BELL: notify_stalls_fails=${prefs.notify_stalls_fails}`);
}

export default {
  id: "4.1",
  title: "The Engineer goes Quiet → Stalled → Failed (shortened timers)",
  mode: "live",
  castEvery: 2,
  budget: 30,
  setup: async (ctx) => ({ team: await chapter6Team(ctx.api, SEED), task: ctx.story.runs.stall }),
  before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
  film: async (ctx) => {
    const { page, cam, app } = ctx;
    const run = await composeAndLaunch(ctx, { task: ctx.state.task, repo: ctx.story.repo.full_name, folder: ctx.story.repo.folder });
    fs.writeFileSync(STALL, JSON.stringify({ team: ctx.state.team, run, task: ctx.state.task }, null, 2));
    ctx.note(`4.1's run: ${run}`);
    await answerNotifyAsk(ctx, "Not now");
    await turnOnNotifications(ctx);
    await watch(ctx, async () => (await gateWaiting(page).count()) > 0, { label: "the spec gate" });
    await editAndApproveSpec(ctx, "Keep the change small and tested.");
    await watch(ctx, async () => (await state(page, "Working").count()) > 0, { label: "the Engineer working" });
    // Pause the Engineer's CLI — found only through this Desktop's own process tree (rule 8).
    // The runner claims the job a few seconds after "Working"; both CLIs run with --output-format
    // (Claude takes its prompt on stdin, so its command line has no runner-jobs/ path). V2b: only
    // Claude's `stream-json` — never a Grok job or its lock check (`streaming-json`).
    let cli = null;
    for (let i = 0; i < 90 && !cli; i++) {
      cli = processTree(app.process().pid).find((p) => /\s--output-format stream-json\s/.test(p.command));
      if (!cli) await page.waitForTimeout(1000);
    }
    if (!cli) throw new Error("no Desktop job CLI in the Electron process tree after 90 s");
    execFileSync("kill", ["-STOP", String(cli.pid)]);
    ctx.note(`paused the job CLI pid ${cli.pid}`);
    try {
      for (const word of ["Quiet", "Stalled", "Failed"]) {
        await watch(ctx, async () => (await state(page, word).count()) > 0, { label: word, timeout: 6 * 60000 });
        await cam.hover(nowBar(page).getByRole("button", { name: /^Engineer/ }), word);
        await cam.pause(2500);
      }
      await cam.hover(activity(page).locator(".lv-pin__box").first(), "the failed callout");
      await cam.pause(3000);
      // The live smoke (H1, H2): the failure line and the callout's "Next:".
      const failedShot = await ctx.shot("failed");
      const said = async (loc) => (await loc.innerText()).replace(/\s+/g, " ").trim();
      const callout = await said(activity(page).locator(".lv-pin__box").first());
      const ends = (await activity(page).locator(".lv-line__what").filter({ hasText: /^Failed after/ }).allInnerTexts()).map((t) => t.trim());
      const end = ends.pop() ?? "";
      smoke(ctx, "4.1 H1 (the failure line)", / · on your Claude subscription$/.test(end) && !/\$\d/.test(end), failedShot, end || "no “Failed after” line");
      smoke(ctx, "4.1 H2 (Next: resume …)", /Next: resume from Engineer, round 1\. Tvashtr skips the work that is done/.test(callout), failedShot, callout);
    } finally {
      try {
        execFileSync("kill", ["-TERM", String(cli.pid)]);
        execFileSync("kill", ["-CONT", String(cli.pid)]);
      } catch {
        /* already gone */
      }
    }
  },
};
