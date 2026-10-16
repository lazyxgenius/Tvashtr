// 6.2 Edit the Reviewer → "N changes since v1" → Save as v2 → save and run its tests → the results
// in History → What changed in v2. V2 (brief G2): LIVE on the film team — chapter 2 ends at v1,
// nothing else saves a version, so this edit is the next real version (the V1 sample of v7/v8 is
// retired). The tests are the 4 6.1 made on the Reviewer; running them spends one replay each.
import { byRole, filmTeam, graph, must } from "../film.mjs";
import { canvasReady, card, closeDrawer, openAgent, saveDrawer, smoke, watchClaude } from "../flows.mjs";

/** 6.2's edit: one line added to the Reviewer's instructions, and a backup model. */
export const LINE =
  "- In the reasons, name the file and line of each problem (for example core/indicators.py:118).";
export const NOTE = "Reviewer names the file and line of each problem";

/** History → the new version's test pills → What changed in it → Close. */
async function history(ctx, { before, after, tests }) {
  const { page, cam } = ctx;
  await cam.click(page.getByRole("button", { name: "Version history" }), "Version history");
  const panel = page.getByRole("complementary", { name: "History" });
  const row = panel.getByRole("listitem").filter({ hasText: `v${after}` }).first();
  const pill = row.locator(".cv-tpill");
  await pill.waitFor({ timeout: tests });
  await cam.roi("history", panel);
  await cam.pause(1300);
  await cam.hover(pill, `v${after}'s tests`);
  await cam.pause(1000);
  const prev = panel.getByRole("listitem").filter({ hasText: `v${before}` }).first().locator(".cv-tpill");
  if (await prev.count()) {
    await cam.hover(prev, `v${before}'s tests`);
    await cam.pause(900);
  }
  await cam.click(row.getByRole("button", { name: `What changed in v${after}` }), `What changed in v${after}`);
  const dialog = page.getByRole("dialog", { name: `What changed in v${after}` });
  await dialog.getByText(new RegExp(`^Compared with v${before}`)).waitFor({ timeout: 30000 });
  await cam.roi("what-changed", dialog);
  await cam.pause(900);
  await cam.hover(dialog.getByRole("region", { name: "Reviewer › Instructions" }), "the instructions diff");
  await cam.pause(1600);
  const backup = dialog.getByRole("region", { name: "Reviewer › Backup model" });
  if (await backup.count()) {
    await cam.hover(backup, "the backup model");
    await cam.pause(1200);
  }
  await cam.click(dialog.getByRole("button", { name: "Close", exact: true }).last(), "Close");
  await cam.pause(1000);
}

