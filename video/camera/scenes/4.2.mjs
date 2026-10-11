// 4.2 Needs you → Resume from here; the confirm (kept / runs again / skipped); Carried over; it
// ships. Live on the newest failed run (V2: 4.1's TRIX run); --dry stops before "Resume run".
import { filmTeam } from "../film.mjs";
import { activity, nowBar, summary, toTheEnd } from "../flows.mjs";

export default {
  id: "4.2",
  title: "Needs you → Resume from here → the confirm → Carried over → it ships",
  mode: "live",
  castEvery: 2,
  budget: 25,
  // The newest failed or stopped run whose suggested step skips finished work. V2: a camera slip
  // resumed 4.1's run #3 from the PM (run #4, cancelled), so #3 reads "Picked up again"; the TRIX
  // run #2 (stopped while its Engineer waited for the Desktop) is the one left to resume.
  setup: async ({ api }) => {
    const team = await filmTeam(api);
    for (const r of (await api("GET", "/api/runs?limit=10")).json?.runs ?? []) {
      if (!["failed", "cancelled"].includes(r.status)) continue;
      const res = (await api("GET", `/api/runs/${r.run_id}/resume?desktop=1`)).json;
      const at = res?.available && res.points.find((p) => p.state === "suggested");
      if (at?.confirm?.skips_s > 0) return { team, run: r.run_id, number: res.number, inbox: r.status === "failed" };
    }
    return { team, run: null };
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    if (!ctx.state.run) {
      ctx.note("no run to resume from a step that skips work (V2: 4.1's TRIX run)");
      return ctx.advance("Resume (needs 4.1's failed run)", async () => {});
    }
    if (ctx.state.inbox) {
      const needs = page.locator("section[aria-label='Needs you']");
      await needs.waitFor({ timeout: 30000 });
      await cam.roi("needs-you", needs);
      const row = needs.locator("li.hm-inbox__item").filter({ has: page.locator(".hm-inbox__title", { hasText: /^Run (failed|stalled)$/ }) }).first();
      await cam.click(row.getByRole("button", { name: "Resume" }), "Resume");
    } else {
      // Needs you lists failed runs, not stopped ones: the stopped run's own callout.
      await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
      const box = activity(page).locator(".lv-pin__box").first();
      await box.waitFor({ timeout: 60000 });
      await cam.roi("stopped", box);
      await cam.hover(box, "the stopped run");
      await cam.pause(2500);
      await cam.click(box.getByRole("button", { name: /^Resume from / }), "Resume from the callout");
      ctx.note(`resumed run #${ctx.state.number} from its run view (stopped runs aren't in Needs you)`);
    }
    const pick = page.getByRole("complementary", { name: /^Resume run #\d+$/ });
    await pick.waitFor({ timeout: 30000 });
    await cam.roi("resume", pick);
    await cam.pause(1500);
    await ctx.shot("picker");
    // The suggested step (the one that failed): everything above it is kept and skipped.
    const suggested = pick.getByRole("listitem").filter({ hasText: "Suggested" });
    await cam.click(suggested.getByRole("button", { name: /Resume from here/ }), "Resume from here");
    const confirm = page.getByRole("dialog", { name: /^Resume from / });
    await confirm.waitFor();
    await cam.roi("confirm", confirm);
    await cam.pause(3000);
    // The live smoke (H2): the confirm's words and no dollar per step in the picker.
    await ctx.shot("confirm");
    ctx.note(`confirm: ${(await confirm.innerText()).replace(/\s+/g, " ").trim()}`);
    ctx.note(`picker has $: ${/\$\d/.test(await pick.innerText())}`);
    await ctx.spend("run", "Resume run", () => cam.click(confirm.getByRole("button", { name: "Resume run" }), "Resume run"));
    await nowBar(page).getByText("Carried over").first().waitFor({ timeout: 60000 });
    await cam.pause(2500);
    await toTheEnd(ctx, "the resumed run");
    await cam.roi("summary", summary(page));
    await cam.pause(3000);
  },
};
