// 3.6 The guardrail passes; Ship; the PR; the Done row. Re-taken from the hero recording.
import { answerNotifyAsk, approveWaiting, MARK, nowBar, runEnded, runPath, summary, watch } from "../flows.mjs";

export default {
  id: "3.6",
  title: "Guardrail passes; Ship; the PR; the Done row",
  mode: "replay",
  recording: "hero",
  rehearse: "proof-3.2",
  from: (r) => Math.max(0, MARK.shipped(r) - 20000),
  budget: 20,
  before: async (ctx) => {
    await ctx.go(runPath(ctx));
    await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
    // The live page answered the notifications ask before this moment; the replay asks again.
    await answerNotifyAsk(ctx, "Not now", { wait: 4000, offCamera: true });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    await cam.hover(page.locator(".rf-gate--approved").last(), "the guardrail passed").catch(() => {});
    // V2b: with the Tests check the Reviewer may approve without an Escalation; if the run waited at
    // one, the replay holds there until it is approved on camera, as the live take did.
    await watch(
      ctx,
      async () => {
        await approveWaiting(ctx);
        return runEnded(page);
      },
      { label: "the end", timeout: 10 * 60000 },
    );
    await cam.roi("summary", summary(page));
    const pr = summary(page).getByRole("link", { name: /^Open pull request/ });
    if (await pr.count()) await cam.hover(pr, "the pull request");
    await cam.pause(3000);
    void nowBar;
  },
};