export default {
  id: "6.2",
  title: "Edit the Reviewer; changes since v1; Save as v2; save and run the tests; History; What changed",
  mode: "run",
  castEvery: 2,
  budget: 40,
  setup: async (ctx) => {
    const { api, story } = ctx;
    const team = await filmTeam(api);
    const versions = must(await api("GET", `/api/teams/${team}/versions`), "versions");
    if (versions.current !== story.versions.before)
      ctx.note(`the team is at v${versions.current}, not v${story.versions.before} (story.json)`);
    // A rehearsal's saved edit would be saved as a version at the next launch; a task set would make
    // "Save and run tests" start a set compare too (4 runs the ledger doesn't count).
    if (versions.changes)
      throw new Error(`6.2: ${versions.changes} unsaved change(s) since v${versions.current} (a rehearsal's edit?) — put the Reviewer back first`);
    if (versions.check_sets?.length) throw new Error("6.2: a task set exists — Save as v2 would also start a set compare");
    const rev = byRole(await graph(api, team), "reviewer");
    const tests = must(await api("GET", `/api/teams/${team}/nodes/${rev.id}/tests`), "tests").tests.length;
    if (!tests) throw new Error("6.2 needs the Reviewer's tests: film 6.1 first");
    return { team, reviewer: rev.id, before: versions.current, after: versions.current + 1, tests };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    const { before, after, tests } = ctx.state;
    const chip = page.getByRole("button", { name: "Version history" });
    await chip.filter({ hasText: `v${before}` }).waitFor({ timeout: 30000 });
    await cam.roi("chip", chip);
    await cam.hover(chip, `v${before} · saved`);
    await cam.pause(1000);
    const d = await openAgent(ctx, "Reviewer");
    // One line at the end of the instructions.
    const more = d.getByRole("button", { name: /^Show all \d+ lines$/ });
    if (await more.count()) await cam.click(more, "Show all lines");
    const text = d.getByRole("textbox", { name: /^Instructions/ });
    await cam.click(text, "the instructions", { park: false });
    await text.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
    await cam.type(text, `\n${LINE}`, "one line", { click: false });
    await cam.pause(800);
    // A backup model (Advanced), as 2.5 gave the Engineer.
    await cam.click(d.getByRole("button", { name: /^Advanced/ }), "Advanced");
    await cam.click(d.getByRole("button", { name: /^Backup model/ }).first(), "Backup model");
    const bk = page.getByRole("dialog", { name: "Choose a backup model" });
    await bk.waitFor();
    await cam.click(bk.getByRole("group", { name: /^deepseek\b/ }).getByRole("option").first(), story.backup_model);
    await cam.pause(600);
    await saveDrawer(ctx, d);
    await closeDrawer(ctx);
    await chip.filter({ hasText: new RegExp(`\\d+ changes? since v${before}`) }).waitFor({ timeout: 15000 });
    ctx.note(`chip: ${(await chip.innerText()).replace(/\s+/g, " ").trim()}`);
    await cam.hover(chip, `changes since v${before}`);
    await cam.pause(1500);
    await cam.click(page.getByRole("button", { name: `Save as v${after}` }), `Save as v${after}`);
    const dialog = page.getByRole("dialog", { name: `Save as v${after}` });
    await dialog.waitFor({ timeout: 15000 });
    await cam.roi(`save-as-v${after}`, dialog);
    await cam.type(dialog.getByLabel("What changed (optional)"), NOTE, "the note");
    await cam.hover(
      dialog.getByRole("radio", { name: new RegExp(`^Save and run the Reviewer’s ${tests} tests?`) }),
      "Save and run the Reviewer's tests",
    );
    await cam.pause(1500);
    const claude = ctx.app ? watchClaude(ctx) : () => [];
    await ctx.spend(
      "save_with_tests",
      "Save and run tests",
      () => cam.click(dialog.getByRole("button", { name: "Save and run tests" }), "Save and run tests"),
      tests,
    );
    const t0 = Date.now(); // from the click itself (not the cursor's glide to the button)
    // The live smoke (L1, D8): from its first second the running tests name their subscription (the
    // app's own Tests read, as the Reviewer's Tests tab shows it).
    const first = await ctx.inPage("GET", `/api/teams/${ctx.state.team}/nodes/${ctx.state.reviewer}/tests?desktop_target=1`);
    const secs = (Date.now() - t0) / 1000;
    const runOn = JSON.stringify(first.json?.run?.ran_on ?? null);
    const said = [first.json?.last, ...(first.json?.run?.results ?? []).map((r) => r.waiting)].filter(Boolean).join(" · ");
    ctx.note(`first second: v${first.json?.run?.version ?? "?"} ran_on=${runOn}; ${said}`);
    await chip.filter({ hasText: `v${after}` }).waitFor({ timeout: 30000 });
    // The Reviewer's card counts the tests as they run on the Claude subscription.
    const rev = card(page, "Reviewer");
    await rev.locator(".rf-node__tests--live").waitFor({ timeout: 60000 }).catch(() => {});
    await cam.roi("testing", rev);
    const testingShot = await ctx.shot("testing");
    smoke(
      ctx,
      "6.2 L1/D8 (the running tests name their subscription)",
      secs <= 1.5 && (/subscription/.test(said) || /"subscriptions":\["claude"\]/.test(runOn)) && !/\$0\.00/.test(said),
      testingShot,
      `${secs.toFixed(1)} s: ran_on ${runOn}; ${said}`,
    );
    await cam.hover(rev, "the Reviewer testing");
    await cam.pause(2500);
    await ctx.offCamera("the Reviewer's tests on Claude", () =>
      rev.locator(".rf-node__tests", { hasText: /^\d+ of \d+ tests?$/ }).waitFor({ timeout: 45 * 60000 }),
    );
    const flags = claude();
    smoke(ctx, "S4 (6.2's test replays on Claude)", flags.length > 0 && flags.every((f) => f === "--restricted --safe-mode"), await ctx.shot("tested"), flags.join(", ") || "no Claude CLI seen");
    await cam.pause(1500);
    await history(ctx, { before, after, tests: 60000 });
  },
};
