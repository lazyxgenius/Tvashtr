// 2.7 Tidy; group the loop; the header shows v1; Test this agent on the Reviewer (a real replay on
// its Grok subscription — V1's one test, last so a --dry rehearsal covers the rest).
import { buildFilmTeam, byRole, graph, must } from "../film.mjs";
import { canvasReady, card, openAgent } from "../flows.mjs";

const CSV = [
  "what the reviewer gets,must say",
  '"The Engineer added hull_moving_average(values, length) to core/indicators.py, registered it on INDICATORS, and added two tests to tests/test_indicators.py. All 41 tests pass. Review the change against the spec: add a Hull moving average indicator.","indicators"',
].join("\n");

export default {
  id: "2.7",
  title: "Test this agent on the Reviewer; Tidy; group the loop; v1",
  mode: "live",
  budget: 30,
  setup: async ({ api }) => {
    const { id } = await buildFilmTeam(api, { upTo: "fixer" });
    const g = await graph(api, id);
    const rev = byRole(g, "reviewer");
    const base = `/api/teams/${id}/nodes/${rev.id}/tests/file`;
    const mapping = { "what the reviewer gets": "gets", "must say": "must_say" };
    must(await api("POST", `${base}/check`, { filename: "reviewer-tests.csv", content: CSV, mapping }), "tests check");
    must(await api("POST", base, { filename: "reviewer-tests.csv", content: CSV, mapping }), "tests upload");
    return { team: id, reviewer: rev.id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    const chip = page.getByRole("button", { name: "Version history" });
    // Tidy, then group the Engineer ⇄ Reviewer loop (layout changes: the header stays v1).
    const arrange = page.getByRole("toolbar", { name: "Arrange" });
    await cam.click(arrange.getByRole("button", { name: "Tidy" }), "Tidy");
    await cam.pause(2500);
    const e = await card(page, "Engineer").boundingBox();
    const r = await card(page, "Reviewer").boundingBox();
    await page.keyboard.down("Shift");
    await cam.glide(Math.min(e.x, r.x) - 14, Math.min(e.y, r.y) - 14);
    await page.mouse.down();
    await cam.glide(Math.max(e.x + e.width, r.x + r.width) + 14, Math.max(e.y + e.height, r.y + r.height) + 14, "select the loop");
    await page.mouse.up();
    await page.keyboard.up("Shift");
    await cam.click(arrange.getByRole("button", { name: "Group" }), "Group");
    const label = page.getByRole("textbox", { name: "Group name" });
    await cam.type(label, story.loop.group, "Review loop", { click: false, clear: true });
    await cam.press("Enter");
    await cam.pause(1500);
    // Clear the selection (its rectangle would take the next click).
    await cam.press("Escape");
    await cam.clickAt(560, 840, "the empty canvas");
    await cam.hover(chip, "the header: v1");
    await cam.pause(1500);
    // Test this agent: a real replay of the Reviewer on its Grok subscription (V1's one test).
    const d = await openAgent(ctx, "Reviewer");
    await cam.click(d.getByRole("button", { name: "More actions" }), "More actions");
    await cam.click(page.getByRole("menuitem", { name: /^Test this agent/ }), "Test this agent");
    const run = d.getByRole("button", { name: /^Run all \d+$/ });
    await run.waitFor({ timeout: 30000 });
    await cam.roi("tests", d);
    await cam.pause(1200);
    await ctx.spend("test", "Run all 1", () => cam.click(run, "Run all 1"));
    await d.getByText(/\d+ of \d+ passed/).first().waitFor({ timeout: 12 * 60000 });
    await cam.pause(3000);
  },
};
