// 2.3 A Query domain box feeding the team: Domains › Exchange API docs › Use in teams › Add step,
// after the Product manager (a Query domain can't come before the entry agent: video/SCENES.md).
import { buildFilmTeam, ensureDomain } from "../film.mjs";
import { canvasReady } from "../flows.mjs";

export default {
  id: "2.3",
  title: "A Query domain box feeding the Product manager's spec",
  mode: "live",
  budget: 12,
  setup: async ({ api }) => {
    const domain = await ensureDomain(api);
    const { id } = await buildFilmTeam(api, { upTo: "pm" });
    return { team: id, domain };
  },
  start: undefined,
  before: async (ctx) => {
    await ctx.go(`#/domains/${ctx.state.domain}/teams`);
    await ctx.page.getByRole("button", { name: "Add as a step in a team" }).waitFor({ timeout: 30000 });
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    await cam.pause(900);
    await cam.click(page.getByRole("button", { name: "Add as a step in a team" }), "Add as a step in a team");
    const d = page.getByRole("dialog", { name: `Add ${story.domain.name} to a team` });
    await d.waitFor();
    await cam.roi("dialog", d);
    const list = d.getByRole("listbox", { name: "Team" });
    await cam.click(list.getByRole("option", { name: new RegExp(`^${story.team.name}(?! \\()`) }), story.team.name);
    await cam.hover(d.getByRole("combobox", { name: "Where in the flow" }), "After Product manager");
    await cam.pause(700);
    await cam.hover(d.getByText("Pass the answer to the next agents").first(), "Pass the answer on");
    await cam.pause(700);
    await cam.click(d.getByRole("button", { name: "Add step" }), "Add step");
    await canvasReady(page);
    const drawer = page.getByRole("complementary", { name: /settings$/ });
    await drawer.waitFor({ timeout: 30000 });
    await cam.roi("query-domain", drawer);
    await cam.pause(2500);
  },
};
