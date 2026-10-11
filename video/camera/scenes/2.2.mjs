// 2.2 The Product manager's instructions; Edits allowed off (the entry agent is read-only).
import { buildFilmTeam, PM_LINE } from "../film.mjs";
import { canvasReady, openAgent, saveDrawer } from "../flows.mjs";

export default {
  id: "2.2",
  title: "The Product manager's instructions; Edits allowed off",
  mode: "live",
  budget: 12,
  setup: async ({ api }) => ({ team: (await buildFilmTeam(api, { upTo: "template" })).id }),
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const drawer = await openAgent(ctx, "Product manager");
    await cam.roi("drawer", drawer);
    const box = drawer.getByRole("textbox", { name: /^Instructions/ });
    await cam.click(box, "Instructions", { park: false });
    await page.keyboard.press("Meta+ArrowDown");
    await cam.type(box, `\n\n${PM_LINE}`, "one more line", { click: false, cps: 30 });
    await cam.pause(800);
    const access = drawer.getByRole("group", { name: "File access" });
    await access.scrollIntoViewIfNeeded();
    await cam.roi("file-access", access);
    await cam.hover(access.getByRole("button", { name: "Read-only" }), "Read-only (the entry agent)");
    await cam.pause(1500);
    await saveDrawer(ctx, drawer);
  },
};
