// 6.1 Make this a test from a Reviewer round; add tests from a CSV; an AI check; Check the AI check.
// Live on the newest finished run's Reviewer (V2: the hero run). Running the tests spends (V1's one
// test is 2.7's), so --dry stops before "Run all".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFilmTeam, byRole, graph, must } from "../film.mjs";
import { answerNotifyAsk, composeAndLaunch, openRunAgent, seedRun, smoke, toTheEnd, watchClaude } from "../flows.mjs";

const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "files", "reviewer-tests.csv");
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "out", "v2b", "seed.json");

/**
 * Brief G7: AI checks run on the server's checks model, and this stack has none (the app's own
 * Tests read says `ai.available: false`). The AI-check moments are then answered from sample data
 * over the real responses — the "Included" pill, the AI check's verdict on the round test — and
 * each is listed under `sample` in take.json; everything else in the take is live.
 */
const SAMPLE_REASON =
  "The answer doesn't say which file the zero-lag EMA belongs in (core/indicators.py).";
async function sampleAiChecks(ctx) {
  const { page } = ctx;
  const AI = { available: true, left: 199, limit: 200 };
  await page.route(/\/api\/teams\/[^/]+\/nodes\/[^/]+\/tests\/from-round\?/, async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    if (!body.ai?.available) ctx.sample("New test: the AI check reads Included");
    await route.fulfill({ response: res, json: { ...body, ai: AI } });
  });
  await page.route(/\/api\/teams\/[^/]+\/nodes\/[^/]+\/tests(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const body = await res.json();
    const run = body.run;
    for (const r of run?.status === "done" ? run.results ?? [] : []) {
      const ai = (r.checks ?? []).find((c) => c.kind === "ai" && c.met === null);
      if (!ai) continue;
      ai.met = false;
      ai.reason = SAMPLE_REASON;
      if (r.status === "passed") {
        r.status = "failed";
        run.passed -= 1;
        run.failed += 1;
        if (typeof body.last === "string")
          body.last = body.last.replace(/(\d+) of (\d+) passed/, (_m, a, b) => `${Number(a) - 1} of ${b} passed`);
      }
      ctx.sample(`Results: the AI check on "${r.name}" not met (sample verdict)`);
    }
    await route.fulfill({ response: res, json: { ...body, ai: AI } });
  });
}

