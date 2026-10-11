// 6.3 Compare v7 and v8; the results; a task set with hidden checks; Restore. Compares and task sets
// spend (none in V1): --dry stops before "Start compare".
import { buildFilmTeam, byRole, graph, must } from "../film.mjs";
import { canvasReady } from "../flows.mjs";

export default {
  id: "6.3",
  title: "Compare v7 and v8; results; a task set with hidden checks; Restore",
  mode: "live",
  budget: 40,
  setup: async (ctx) => {
    const { api, story } = ctx;
    const { id } = await buildFilmTeam(api, { upTo: "final" });
    const g = await graph(api, id);
    const rev = byRole(g, "reviewer");
    must(await api("GET", `/api/teams/${id}/versions`), "v1");
    // Versions up to v8, each a small honest change to the Reviewer's instructions.
    for (let v = 2; v <= story.versions.after; v += 1) {
      must(await api("PATCH", `/api/teams/${id}/nodes/${rev.id}`, { prompt: `${rev.prompt}\n\n(${v}) Name the file each fix belongs in.`, model: rev.model }), "edit");
      must(await api("POST", `/api/teams/${id}/versions`, {}), `save v${v}`);
    }
    return { team: id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    await cam.click(page.getByRole("toolbar", { name: "Team" }).getByRole("button", { name: "Compare", exact: true }), "Compare");
    await page.getByRole("heading", { name: "Compare versions" }).waitFor({ timeout: 30000 });
    // A task set with hidden checks (saving a set spends nothing).
    await cam.click(page.getByRole("tab", { name: /Task sets/ }), "Task sets");
    await cam.click(page.getByRole("button", { name: "New task set" }).first(), "New task set");
    const sd = page.getByRole("dialog", { name: "New task set" });
    await sd.waitFor();
    await cam.type(sd.getByLabel("Name"), story.task_set.name, "the set's name");
    const checks = ["pytest -q tests/test_indicators.py -k vortex", "pytest -q tests/test_indicators.py -k chande"];
    for (const [i, task] of story.task_set.tasks.entries()) {
      await cam.click(sd.getByRole("button", { name: "Add a task" }), "Add a task");
      await cam.type(sd.getByRole("textbox", { name: "Task", exact: true }).nth(i), task, task);
      await cam.type(sd.getByRole("textbox", { name: "Hidden check" }).nth(i), checks[i], "a hidden check", { cps: 30 });
    }
    await cam.click(sd.getByRole("button", { name: "Save set" }), "Save set");
    await sd.waitFor({ state: "hidden", timeout: 30000 });
    await cam.pause(1500);
    // Compare v7 and v8 on the set.
    await cam.click(page.getByRole("tab", { name: "Compare", exact: true }), "Compare");
    await cam.click(page.getByRole("combobox", { name: "Version A" }), "Version A");
    await page.getByRole("combobox", { name: "Version A" }).selectOption(String(story.versions.before));
    await page.getByRole("combobox", { name: "Version B" }).selectOption(String(story.versions.after));
    await cam.click(page.getByRole("radio", { name: "A task set" }), "A task set");
    await cam.pause(2000);
    await ctx.spend("compare", "Start compare", () => cam.click(page.getByRole("button", { name: "Start compare" }), "Start compare"));
  },
};
