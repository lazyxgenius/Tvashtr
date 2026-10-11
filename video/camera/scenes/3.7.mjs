// 3.7 The Changes tab; ask the Reviewer "why did you reject round 1?" (a real Ask on its Grok
// sign-in); cost per round; Memory: confirm one fact, reject one. Live on the newest finished run
// (V2: the hero run; V1 rehearses on the proof run and stops before the Ask).
import { must } from "../film.mjs";
import { heroRun, openRunAgent } from "../flows.mjs";

export default {
  id: "3.7",
  title: "Changes; ask the Reviewer why; cost per round; Memory: confirm one, reject one",
  mode: "live",
  budget: 30,
  setup: async ({ api }) => {
    const run = await heroRun(api);
    if (!run) throw new Error("3.7 needs a finished run (V2: the hero run)");
    // New memories wait for review, so one can be confirmed and one rejected on camera.
    must(await api("PATCH", "/api/memory/review-mode", { review_mode: true }), "memory review mode");
    return { team: run.team, run: run.run_id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
    await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const d = await openRunAgent(ctx, "Reviewer");
    await cam.click(d.getByRole("button", { name: "Changes", exact: true }), "Changes");
    await cam.pause(2500);
    await ctx.shot("changes"); // the live smoke (L3): after Done, Tvashtr's copy of the repo is gone
    const rows = d.locator(".tv-diff__row");
    if (await rows.count()) await cam.click(rows.first(), "the changed file");
    await cam.pause(2000);
    // Cost per round: the round ledger under the last run.
    const ledger = d.locator(".nd-round__meta").first();
    if (await ledger.count()) await cam.hover(ledger, "cost per round");
    await cam.pause(1500);
    // Ask the Reviewer.
    await cam.click(d.getByRole("button", { name: "Ask", exact: true }), "Ask");
    await cam.type(d.getByLabel("Ask this node"), "Why did you reject round 1?", "the question");
    await ctx.spend("ask", "Send", () => cam.click(d.getByRole("button", { name: "Send", exact: true }), "Send"));
    await d.locator(".tv-chat__msg--assistant").last().waitFor({ timeout: 10 * 60000 });
    await cam.pause(4000);
    await ctx.shot("ask");
    // Memory: keep one, discard one — on the Engineer, the agent that learned them (V2: the
    // Reviewer learned nothing in the hero run).
    const e = await openRunAgent(ctx, "Engineer");
    await cam.click(e.getByRole("tab", { name: /^Memory/ }), "Memory");
    const learned = e.locator("section[aria-label='Learned this run']");
    await learned.waitFor({ timeout: 15000 });
    await cam.click(learned.getByRole("button", { name: /^Keep / }).first(), "Keep");
    await cam.click(learned.getByRole("button", { name: /^Discard / }).first(), "Discard");
    await cam.pause(2000);
    await ctx.shot("memory");
  },
};