export default {
  id: "6.1",
  title: "Make this a test from a Reviewer round; tests from a CSV; an AI check",
  mode: "live",
  budget: 30,
  setup: async ({ api }) => {
    const run = await seedRun(api); // K9: the fresh film team's seed run
    if (run.status !== "completed") throw new Error(`6.1 needs the seed run finished (it is ${run.status})`);
    const reviewer = byRole(await graph(api, run.team), "reviewer").id;
    // A rehearsal (or a failed take) leaves its tests behind; Run all would replay them too.
    const base = `/api/teams/${run.team}/nodes/${reviewer}/tests`;
    for (const t of must(await api("GET", base), "tests").tests ?? []) must(await api("DELETE", `${base}/${t.id}`), "delete test");
    return { team: run.team, run: run.run_id, reviewer };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
    await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
    const tests0 = await ctx.inPage("GET", `/api/teams/${ctx.state.team}/nodes/${ctx.state.reviewer}/tests?desktop_target=1`);
    ctx.note(`G7 probe: the app's Tests read says AI checks available=${tests0.json?.ai?.available}`);
    if (!tests0.json?.ai?.available) await sampleAiChecks(ctx);
    const d = await openRunAgent(ctx, "Reviewer");
    await cam.click(d.getByRole("button", { name: "More for round 1" }).first(), "More for round 1");
    await cam.click(page.getByRole("menuitem", { name: /Make this a test/ }), "Make this a test");
    const nt = page.getByRole("dialog", { name: /^New test from round \d+$/ });
    await nt.waitFor({ timeout: 30000 });
    await cam.roi("new-test", nt);
    await cam.type(nt.getByLabel("Test name"), "Names the indicator file", "the test's name", { clear: true });
    await cam.click(nt.getByRole("button", { name: "Add a check" }), "Add a check");
    await cam.click(page.getByRole("menuitem", { name: /^AI check/ }), "AI check");
    await cam.type(nt.getByRole("textbox", { name: "AI check", exact: true }), "Says which file the indicator belongs in", "the AI check");
    await cam.pause(1200);
    await cam.click(nt.getByRole("button", { name: "Save test" }), "Save test");
    await nt.waitFor({ state: "hidden", timeout: 30000 });
    // Tests from a CSV (the hidden file input, not the macOS panel).
    const tests = page.getByRole("complementary", { name: "Reviewer settings" });
    await tests.waitFor({ timeout: 30000 });
    const input = tests.locator("[data-testid=test-file]").last();
    await input.setInputFiles({ name: "reviewer-tests.csv", mimeType: "text/csv", buffer: fs.readFileSync(CSV) });
    const up = page.getByRole("dialog", { name: "Add tests from a file" });
    await up.waitFor({ timeout: 30000 });
    await cam.roi("upload", up);
    await cam.pause(1500);
    // Tell Tvashtr what the first column is.
    const use = up.getByRole("combobox", { name: /^Use what the reviewer gets as/ });
    await cam.click(use, "what the reviewer gets");
    await use.selectOption({ label: "What the agent gets" });
    await cam.pause(1500);
    await cam.click(up.getByRole("button", { name: /^Add (\d+ )?tests?$/ }), "Add tests");
    await up.waitFor({ state: "hidden", timeout: 30000 });
    const run = tests.getByRole("button", { name: /^Run all \d+$/ });
    await run.waitFor({ timeout: 30000 });
    const n = Number((await run.innerText()).match(/\d+/)[0]);
    const claude = watchClaude(ctx);
    await ctx.spend("test", "Run all", () => cam.click(run, "Run all"), n);
    const t0 = Date.now(); // from the click itself (not the cursor's glide to the button)
    // The live smoke (L1, D8): the running line names its subscription from its first second.
    const head = tests.locator(".tt-head");
    await head.locator(".tt-head__title", { hasText: /^(Running|Waiting to start)/ }).waitFor({ timeout: 60000 });
    const secs = (Date.now() - t0) / 1000;
    const line = (await head.locator(".tt-head__sub").innerText().catch(() => "")).trim();
    smoke(ctx, "6.1 L1/D8 (the running line names its subscription)", /your Claude subscription/.test(line) && !/\$0\.00/.test(line) && secs <= 1.5, await ctx.shot("running"), `${secs.toFixed(1)} s: ${line}`);
    await ctx.offCamera("the Reviewer's tests on Claude", () => tests.getByText(/\d+ of \d+ passed/).first().waitFor({ timeout: 45 * 60000 }));
    const flags = claude();
    smoke(ctx, "S4 (6.1's test replays on Claude)", flags.length > 0 && flags.every((f) => f === "--restricted --safe-mode"), await ctx.shot("results"), flags.join(", ") || "no Claude CLI seen");
    // Only the round test has an AI check; a failed row is open by default, so never toggle it shut.
    const row = tests.getByRole("list", { name: "Tests" }).getByRole("listitem").filter({ hasText: "Names the indicator file" });
    if (await row.filter({ hasText: "Failed" }).count()) {
      const toggle = row.locator(".tt-row__toggle");
      if ((await toggle.getAttribute("aria-expanded")) === "false") await cam.click(toggle, "the round test");
      const wrong = row.getByRole("button", { name: "The AI check is wrong" });
      if (await wrong.count()) {
        await cam.click(wrong, "The AI check is wrong");
        await page.getByRole("dialog", { name: "Check the AI check" }).waitFor();
        await cam.pause(3000);
      }
    } else ctx.note("6.1: the round test shows no failed AI check");
  },
  parts: [
    {
      // V2b second sitting: the P2/P3/P4/P5 smoke on the seed run (an evidence take, not for the film):
      // the check's loop arc and the Reviewer's (P2), the verdict line's reasons (P3), the Reviewer's
      // round row on its Claude subscription (P4), and the one Ask, its answer as markdown (P5).
      key: "evidence",
      title: "Evidence: P2 arcs, P3 verdict line, P4 round row, P5 Ask on the seed run (not for the film)",
      mode: "live",
      setup: async ({ api }) => {
        const run = await seedRun(api);
        if (run.status !== "completed") throw new Error(`the seed run is ${run.status}`);
        return { team: run.team, run: run.run_id };
      },
      before: async (ctx) => {
        await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
        await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
      },
      film: async (ctx) => {
        const { page, cam } = ctx;
        await cam.pause(2500);
        const arcs = (await page.locator(".rf-edge-rework__label").allInnerTexts()).map((t) => t.trim());
        smoke(ctx, "P2 (the Tests check's loop arc reads “tests failed”; the Reviewer's “changes requested”)",
          arcs.includes("tests failed") && arcs.includes("changes requested"), await ctx.shot("p2-arcs"), arcs.join(" · "));
        const verdict = page.locator("li.lv-line").filter({ hasText: "Reviewer" }).filter({ hasText: /Approved/ }).last();
        await verdict.scrollIntoViewIfNeeded().catch(() => {});
        await cam.hover(verdict, "the Reviewer's verdict");
        const said = (await verdict.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        smoke(ctx, "P3 (the verdict line shows the Reviewer's reasons: “Approved — …”)", /Approved — \S/.test(said), await ctx.shot("p3-verdict"), said.slice(0, 200));
        const d = await openRunAgent(ctx, "Reviewer");
        const meta = (await d.getByRole("region", { name: "Last run" }).locator(".nd-round__meta").allInnerTexts()).join(" · ");
        smoke(ctx, "P4 (the Reviewer's round row names its subscription, no $0.0000)", /on your Claude subscription/.test(meta) && !/\$0\.0000/.test(meta), await ctx.shot("p4-round-row"), meta);
        // P5: the one Ask (brief: ≤ 1), on the Reviewer's Claude subscription; its answer as markdown.
        const claude = watchClaude(ctx);
        await cam.click(d.getByRole("button", { name: "Ask", exact: true }), "Ask");
        const q = "In a short bulleted list, what did you check before you approved? Put each file name in backticks.";
        await cam.type(d.getByLabel("Ask this node"), q, "the question");
        ctx.note(`ask: ${q}`);
        await ctx.spend("ask", "Send", () => cam.click(d.getByRole("button", { name: "Send", exact: true }), "Send"));
        const answer = d.locator(".tv-chat__msg--assistant").last();
        await answer.waitFor({ timeout: 10 * 60000 });
        await cam.pause(2500);
        const html = await answer.innerHTML();
        // Literal ** inside a code span is content (a glob like **/test*.py), not unrendered markdown.
        const text = await answer.evaluate((el) => {
          const c = el.cloneNode(true);
          c.querySelectorAll("code").forEach((x) => x.remove());
          return c.textContent;
        });
        const rendered = /<(strong|li|code|pre)\b/.test(html) && !/\*\*/.test(text);
        const askShot = await ctx.shot("p5-ask");
        smoke(ctx, "P5 (the Ask answer renders its markdown)", rendered, askShot, `${(html.match(/<(strong|li|code|pre)\b/g) ?? []).join(" ")}; raw ** ${/\*\*/.test(text) ? "present" : "absent"}`);
        const flags = claude();
        smoke(ctx, "S4 (the Ask on Claude)", flags.length > 0 && flags.every((f) => f === "--restricted --safe-mode"), askShot, flags.join(", ") || "no Claude CLI seen");
      },
    },
    {
      // The P5 evidence shot, no spend: the live Ask's answer (6.1-evidence, the one Ask) sat below the
      // drawer's fold; this replays that exact answer (read from the Desktop job's own result) into the
      // same Ask box and shows it whole. Listed under `sample` in take.json.
      key: "p5",
      title: "Evidence: P5 the live Ask's answer replayed into the Ask box, whole (no spend; not for the film)",
      mode: "live",
      setup: async ({ api }) => {
        const run = await seedRun(api);
        const answer = fs.readFileSync(path.join(path.dirname(SEED), "ask-answer.md"), "utf8").trim();
        return { team: run.team, run: run.run_id, answer };
      },
      before: async (ctx) => {
        await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
        await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
      },
      film: async (ctx) => {
        const { page, cam } = ctx;
        await page.route(/\/api\/runs\/[^/]+\/nodes\/[^/]+\/ask(\?|$)/, (route) => {
          ctx.sample("P5: the Ask's answer is the live one (6.1-evidence), replayed with no spend");
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: ctx.state.answer }) });
        });
        const d = await openRunAgent(ctx, "Reviewer");
        await cam.click(d.getByRole("button", { name: "Ask", exact: true }), "Ask");
        await cam.type(d.getByLabel("Ask this node"), "In a short bulleted list, what did you check before you approved? Put each file name in backticks.", "the question");
        await cam.click(d.getByRole("button", { name: "Send", exact: true }), "Send");
        const answer = d.locator(".tv-chat__msg--assistant").last();
        await answer.waitFor({ timeout: 30000 });
        await answer.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await cam.pause(2000);
        const html = await answer.innerHTML();
        const text = await answer.evaluate((el) => {
          const c = el.cloneNode(true);
          c.querySelectorAll("code").forEach((x) => x.remove());
          return c.textContent;
        });
        const shot = await ctx.shot("p5-ask-replay");
        const whole = path.join(path.dirname(shot), "p5-answer-whole.png");
        await answer.screenshot({ path: whole });
        const counts = ["strong", "li", "code", "pre"].map((t) => `${t}=${(html.match(new RegExp(`<${t}\\b`, "g")) ?? []).length}`).join(" ");
        smoke(ctx, "P5 (the Ask answer renders its markdown)", /<(strong|li|code)\b/.test(html) && !/\*\*/.test(text), whole, `${counts}; ** outside code: ${(text.match(/\*\*/g) ?? []).length}`);
      },
    },
    {
      // K9 (brief m-desk-8-v2b2): chapter 6 works on a fresh "Indicator sprint team" (final, no Query
      // domain step, the Tests check, the Claude Reviewer); the hero team is renamed "… (earlier)" by
      // the builder. Its one seed run gives 6.1 a Reviewer round — off camera, not for the film.
      key: "seed",
      title: "Off camera: the fresh film team's seed run (K9 — not for the film)",
      mode: "live",
      setup: async (ctx) => {
        const built = await buildFilmTeam(ctx.api, { upTo: "final", skipDomain: true });
        ctx.note(`FILM_TEAM: ${built.g.nodes.map((n) => n.config?.title || n.role_name).join(" → ")} reviewer=${byRole(built.g, "reviewer").model} validate ${built.validate.ok === false || built.validate.errors?.length ? JSON.stringify(built.validate) : "ok"}`);
        return { team: built.id, task: ctx.story.runs.seed };
      },
      before: (ctx) => ctx.go(`#/teams/${ctx.state.team}`, ctx.page.getByRole("button", { name: "Run this team", exact: true })),
      film: async (ctx) => {
        const { story } = ctx;
        const run = await composeAndLaunch(ctx, { task: ctx.state.task, repo: story.repo.full_name, folder: story.repo.folder, branch: story.repo.branch });
        fs.mkdirSync(path.dirname(SEED), { recursive: true });
        fs.writeFileSync(SEED, JSON.stringify({ team: ctx.state.team, run, task: ctx.state.task }, null, 2));
        await answerNotifyAsk(ctx, "Not now", { wait: 8000 });
        await toTheEnd(ctx, "the seed run");
        await ctx.shot("seed-done");
      },
    },
  ],
};
