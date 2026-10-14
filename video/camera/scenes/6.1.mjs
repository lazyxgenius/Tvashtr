// 6.1 Make this a test from a Reviewer round; add tests from a CSV; an AI check; Check the AI check.
// Live on the newest finished run's Reviewer (V2: the hero run). Running the tests spends (V1's one
// test is 2.7's), so --dry stops before "Run all".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { byRole, graph, must } from "../film.mjs";
import { heroRun, openRunAgent, smoke, watchGrok } from "../flows.mjs";

const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "files", "reviewer-tests.csv");

/**
 * Brief G7: AI checks run on the server's checks model, and this stack has none (the app's own
 * Tests read says `ai.available: false`). The AI-check moments are then answered from sample data
 * over the real responses — the "Included" pill, the AI check's verdict on the round test — and
 * each is listed under `sample` in take.json; everything else in the take is live.
 */
const SAMPLE_REASON =
  "The answer doesn't say which file the Hull moving average belongs in (core/indicators.py).";
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
    const run = await heroRun(api);
    if (!run) throw new Error("6.1 needs a finished run with a Reviewer round (V2: the hero run)");
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
    const grok = watchGrok(ctx);
    await ctx.spend("test", "Run all", () => cam.click(run, "Run all"), n);
    const t0 = Date.now(); // from the click itself (not the cursor's glide to the button)
    // The live smoke (L1, D8): the running line names its subscription from its first second.
    const head = tests.locator(".tt-head");
    await head.locator(".tt-head__title", { hasText: /^(Running|Waiting to start)/ }).waitFor({ timeout: 60000 });
    const secs = (Date.now() - t0) / 1000;
    const line = (await head.locator(".tt-head__sub").innerText().catch(() => "")).trim();
    smoke(ctx, "6.1 L1/D8 (the running line names its subscription)", /subscription/.test(line) && !/\$0\.00/.test(line) && secs <= 1.5, await ctx.shot("running"), `${secs.toFixed(1)} s: ${line}`);
    await ctx.offCamera("the Reviewer's tests on Grok", () => tests.getByText(/\d+ of \d+ passed/).first().waitFor({ timeout: 45 * 60000 }));
    const flags = grok();
    smoke(ctx, "S4 (6.1's test replays on Grok)", flags.length > 0 && flags.every((f) => /^tvashtr-j[0-9a-f]{6}$/.test(f)), await ctx.shot("results"), flags.join(", ") || "no Grok CLI seen");
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
};
