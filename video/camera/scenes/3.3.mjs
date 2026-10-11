// 3.3 The gate → Needs you; open the spec, fix one line, approve. Re-taken from the hero recording.
import { activity, editAndApproveSpec, gateWaiting, MARK, nowBar, runPath } from "../flows.mjs";

export default {
  id: "3.3",
  title: "The spec gate: Needs you → open the spec → fix one line → approve",
  mode: "replay",
  recording: "hero",
  rehearse: "proof-3.2",
  from: (r) => MARK.gate(r) + 2000,
  budget: 25,
  before: async (ctx) => {
    await ctx.go(runPath(ctx));
    await gateWaiting(ctx.page).waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.hover(nowBar(page).getByRole("button").filter({ hasText: "Needs you" }).first(), "Needs you");
    await cam.pause(1500);
    await cam.hover(activity(page).locator(".lv-pin__box").first(), "the gate is waiting").catch(() => {});
    await cam.pause(1200);
    await editAndApproveSpec(ctx, "Keep the change small and tested.");
    await cam.pause(4000);
  },
};
