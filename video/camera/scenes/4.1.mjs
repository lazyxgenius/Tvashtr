// 4.1 The Engineer goes Quiet → Stalled → Failed (shortened timers; its CLI paused on purpose).
// Start the stack with QUIET=20 STALLED=60 FAIL=180. The Mac notification is a MAC shot.
import { execFileSync } from "node:child_process";
import { filmTeam } from "../film.mjs";
import { activity, answerNotifyAsk, composeAndLaunch, editAndApproveSpec, gateWaiting, nowBar, smoke, watch } from "../flows.mjs";
import { processTree } from "../desktop.mjs";

const state = (page, word) => nowBar(page).getByRole("button", { name: /^Engineer/ }).filter({ hasText: word });

export default {
  id: "4.1",
  title: "The Engineer goes Quiet → Stalled → Failed (shortened timers)",
  mode: "live",
  castEvery: 2,
  budget: 30,
  setup: async (ctx) => ({ team: await filmTeam(ctx.api), task: ctx.story.runs.stall }),
  before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
  film: async (ctx) => {
    const { page, cam, app } = ctx;
    await composeAndLaunch(ctx, { task: ctx.state.task, repo: ctx.story.repo.full_name, folder: ctx.story.repo.folder });
    await answerNotifyAsk(ctx, "Not now");
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
