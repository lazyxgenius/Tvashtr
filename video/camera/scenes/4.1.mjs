// 4.1 The Engineer goes Quiet → Stalled → Failed (shortened timers; its CLI paused on purpose).
// Start the stack with QUIET=20 STALLED=60 FAIL=180. The Mac notification is a MAC shot.
import { execFileSync } from "node:child_process";
import { filmTeam } from "../film.mjs";
import { activity, answerNotifyAsk, composeAndLaunch, editAndApproveSpec, gateWaiting, nowBar, watch } from "../flows.mjs";
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
    const cli = processTree(app.process().pid).find((p) => /runner-jobs\//.test(p.command));
    if (!cli) throw new Error("no Desktop job CLI in the Electron process tree");
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
