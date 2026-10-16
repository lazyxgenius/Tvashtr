// 2.5 A model per agent: the Engineer and the PM on Claude, the Reviewer on Claude → the same-model
// hint → switched to another Claude model (K8: the strongest the picker offers, a custom model ID);
// the Engineer's backup model (DeepSeek, the one API key).
import { buildFilmTeam } from "../film.mjs";
import { canvasReady, closeDrawer, openAgent, pickCustomModel, pickModel, saveDrawer, smoke } from "../flows.mjs";

export default {
  id: "2.5",
  title: "A model per agent; the Reviewer's same-model hint; switched to another Claude model",
  mode: "live",
  budget: 25,
  setup: async ({ api }) => ({ team: (await buildFilmTeam(api, { upTo: "guardrail" })).id }),
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    let d = await openAgent(ctx, "Engineer");
    await pickModel(ctx, d, /^anthropic\b/, "claude-sonnet-5");
    await d.getByText("Your Claude subscription · runs on this computer").first().waitFor({ timeout: 15000 }).catch(() => {});
    await cam.pause(900);
    // A backup model for when the main one fails (Advanced).
    await cam.click(d.getByRole("button", { name: /^Advanced/ }), "Advanced");
    await cam.click(d.getByRole("button", { name: /^Backup model/ }).first(), "Backup model");
    const bk = page.getByRole("dialog", { name: "Choose a backup model" });
    await bk.waitFor();
    await cam.click(bk.getByRole("group", { name: /^deepseek\b/ }).getByRole("option").first(), story.backup_model);
    await cam.pause(700);
    await saveDrawer(ctx, d);
    await closeDrawer(ctx);
    d = await openAgent(ctx, "Product manager");
    await pickModel(ctx, d, /^anthropic\b/, "claude-sonnet-5");
    await saveDrawer(ctx, d);
    await closeDrawer(ctx);
    d = await openAgent(ctx, "Reviewer");
    await pickModel(ctx, d, /^anthropic\b/, "claude-sonnet-5");
    const hint = d.getByRole("status").filter({ hasText: /both run/ });
    await hint.waitFor({ timeout: 15000 });
    await cam.roi("same-model-hint", hint);
    await cam.hover(hint, "the same-model hint");
    await cam.pause(2200);
    const said = (await hint.innerText()).replace(/\s+/g, " ").trim();
    const hintShot = await ctx.shot("same-model-hint");
    await pickCustomModel(ctx, d, story.agents.reviewer.model);
    const cleared = await hint.waitFor({ state: "hidden", timeout: 15000 }).then(() => true, () => false);
    await cam.pause(900);
    await ctx.shot("chosen-model");
    smoke(ctx, "2.5 (the same-model advisory with both on claude-sonnet-5; it clears on the chosen Claude model)",
      /both run/.test(said) && cleared, hintShot, `“${said}” → ${story.agents.reviewer.model}: ${cleared ? "cleared" : "still shown"}`);
    await saveDrawer(ctx, d);
  },
};
