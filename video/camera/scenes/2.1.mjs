// 2.1 New team from a template; the canvas opens.
import { keepOnlyKey, retireTeams } from "../film.mjs";
import { canvasReady } from "../flows.mjs";

export default {
  id: "2.1",
  title: "New team from a template; the canvas opens",
  mode: "live",
  budget: 12,
  setup: async ({ api, story }) => {
    await keepOnlyKey(api);
    await retireTeams(api, story.team.name);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    await cam.pause(700);
    await cam.click(page.getByRole("button", { name: "New team", exact: true }).first(), "New team");
    const dialog = page.getByRole("dialog", { name: "New team" });
    await dialog.waitFor();
    await cam.roi("dialog", dialog);
    await cam.pause(900);
    const tpl = dialog.locator("button.hm-tplcard", {
      has: page.locator(".hm-tplcard__name", { hasText: /^PM → Engineer ⇄ Reviewer$/ }),
    });
    await cam.click(tpl, "PM → Engineer ⇄ Reviewer");
    await cam.type(dialog.getByLabel("Name", { exact: true }), story.team.name, "the team's name", { clear: true });
    await cam.pause(500);
    await cam.click(dialog.getByRole("button", { name: "Create team", exact: true }), "Create team");
    await canvasReady(page);
    await cam.roi("canvas", page.locator(".react-flow"));
    await cam.pause(2500);
  },
};
