// 3.4 The Engineer in its own copy of the repo on the Claude sign-in; the Reviewer (Grok) rejects
// round 1; round 2 approved. Re-taken from the hero recording (V4 speeds it up).
import { activity, MARK, nowBar, openRunAgent, runPath, watch } from "../flows.mjs";

export default {
  id: "3.4",
  title: "Engineer on the Claude sign-in; Reviewer on Grok: round 1 back, round 2 approved",
  mode: "replay",
  recording: "hero",
  rehearse: "proof-3.2",
  from: (r) => MARK.approved(r) + 1000,
  budget: 30,
  before: async (ctx) => {
    await ctx.go(runPath(ctx));
    await nowBar(ctx.page).waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.roi("activity", activity(page));
    // The Engineer's raw log names the Claude Code on this computer.
    const eng = await openRunAgent(ctx, "Engineer");
    await cam.pause(2500);
    await cam.press("Escape", "close");
    await cam.hover(nowBar(page).getByRole("button", { name: /^Engineer/ }), "the Engineer");
    await watch(ctx, async () => (await activity(page).locator("li.lv-line").filter({ hasText: /^.*(Asked for|Approved)/ }).count()) > 0, {
      label: "a Reviewer verdict",
      timeout: 40 * 60000,
    });
    await cam.hover(activity(page).locator("li.lv-line").filter({ hasText: /Asked for|Approved/ }).last(), "the verdict");
    await cam.pause(4000);
    void eng;
  },
};
