// 5.1 Start the next run from this: carry the spec, decisions, memories, summaries; start from the
// PR branch; then Recent tasks while typing on Home. Live on the newest finished run (V2: the hero
// run); --dry stops before "Start run".
import { heroRun, summary, toTheEnd } from "../flows.mjs";

export default {
  id: "5.1",
  title: "Start the next run from this; carry; from the PR branch; Recent tasks",
  mode: "live",
  budget: 25,
  setup: async ({ api }) => {
    const run = await heroRun(api);
    if (!run) throw new Error("5.1 needs a finished run (V2: the hero run)");
    return { team: run.team, run: run.run_id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
    await summary(ctx.page).waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    // Recent tasks while typing (Home's composer; it shows the finished runs' tasks).
    await cam.click(summary(page).getByRole("button", { name: "Start the next run from this" }), "Start the next run from this");
    const d = page.getByRole("dialog", { name: /^Start a new run from run #\d+$/ });
    await d.waitFor();
    await cam.roi("start-next", d);
    await cam.type(d.getByLabel("What should the team do next?"), story.runs.next, "the next task");
    for (const box of [/^The final spec/, /^Your decisions/, /^What the agents learned/, /^A short summary from each agent/]) {
      const cb = d.getByRole("checkbox", { name: box });
      if ((await cb.count()) && (await cb.isEnabled()) && !(await cb.isChecked())) await cam.click(cb, String(box));
    }
    const from = d.getByLabel("Start from");
    if (await from.locator("option[value='pr']").count()) {
      await cam.click(from, "Start from");
      await from.selectOption("pr");
      cam.mark("the PR branch");
    }
    await cam.pause(1500);
    await ctx.spend("run", "Start run", () => cam.click(d.getByRole("button", { name: "Start run" }), "Start run"));
    await page.getByRole("link", { name: /^From run #\d+$/ }).waitFor({ timeout: 60000 });
    await cam.pause(3000);
    // V2: the run goes on to ship (off camera; the Desktop stays open for its jobs).
    await toTheEnd(ctx, "the DEMA run");
    await cam.roi("summary", summary(page));
    await cam.pause(3000);
  },
  parts: [
    {
      key: "recent",
      title: "Recent tasks while typing (Home's composer)",
      mode: "live",
      setup: async () => ({}),
      before: async (ctx) => ctx.go("#/home"),
      film: async (ctx) => {
        const { page, cam } = ctx;
        const composer = page.locator("section[aria-label='Start a run']");
        await composer.waitFor({ timeout: 30000 });
        await cam.type(composer.getByRole("textbox", { name: "What should the team build?" }), "Add", "typing a task");
        const list = page.getByRole("listbox", { name: "Recent tasks" });
        await list.waitFor({ timeout: 15000 });
        await cam.roi("recent-tasks", list);
        await cam.hover(list.getByRole("option").first(), "a recent task");
        await cam.pause(2500);
        await cam.press("Escape");
      },
    },
  ],
};
