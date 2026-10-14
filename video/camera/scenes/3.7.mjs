// 3.7 The Changes tab; one Ask of the Reviewer (a real Ask on its Grok sign-in) — V2b: about the Tests
// failure or the round it sent back if there was one, else what it checked (K4); cost per round;
// Memory: confirm one fact, reject one. Live on the hero run.
import { must } from "../film.mjs";
import { heroRun, openRunAgent, smoke, watchGrok } from "../flows.mjs";

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
    // K4: the Ask follows what really happened — Tvashtr's tests failing, else a round the Reviewer
    // sent back, else what it checked. (The Reviewer only ever saw the passing check's line.)
    const lines = (await api("GET", `/api/runs/${run.run_id}/activity?desktop_target=1`)).json?.lines ?? [];
    const failed = lines.some((l) => l.kind === "check" && l.refs?.result === "failed");
    const back = lines.find((l) => l.kind === "verdict" && /^Asked for/.test(l.text ?? ""));
    const ask = failed
      ? "Tvashtr's tests failed on the first build. What did you check once they passed?"
      : back
        ? `Why did you ask for changes in round ${back.iteration ?? 1}?`
        : "What did you check before you approved it?";
    return { team: run.team, run: run.run_id, ask };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
    await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const d = await openRunAgent(ctx, "Reviewer");
    await cam.click(d.getByRole("button", { name: "Changes", exact: true }), "Changes");
    const rows = d.locator(".tv-diff__row");
    await rows.first().waitFor({ timeout: 30000 }).catch(() => {});
    if (await rows.count()) await rows.first().scrollIntoViewIfNeeded(); // V2: the list sat below the fold
    await cam.pause(2500);
    await ctx.shot("changes"); // the live smoke (L3): after Done, Tvashtr's copy of the repo is gone
    if (await rows.count()) await cam.click(rows.first(), "the changed file");
    await cam.pause(2000);
    // Cost per round: the round ledger under the last run.
    const ledger = d.locator(".nd-round__meta").first();
    if (await ledger.count()) await cam.hover(ledger, "cost per round");
    await cam.pause(1500);
    // Ask the Reviewer.
    await cam.click(d.getByRole("button", { name: "Ask", exact: true }), "Ask");
    await cam.type(d.getByLabel("Ask this node"), ctx.state.ask, "the question");
    ctx.note(`ask: ${ctx.state.ask}`);
    const grok = ctx.app ? watchGrok(ctx) : () => [];
    await ctx.spend("ask", "Send", () => cam.click(d.getByRole("button", { name: "Send", exact: true }), "Send"));
    await d.locator(".tv-chat__msg--assistant").last().waitFor({ timeout: 10 * 60000 });
    const flags = grok();
    await cam.pause(4000);
    const askShot = await ctx.shot("ask");
    smoke(ctx, "S4 (3.7's Ask on Grok)", flags.length > 0 && flags.every((f) => /^tvashtr-j[0-9a-f]{6}$/.test(f)), askShot, flags.join(", ") || "no Grok CLI seen");
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
