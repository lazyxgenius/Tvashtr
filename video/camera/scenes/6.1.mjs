// 6.1 Make this a test from a Reviewer round; add tests from a CSV; an AI check; Check the AI check.
// Live on the newest finished run's Reviewer (V2: the hero run). Running the tests spends (V1's one
// test is 2.7's), so --dry stops before "Run all".
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { latestRun, openRunAgent } from "../flows.mjs";

const CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "files", "reviewer-tests.csv");

export default {
  id: "6.1",
  title: "Make this a test from a Reviewer round; tests from a CSV; an AI check",
  mode: "live",
  budget: 30,
  setup: async ({ api }) => {
    const run = await latestRun(api, "completed");
    if (!run) throw new Error("6.1 needs a finished run with a Reviewer round (V2: the hero run)");
    return { team: run.library_team_id ?? run.team?.id, run: run.run_id };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}/runs/${ctx.state.run}`);
    await ctx.page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  },
  film: async (ctx) => {
    const { page, cam } = ctx;
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
    await ctx.spend("test", "Run all", () => cam.click(run, "Run all"));
    await tests.getByText(/\d+ of \d+ passed/).first().waitFor({ timeout: 15 * 60000 });
    const failed = tests.getByRole("list", { name: "Tests" }).getByRole("listitem").filter({ hasText: "Failed" }).first();
    if (await failed.count()) {
      await cam.click(failed, "a failed test");
      const wrong = tests.getByRole("button", { name: "The AI check is wrong" });
      if (await wrong.count()) {
        await cam.click(wrong, "The AI check is wrong");
        await page.getByRole("dialog", { name: "Check the AI check" }).waitFor();
        await cam.pause(3000);
      }
    }
  },
};
