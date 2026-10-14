// 3.4 The Engineer in its own copy of the repo on the Claude sign-in; Tvashtr runs the tests in its own
// sandbox — failed: back to the Engineer with the last lines (opened on camera), or passed; the Reviewer
// on Grok gives its verdict (part "verdict"). Re-taken from the hero recording (V4 speeds them up).
// No `rehearse`: V1's proof recording has no Tests check (MARK.tests would throw).
import { activity, answerNotifyAsk, closeDrawer, MARK, nowBar, openRunAgent, runPath, watch } from "../flows.mjs";

const ready = async (ctx) => {
  await ctx.go(runPath(ctx));
  await nowBar(ctx.page).waitFor({ timeout: 60000 });
  // The live page answered the notifications ask before this moment; the replay asks again.
  await answerNotifyAsk(ctx, "Not now", { wait: 4000, offCamera: true });
};

export default {
  id: "3.4",
  title: "Engineer on the Claude sign-in; Tvashtr runs the tests; the Reviewer on Grok",
  mode: "replay",
  recording: "hero",
  from: (r) => Math.max(0, MARK.tests(r) - 8000),
  budget: 30,
  before: ready,
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.roi("activity", activity(page));
    await cam.hover(nowBar(page).getByRole("button", { name: /^Engineer/ }), "the Engineer");
    // G5: its own copy of the repo on the Claude sign-in; Raw log says "Claude Code is locked to this
    // job's copy of the repo" (3.1 recorded the run events).
    const d = await openRunAgent(ctx, "Engineer");
    await cam.roi("engineer", d);
    await cam.click(d.getByRole("group", { name: "Steps" }).getByRole("button", { name: "Raw log", exact: true }), "Raw log");
    await cam.pause(4000);
    await closeDrawer(ctx);
    const result = activity(page).locator("li.lv-line").filter({ hasText: /Tests passed|Tests failed|Couldn’t run the tests/ }).first();
    await watch(ctx, async () => (await result.count()) > 0, { label: "the Tests result", timeout: 15 * 60000 });
    await cam.roi("tests", result);
    const show = result.getByRole("button", { name: "Show output", exact: true });
    if (await show.count()) await cam.click(show, "Show output"); // the page's own state: no request
    else await cam.hover(result.locator(".lv-line__what"), "the Tests result");
    await cam.pause(5000);
  },
  parts: [
    {
      key: "verdict",
      title: "The Reviewer on Grok: its verdict, with Tvashtr's test result",
      from: (r) => Math.max(0, MARK.verdict(r) - 25000),
      film: async (ctx) => {
        const { page, cam } = ctx;
        await cam.roi("activity", activity(page));
        // By the Reviewer's name: the PRD gate's "Approved with your edits" line matches /Approved/ too.
        const verdict = activity(page)
          .locator("li.lv-line")
          .filter({ has: page.locator(".lv-line__who", { hasText: /^Reviewer$/ }) })
          .filter({ hasText: /Asked for|Approved/ });
        await watch(ctx, async () => (await verdict.count()) > 0, { label: "a Reviewer verdict", timeout: 40 * 60000 });
        await cam.hover(verdict.last(), "the verdict");
        const notes = verdict.last().getByRole("button", { name: "Read notes", exact: true });
        if (await notes.count()) await cam.click(notes, "Read notes");
        await cam.pause(4000);
      },
    },
  ],
};
