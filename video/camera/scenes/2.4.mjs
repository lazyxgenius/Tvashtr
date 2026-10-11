// 2.4 The spec approval gate; the Engineer with tools and skills; the Reviewer and its loop; the
// guardrail (two gates: a secret scan, no edits to servers/); Ship and Stop. The two guardrail
// gates are wired in off camera (an edge drag is unreliable to film); their checks are set here.
import { buildFilmTeam, ensureToolkit, SKILL } from "../film.mjs";
import { canvasReady, card, closeDrawer, gateCard, openAgent, saveDrawer } from "../flows.mjs";

/** Open a gate by its card, set its type (and paths), save. */
async function setGate(ctx, label, type, paths) {
  const { page, cam } = ctx;
  await cam.click(gateCard(page, label).first(), `the ${label} gate`);
  const drawer = page.getByRole("complementary", { name: /settings$/ });
  await drawer.waitFor();
  await cam.click(drawer.getByRole("group", { name: "Gate type" }).getByRole("button", { name: type }), type);
  if (paths) await cam.type(drawer.getByRole("textbox", { name: "Forbidden paths" }), paths, "servers/**", { clear: true });
  await cam.pause(600);
  await cam.click(drawer.getByRole("button", { name: /^Save/ }).last(), "Save");
  await cam.pause(1200);
  await closeDrawer(ctx);
}

export default {
  id: "2.4",
  title: "Spec gate; Engineer with tools and skills; Reviewer loop; guardrail; Ship and Stop",
  mode: "live",
  budget: 30,
  setup: async ({ api }) => {
    await ensureToolkit(api);
    const { id } = await buildFilmTeam(api, { upTo: "guardrail", bareGuardrail: true });
    return { team: id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    await cam.hover(gateCard(page, "PRD approval"), "the spec approval gate");
    await cam.pause(1200);
    // The Engineer: a tool and a skill from the Toolkit.
    const drawer = await openAgent(ctx, "Engineer");
    await cam.click(drawer.getByRole("tab", { name: /^Skills & tools/ }), "Skills & tools");
    await cam.pause(900);
    await cam.click(drawer.getByRole("button", { name: "Add tool" }), "Add tool");
    await cam.click(page.getByRole("menuitem", { name: "From your library" }), "From your library");
    // "Add a tool" opens inside the drawer, on its Library tab.
    await drawer.getByText("Add a tool", { exact: true }).waitFor();
    await cam.click(drawer.getByRole("checkbox", { name: new RegExp(story.toolkit.tool, "i") }).first(), story.toolkit.tool);
    await cam.click(drawer.getByRole("button", { name: /^Add (\d+ )?tools?$/ }), "Add the tool");
    await cam.pause(700);
    await cam.click(drawer.getByRole("button", { name: "Add skill" }), "Add skill");
    await cam.click(page.getByRole("menuitem", { name: "From your library" }), "From your library");
    await drawer.getByText("Add from your library", { exact: true }).waitFor();
    await cam.click(drawer.getByRole("checkbox", { name: new RegExp(SKILL) }).first(), SKILL);
    await cam.click(drawer.getByRole("button", { name: /^Add (\d+ )?skills?$/ }), "Add the skill");
    await cam.pause(900);
    await saveDrawer(ctx, drawer);
    await closeDrawer(ctx);
    // The Reviewer and its loop back to the Engineer.
    await cam.hover(card(page, "Reviewer"), "the Reviewer");
    await cam.hover(page.locator(".react-flow__edge", { hasText: "changes requested" }).first(), "the loop back").catch(() => {});
    await cam.pause(1200);
    // The guardrail: a secret scan, then no edits to servers/.
    await setGate(ctx, "approval", "Secret leak scan");
    await setGate(ctx, "approval", "Forbidden paths", story.guardrail.forbidden.paths[0]);
    await cam.hover(page.locator(".rf-terminal--ship").first(), "Ship");
    await cam.hover(page.locator(".rf-terminal--stop").first(), "Stop");
    await cam.pause(1500);
  },
};
