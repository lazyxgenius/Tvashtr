// 2.6 "Remember what it learns" on the Engineer; "If it fails or times out" → a Fixer on DeepSeek.
// (The $5 budget lives in the composer's Run options — filmed in 3.1: video/SCENES.md.)
import { buildFilmTeam, byRole, graph, must } from "../film.mjs";
import { canvasReady, card, closeDrawer, edgePoint, openAgent, pickModel, saveDrawer } from "../flows.mjs";

export default {
  id: "2.6",
  title: "Remember what it learns; if it fails or times out → a Fixer",
  mode: "live",
  budget: 25,
  setup: async ({ api }) => {
    // A new agent already wired in (Engineer → it → Reviewer), unconfigured: on camera it becomes the
    // Fixer and its path the failure path (an edge drag is unreliable to film).
    const { id } = await buildFilmTeam(api, { upTo: "models" });
    const g = await graph(api, id);
    const eng = byRole(g, "engineer");
    const rev = byRole(g, "reviewer");
    const n = must(
      await api("POST", `/api/teams/${id}/nodes`, { node_kind: "worker", position: { x: eng.position.x + 130, y: eng.position.y + 360 } }),
      "new agent",
    );
    const path = must(await api("POST", `/api/teams/${id}/edges`, { source_node_id: eng.id, target_node_id: n.id, role: "forward" }), "engineer → new");
    must(await api("POST", `/api/teams/${id}/edges`, { source_node_id: n.id, target_node_id: rev.id, role: "forward" }), "new → reviewer");
    return { team: id, fixer: n.id, path: path.id ?? path.edge_id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    let d = await openAgent(ctx, "Engineer");
    await cam.click(d.getByRole("tab", { name: /^Memory/ }), "Memory");
    const sw = d.getByRole("switch", { name: "Remember what it learns" });
    await cam.click(sw, "Remember what it learns");
    await cam.pause(1500);
    await closeDrawer(ctx);
    // The new agent → named Fixer, from the Engineer template, on DeepSeek.
    await cam.click(card(page, "New agent").locator(".rf-node__role"), "the new agent");
    d = page.getByRole("complementary", { name: "New agent settings" });
    await d.waitFor({ timeout: 30000 });
    await cam.click(d.getByRole("tab", { name: /^Setup/ }), "Setup");
    await cam.click(d.getByRole("button", { name: "More actions" }), "More actions");
    await cam.click(page.getByRole("menuitem", { name: "Rename" }), "Rename");
    const nameBox = d.getByRole("textbox", { name: "Agent name" });
    await cam.type(nameBox, story.agents.fixer.title, "Fixer", { click: false, clear: true });
    await cam.press("Enter");
    d = page.getByRole("complementary", { name: `${story.agents.fixer.title} settings` });
    await d.waitFor();
    await cam.click(d.getByRole("group", { name: "Start from a template" }).getByRole("button", { name: "Engineer" }), "Engineer template");
    await pickModel(ctx, d, /^deepseek\b/, "deepseek-chat");
    await saveDrawer(ctx, d);
    await closeDrawer(ctx);
    // The path to it: "If it fails or times out".
    const at = await edgePoint(page, ctx.state.path);
    await cam.clickAt(at.x, at.y, "the path to the Fixer");
    const menu = page.getByRole("menu", { name: "Use this path" });
    await menu.waitFor();
    await cam.click(menu.getByRole("menuitem", { name: /^If it fails or times out/ }), "If it fails or times out");
    await cam.pause(2000);
  },
};
