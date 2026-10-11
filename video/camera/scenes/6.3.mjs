// 6.3 Compare v1 and v2 on one task; the results; the task set "Indicators" with hidden checks on
// both versions; lanes take turns on the subscriptions; Restore. V2 (brief G2): the film team's real
// v1 and v2 (6.2 saved v2). The runs take hours: each wait is off camera (a jump cut, its length in
// take.json) while the Desktop stays open — its runner does the work. --dry stops before "Start
// compare". Spends: the one-task compare is 2 runs, the set 2 per task.
import { filmTeam, must } from "../film.mjs";
import { canvasReady } from "../flows.mjs";

const HIDDEN = ["pytest -q tests/test_indicators.py -k vortex", "pytest -q tests/test_indicators.py -k chande"];
const LONG = 4 * 60 * 60000;

/** The compare page from the team's toolbar. */
async function openCompare(ctx) {
  const { page, cam } = ctx;
  await cam.click(page.getByRole("toolbar", { name: "Team" }).getByRole("button", { name: "Compare", exact: true }), "Compare");
  await page.getByRole("heading", { name: "Compare versions" }).waitFor({ timeout: 30000 });
  await cam.pause(1200);
}

/** Versions A and B as the story has them (the page usually picks them already). */
async function pickVersions(ctx) {
  const { page, story } = ctx;
  for (const [name, v] of [["Version A", story.versions.before], ["Version B", story.versions.after]]) {
    const box = page.getByRole("combobox", { name });
    if ((await box.inputValue()) !== String(v)) await box.selectOption(String(v));
  }
}

/** Off camera until the results show, then the results, and Restore when one version did better. */
async function results(ctx, label, shot) {
  const { page, cam } = ctx;
  const table = page.getByRole("table", { name: "Results" });
  await ctx.offCamera(label, () => table.waitFor({ timeout: LONG }));
  await cam.pause(2000);
  await cam.roi(`${shot}-results`, table);
  await ctx.shot(`${shot}-results`);
  await cam.hover(table, "the results");
  await cam.pause(3500);
  const restore = page.getByRole("button", { name: /^Restore v\d+$/ });
  if (await restore.count()) {
    const name = (await restore.innerText()).trim();
    await cam.click(restore, name);
    const dialog = page.getByRole("dialog", { name: /^Restore v\d+\?$/ });
    await dialog.waitFor({ timeout: 15000 });
    await cam.roi("restore", dialog);
    await cam.pause(1500);
    await cam.click(dialog.getByRole("button", { name: /^Restore/ }).last(), "Restore");
    await dialog.waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    ctx.note(`${shot}: restored (${name})`);
    await cam.pause(2500);
  } else {
    ctx.note(`${shot}: no Restore — the current version did as well or better`);
  }
}

export default {
  id: "6.3",
  title: "Compare v1 and v2; results; a task set with hidden checks; Restore",
  mode: "run",
  castEvery: 2,
  budget: 40,
  setup: async (ctx) => {
    const team = await filmTeam(ctx.api);
    const v = must(await ctx.api("GET", `/api/teams/${team}/versions`), "versions");
    if (v.current < ctx.story.versions.after) throw new Error(`the team is at v${v.current}: film 6.2 first`);
    return { team };
  },
  before: async (ctx) => {
    await ctx.go(`#/teams/${ctx.state.team}`);
    await canvasReady(ctx.page);
  },
  film: async (ctx) => {
    const { page, cam, story } = ctx;
    // ---- one task on v1 and v2 ----
    await openCompare(ctx);
    await pickVersions(ctx);
    await cam.type(page.getByRole("textbox", { name: "Task" }), story.runs.compare, "the task");
    await cam.pause(1500);
    await ctx.shot("6.3-start-estimate");
    await ctx.spend(
      "compare",
      "Start compare",
      () => cam.click(page.getByRole("button", { name: "Start compare" }), "Start compare"),
      2,
    );
    await page.getByRole("heading", { name: /^v\d+ and v\d+ on/ }).waitFor({ timeout: 60000 });
    await cam.pause(15000); // the lanes: one works, the other waits its turn on the subscription
    await ctx.shot("6.3-lanes");
    await results(ctx, "the compare runs (both versions, taking turns)", "6.3-compare");
    await cam.click(page.getByRole("button", { name: "Done", exact: true }).last(), "Done").catch(() => {});
    await cam.pause(1500);
    // ---- the task set "Indicators" with hidden checks ----
    if (!(await page.getByRole("heading", { name: "Compare versions" }).count())) await openCompare(ctx);
    await cam.click(page.getByRole("tab", { name: /Task sets/ }), "Task sets");
    await cam.click(page.getByRole("button", { name: "New task set" }).first(), "New task set");
    const sd = page.getByRole("dialog", { name: "New task set" });
    await sd.waitFor();
    await cam.type(sd.getByLabel("Name"), story.task_set.name, "the set's name");
    for (const [i, task] of story.task_set.tasks.entries()) {
      await cam.click(sd.getByRole("button", { name: "Add a task" }), "Add a task");
      await cam.type(sd.getByRole("textbox", { name: "Task", exact: true }).nth(i), task, task);
      await cam.type(sd.getByRole("textbox", { name: "Hidden check" }).nth(i), HIDDEN[i], "a hidden check", { cps: 30 });
    }
    await cam.click(sd.getByRole("button", { name: "Save set" }), "Save set");
    await sd.waitFor({ state: "hidden", timeout: 30000 });
    await cam.pause(1500);
    await cam.click(page.getByRole("tab", { name: /^Compare/ }), "Compare");
    await pickVersions(ctx);
    await cam.click(page.getByRole("radio", { name: "A task set" }), "A task set");
    await page.getByRole("list", { name: `Tasks in ${story.task_set.name}` }).waitFor({ timeout: 30000 });
    await cam.pause(2000);
    await ctx.shot("6.3-set-estimate");
    await ctx.spend(
      "task_set",
      "Start compare (set)",
      () => cam.click(page.getByRole("button", { name: "Start compare" }), "Start compare"),
      2 * story.task_set.tasks.length,
    );
    await page.getByRole("heading", { name: new RegExp(`^v\\d+ and v\\d+ on ${story.task_set.name}`) }).waitFor({ timeout: 60000 });
    await cam.pause(15000);
    await ctx.shot("6.3-set-running");
    // A queued cell: waiting for the other lane's job on the subscription (M-desk-4 H4).
    const queued = page.getByText(/^Waiting for your .+ subscription — one job at a time\.$/).first();
    if (await queued.waitFor({ timeout: 60000 }).then(() => true, () => false)) {
      await cam.hover(queued, "a queued cell");
      await cam.pause(2500);
      await ctx.shot("6.3-set-queued");
    } else ctx.note("6.3: no queued set cell seen in the first minute");
    await results(ctx, "the task set runs (2 tasks × 2 versions)", "6.3-set");
    const cards = page.getByRole("group", { name: "Hidden checks passed" });
    if (await cards.count()) {
      await cam.hover(cards, "the hidden checks");
      await cam.pause(2500);
    }
  },
};
