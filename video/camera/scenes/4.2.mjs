// 4.2 Needs you → Resume from here; the confirm (kept / runs again / skipped); Carried over; it
// ships. Live on the newest failed run (V2: 4.1's TRIX run); --dry stops before "Resume run".
import { latestRun, nowBar, runEnded, summary, watch } from "../flows.mjs";

export default {
  id: "4.2",
  title: "Needs you → Resume from here → the confirm → Carried over → it ships",
  mode: "live",
  castEvery: 2,
  budget: 25,
  setup: async ({ api }) => {
    const run = await latestRun(api, "failed");
    return { run: run?.run_id ?? null };
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const needs = page.locator("section[aria-label='Needs you']");
    await needs.waitFor({ timeout: 30000 });
    await cam.roi("needs-you", needs);
    const row = needs.locator("li.hm-inbox__item").filter({ has: page.locator(".hm-inbox__title", { hasText: /^Run (failed|stalled)$/ }) }).first();
    if (!(await row.count())) {
      ctx.note("no failed run to resume yet (V2: 4.1's TRIX run)");
      return ctx.advance("Resume (needs 4.1's failed run)", async () => {});
    }
    await cam.click(row.getByRole("button", { name: "Resume" }), "Resume");
    const pick = page.getByRole("complementary", { name: /^Resume run #\d+$/ });
    await pick.waitFor({ timeout: 30000 });
    await cam.roi("resume", pick);
    await cam.pause(1500);
    await cam.click(pick.getByRole("button", { name: /Resume from here/ }).first(), "Resume from here");
    const confirm = page.getByRole("dialog", { name: /^Resume from / });
    await confirm.waitFor();
    await cam.roi("confirm", confirm);
    await cam.pause(3000);
    await ctx.spend("run", "Resume run", () => cam.click(confirm.getByRole("button", { name: "Resume run" }), "Resume run"));
    await nowBar(page).getByText("Carried over").first().waitFor({ timeout: 60000 });
    await cam.pause(2500);
    await watch(ctx, () => runEnded(page), { label: "the resumed run", timeout: 40 * 60000 });
    await cam.roi("summary", summary(page));
    await cam.pause(3000);
  },
};
