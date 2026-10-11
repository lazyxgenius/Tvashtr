// 7.1 Save the Reviewer as my agent "Strict Reviewer"; use it in another team; Undo; "Based on
// Strict Reviewer v1".
import { buildFilmTeam, must, retireTeams } from "../film.mjs";
import { canvasReady, openAgent } from "../flows.mjs";

export default {
  id: "7.1",
  title: "Save as my agent; use it in another team; Undo; Based on Strict Reviewer v1",
  mode: "live",
  budget: 20,
  setup: async ({ api, story }) => {
    for (const a of must(await api("GET", "/api/my-agents"), "my agents").agents ?? [])
      if (a.name === story.my_agent) must(await api("DELETE", `/api/my-agents/${a.id}`), "delete my agent");
    const { id } = await buildFilmTeam(api, { upTo: "final" });
    await retireTeams(api, story.team.other_team);
    const other = must(await api("POST", "/api/teams", { template: "review_loop", name: story.team.other_team }), "other team");
    return { team: id, other: other.team_graph_id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    let d = await openAgent(ctx, "Reviewer");
    await cam.click(d.getByRole("button", { name: "More actions" }), "More actions");
    await cam.click(page.getByRole("menuitem", { name: /Save as my agent/ }), "Save as my agent");
    const save = page.getByRole("dialog", { name: "Save Reviewer as my agent" });
    await save.waitFor();
    await cam.type(save.getByLabel("Name"), story.my_agent, "Strict Reviewer", { clear: true });
    await cam.pause(800);
    await cam.click(save.getByRole("button", { name: "Save to My agents" }), "Save to My agents");
    await d.getByText(`Saved as ${story.my_agent} v1`).waitFor({ timeout: 15000 }).catch(() => {});
    await cam.pause(1200);
    // Another team.
    await ctx.go(`#/teams/${ctx.state.other}`);
    await canvasReady(page);
    d = await openAgent(ctx, "Reviewer");
    const use = async () => {
      await cam.click(d.getByRole("button", { name: "Templates" }), "Templates");
      await cam.click(page.getByRole("menuitem", { name: new RegExp(story.my_agent) }), story.my_agent);
    };
    await use();
    await d.getByText(`Reviewer now uses ${story.my_agent} v1`).waitFor({ timeout: 15000 }).catch(() => {});
    await cam.click(d.getByRole("button", { name: "Undo" }), "Undo");
    await cam.pause(1200);
    await use();
    const based = d.locator(".nd-based");
    await based.waitFor({ timeout: 15000 });
    await cam.roi("based-on", based);
    await cam.hover(based, "Based on Strict Reviewer v1");
    await cam.pause(2000);
  },
};
