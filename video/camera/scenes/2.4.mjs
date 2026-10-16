// 2.4 The spec approval gate; the Engineer with tools and skills; the Tests pass check (the repo's own
// tests in Tvashtr's sandbox, a failure back to the Engineer — V2b K1); the Reviewer and its loop; the
// guardrail (a secret scan, no edits to servers/); Ship and Stop. The three gates are wired in off
// camera as plain gates with their real titles (an edge drag is unreliable to film); their checks are
// set here.
import { buildFilmTeam, byRole, byTitle, edge, ensureToolkit, SKILL } from "../film.mjs";
import { canvasReady, card, closeDrawer, edgePoint, gateCard, openAgent, saveDrawer, smoke } from "../flows.mjs";

/** M-desk-8 P1: the gate cards read their titles (or a type name), never a raw kind id. */
const RAW_KIND = /^(approval|gate_approval|secret_leak_scan|diff_touches_forbidden_paths|output_schema_check)$/;
const gateLabels = async (page) => (await page.locator(".rf-gate__label").allInnerTexts()).map((t) => t.trim());

/** Open a gate by its node id, set its type (and its one field), save. */
async function setGate(ctx, id, label, type, field) {
  const { page, cam } = ctx;
  await cam.click(page.locator(`.react-flow__node[data-id="${id}"]`), `the ${label} gate`);
  const drawer = page.getByRole("complementary", { name: /settings$/ });
  await drawer.waitFor();
  await cam.click(drawer.getByRole("group", { name: "Gate type" }).getByRole("button", { name: type }), type);
  if (field)
    await cam.type(drawer.getByRole("textbox", { name: field.box }), field.text, field.label ?? field.text, {
      clear: true,
      ...(field.cps ? { cps: field.cps } : {}),
    });
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
  setup: async ({ api, story }) => {
    await ensureToolkit(api);
    const { id, g } = await buildFilmTeam(api, { upTo: "guardrail", bareGuardrail: true });
    const gate = (t) => byTitle(g, t).id;
    const eng = byRole(g, "engineer");
    const loop = (from) => edge(g, from, eng)?.id;
    return {
      team: id,
      tests: gate(story.tests.title),
      scan: gate(story.guardrail.secret_scan.title),
      paths: gate(story.guardrail.forbidden.title),
      testsLoop: loop(byTitle(g, story.tests.title)),
      reviewLoop: loop(byRole(g, "reviewer")),
    };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    // P1 on the bare gates (plain approval gates wired in with their real titles): titles, not "approval".
    const bare = await gateLabels(page);
    smoke(ctx, "P1 (2.4's bare gates read their titles, never a raw kind)",
      [story.tests.title, story.guardrail.secret_scan.title, story.guardrail.forbidden.title].every((w) => bare.includes(w)) && !bare.some((l) => RAW_KIND.test(l)),
      await ctx.shot("p1-gates-bare"), bare.join(" · "));
    // A loop arc's own label is drawn apart from its path: glide along the path itself.
    const arc = async (edgeId, label) => {
      if (!edgeId) return;
      const at = await edgePoint(page, edgeId);
      await cam.glide(at.x, at.y, label);
      await cam.pause(1200);
    };
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
    // Tests pass: the repo's own tests in Tvashtr's sandbox; a failed run goes back to the Engineer.
    await setGate(ctx, ctx.state.tests, story.tests.title, "Tests pass", {
      box: "Command",
      text: story.tests.command,
      label: "the test command",
      cps: 40,
    });
    await arc(ctx.state.testsLoop, "the tests' loop back");
    // The Reviewer and its loop back to the Engineer.
    await cam.hover(card(page, "Reviewer"), "the Reviewer");
    await arc(ctx.state.reviewLoop, "the review loop back");
    // The guardrail: a secret scan, then no edits to servers/.
    await setGate(ctx, ctx.state.scan, story.guardrail.secret_scan.title, "Secret leak scan");
    await setGate(ctx, ctx.state.paths, story.guardrail.forbidden.title, "Forbidden paths", {
      box: "Forbidden paths",
      text: story.guardrail.forbidden.paths[0],
    });
    await cam.hover(page.locator(".rf-terminal--ship").first(), "Ship");
    await cam.hover(page.locator(".rf-terminal--stop").first(), "Stop");
    await cam.pause(1500);
    // P1 after the checks are set; P2's arc labels on the same canvas.
    const set = await gateLabels(page);
    const want = [story.tests.title, story.guardrail.secret_scan.title, story.guardrail.forbidden.title];
    smoke(ctx, "P1 (2.4's gate cards read their titles once set, never a raw kind)",
      want.every((w) => set.includes(w)) && !set.some((l) => RAW_KIND.test(l)), await ctx.shot("p1-gates-set"), set.join(" · "));
    const arcs = (await page.locator(".rf-edge-rework__label").allInnerTexts()).map((t) => t.trim());
    ctx.note(`P2 arcs on 2.4's canvas: ${arcs.join(" · ")}`);
  },
};
