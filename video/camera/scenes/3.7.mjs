// 3.7 The Changes tab; one Ask of the Reviewer (a real Ask on its Grok sign-in) — V2b: about the Tests
// failure or the round it sent back if there was one, else what it checked (K4); cost per round;
// Memory: confirm one fact, reject one. Live on the hero run.
import { must, teams } from "../film.mjs";
import { heroRun, openRunAgent, smoke, watchGrok } from "../flows.mjs";

/** The Reviewer's Changes, its cost per round, and the one Ask on its Grok sign-in (S4 smoke). */
async function changesAndAsk(ctx, d, question) {
  const { cam } = ctx;
  await cam.click(d.getByRole("button", { name: "Changes", exact: true }), "Changes");
  const rows = d.locator(".tv-diff__row");
  await rows.first().waitFor({ timeout: 30000 }).catch(() => {});
  if (await rows.count()) await rows.last().scrollIntoViewIfNeeded(); // V2: the list sat below the fold
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
  await cam.type(d.getByLabel("Ask this node"), question, "the question");
  ctx.note(`ask: ${question}`);
  const grok = ctx.app ? watchGrok(ctx) : () => [];
  await ctx.spend("ask", "Send", () => cam.click(d.getByRole("button", { name: "Send", exact: true }), "Send"));
  // The answer, or the Ask's error (a failed Desktop job — e.g. a usage limit — never adds an answer).
  const answer = d.locator(".tv-chat__msg--assistant").or(d.locator(".tv-chat__error")).last();
  await answer.waitFor({ timeout: 10 * 60000 });
  const flags = grok();
  await cam.pause(4000);
  const askShot = await ctx.shot("ask");
  smoke(ctx, "S4 (3.7's Ask on Grok)", flags.length > 0 && flags.every((f) => /^tvashtr-j[0-9a-f]{6}$/.test(f)), askShot, flags.join(", ") || "no Grok CLI seen");
  return answer;
}

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
    const { cam } = ctx;
    const d = await openRunAgent(ctx, "Reviewer");
    await changesAndAsk(ctx, d, ctx.state.ask);
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
  parts: [
    {
      // V3 (brief video-v3 D3): Changes + the Ask re-shot on 0.27.0 — P4 (the round row names the
      // subscription) and P5 (the answer renders its markdown). The Memory beat stays V2b's take (its
      // memories were kept/discarded there). If Grok answers with a usage limit, V2b's Ask stays.
      key: "ask",
      title: "Changes; ask the Reviewer (Grok); cost per round — on 0.27.0 (Memory stays V2b's)",
      setup: async ({ api, story }) => {
        const run = await heroRun(api);
        if (!run) throw new Error("3.7 needs the hero run");
        // Continuity with 3.2–3.6 (the recording's plain name): the hero team (renamed "(earlier)" by
        // V2b's K9) shows the plain name for this take — renamed off camera, restored after the film.
        const name = (await teams(api)).find((t) => t.team_graph_id === run.team)?.name;
        if (name && name !== story.team.name) must(await api("PATCH", `/api/teams/${run.team}`, { name: story.team.name }), "rename the hero team");
        return {
          team: run.team,
          run: run.run_id,
          restoreName: name !== story.team.name ? name : null,
          // K4: the hero's first build failed Tvashtr's tests; a list shows the answer's markdown (P5).
          ask: "Tvashtr's tests failed on the first build. What did you check once they passed? Answer in a short bulleted list.",
        };
      },
      film: async (ctx) => {
        try {
          await askFilm(ctx);
        } finally {
          if (ctx.state.restoreName)
            must(await ctx.api("PATCH", `/api/teams/${ctx.state.team}`, { name: ctx.state.restoreName }), "restore the hero team's name");
        }
      },
    },
  ],
};

/** 3.7-ask on camera: P4 on the round row, Changes, the Ask (S4), P5 on its answer. */
async function askFilm(ctx) {
  const d = await openRunAgent(ctx, "Reviewer");
  const meta = (await d.getByRole("region", { name: "Last run" }).locator(".nd-round__meta").allInnerTexts()).join(" · ");
  smoke(ctx, "P4 (3.7: the Reviewer's round row names its subscription, no $0.0000)",
    /on your Grok subscription/.test(meta) && !/\$0\.0000/.test(meta), await ctx.shot("p4-round-row"), meta);
  const answer = await changesAndAsk(ctx, d, ctx.state.ask);
  await answer.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await ctx.cam.pause(3000);
  const html = await answer.innerHTML();
  // Literal ** inside a code span is content (a glob like **/test*.py), not unrendered markdown.
  const text = await answer.evaluate((el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll("code").forEach((x) => x.remove());
    return c.textContent;
  });
  const shot = await ctx.shot("p5-ask");
  const whole = shot.replace(/p5-ask\.png$/, "p5-answer-whole.png");
  await answer.screenshot({ path: whole });
  if (/usage limit/i.test(text) || (await answer.evaluate((el) => el.classList.contains("tv-chat__error")))) {
    ctx.note("GROK_CAP: the Ask answered with a usage limit — V2b's 3.7 Ask stays (brief D3)");
    console.log(`GROK_CAP: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
    return;
  }
  const counts = ["strong", "li", "code", "pre"].map((t) => `${t}=${(html.match(new RegExp(`<${t}\\b`, "g")) ?? []).length}`).join(" ");
  smoke(ctx, "P5 (3.7: the Ask answer renders its markdown)", /<(strong|li|code|pre)\b/.test(html) && !/\*\*/.test(text), whole, `${counts}; ** outside code: ${(text.match(/\*\*/g) ?? []).length}`);
  ctx.note(`answer: ${text.replace(/\s+/g, " ").slice(0, 1500)}`);
}
