// 3.4 The Engineer in its own copy of the repo on the Claude sign-in; the Reviewer (Grok) rejects
// round 1; round 2 approved. Re-taken from the hero recording (V4 speeds it up), from just before
// the first verdict.
import { activity, answerNotifyAsk, closeDrawer, MARK, nowBar, openRunAgent, runPath, watch } from "../flows.mjs";

export default {
  id: "3.4",
  title: "Engineer on the Claude sign-in; Reviewer on Grok: round 1 back, round 2 approved",
  mode: "replay",
  recording: "hero",
  rehearse: "proof-3.2",
  from: (r) => Math.max(0, MARK.verdict(r) - 25000),
  budget: 30,
  before: async (ctx) => {
    await ctx.go(runPath(ctx));
    await nowBar(ctx.page).waitFor({ timeout: 60000 });
    // The live page answered the notifications ask before this moment; the replay asks again.
    await answerNotifyAsk(ctx, "Not now", { wait: 4000, offCamera: true });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.roi("activity", activity(page));
    await cam.hover(nowBar(page).getByRole("button", { name: /^Engineer/ }), "the Engineer");
    // G5: the Engineer's drawer — its own copy of the repo, on the Claude sign-in (3.1 opened it).
    const d = await openRunAgent(ctx, "Engineer");
    await cam.roi("engineer", d);
    await cam.pause(5000);
    await closeDrawer(ctx);
    await watch(ctx, async () => (await activity(page).locator("li.lv-line").filter({ hasText: /^.*(Asked for|Approved)/ }).count()) > 0, {
      label: "a Reviewer verdict",
      timeout: 40 * 60000,
    });
    await cam.hover(activity(page).locator("li.lv-line").filter({ hasText: /Asked for|Approved/ }).last(), "the verdict");
    await cam.pause(4000);
  },
};
