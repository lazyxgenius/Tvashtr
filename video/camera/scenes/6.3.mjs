// 6.3 Compare v1 and v2 on one task; the results; the task set "Indicators" with hidden checks on
// both versions; lanes take turns on the subscriptions; Restore. V2 (brief G2): the film team's real
// v1 and v2 (6.2 saved v2). The runs take hours: each wait is off camera (a jump cut, its length in
// take.json) while the Desktop stays open — its runner does the work. --dry stops before "Start
// compare". Spends: the one-task compare is 2 runs, the set (part "set", its own take) 2 per task.
// V2b (K7): unattended — compare runs approve their own gates; every lane runs the Tests check.
import { filmTeam, must } from "../film.mjs";
import { canvasReady, smoke } from "../flows.mjs";

// The hidden checks run in a fresh sandbox container: install trade_mcp first (as the Tests check
// does), then the indicator tests, then the indicator itself is there.
const PREP = "pip install -q -e '.[dev]' 'mcp<2' -e servers/kline_cache && python -m pytest -q tests/test_indicators.py";
const HIDDEN = [`${PREP} && grep -qi vortex core/indicators.py`, `${PREP} && grep -qiE 'chande|cmo' core/indicators.py`];
const HOURS = 60 * 60000;

/** H1: the header, the lanes, the results' Cost row and the set's cost cards name the subscriptions,
 *  never "$0.00" ("$0.00 in all" under the results and "About $0.00 on your keys" on the estimates are
 *  the product's own words for the DeepSeek Fixer's keys — listed, not judged). */
async function subscriptionsSmoke(ctx, label, shot) {
  const { page } = ctx;
  const texts = async (sel) => (await page.locator(sel).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const parts = [
    ...(await texts(".cmp-run__meta")),
    ...(await texts(".cmp-lane__meta")),
    ...(await page.getByRole("table", { name: "Results" }).locator("tr", { hasText: /^Cost/ }).allInnerTexts().catch(() => [])),
    ...(await texts(".cmp-set__cell")),
  ];
  const money = parts.filter((t) => /\$0\.00/.test(t));
  const named = parts.filter((t) => /subscription/.test(t));
  const byDesign = (await page.locator("main").innerText()).match(/\$0\.00 in all|About \$0\.00 on your keys/g) ?? [];
  smoke(ctx, `6.3 H1 (${label})`, !money.length && named.length > 0, shot, `${named.length} name a subscription; $0.00 in: ${money.join(" | ") || "none"}; by design: ${[...new Set(byDesign)].join(", ") || "none"}`);
}

/** H5: the estimate's minutes add up the turns — both versions share the Claude and Grok plans, so
 *  every task's work takes turns on them: tasks × (v1's + v2's average finished run), not the longer
 *  one (compare.py _turns; a version with no finished run counts as the other's). */
async function estimateSmoke(ctx, label, shot, tasks) {
  const { page, api, story } = ctx;
  const said = (await page.locator("main").innerText()).match(/about (\d+) min/);
  const runs = (must(await api("GET", `/api/teams/${ctx.state.team}/runs`), "runs").runs ?? []).filter((r) => r.status === "completed");
  const avg = (v) => {
    const xs = runs.filter((r) => r.team_version_number === v).map((r) => (Date.parse(r.updated_at) - Date.parse(r.created_at)) / 1000);
    return xs.length ? xs.reduce((x, y) => x + y) / xs.length : null;
  };
  let [a, b] = [avg(story.versions.before), avg(story.versions.after)];
  a ??= b;
  b ??= a;
  const want = a == null ? null : Math.ceil(Math.max(a, b, tasks * (a + b)) / 60);
  smoke(
    ctx,
    `6.3 H5 (the ${label} estimate adds up the turns)`,
    Boolean(said) && want != null && Number(said[1]) === want,
    shot,
    `on screen “${said?.[0] ?? "no minutes"}”; expected ${want} min = max(${tasks} × (v1 ${(a / 60).toFixed(1)} + v2 ${(b / 60).toFixed(1)} min))`,
  );
}

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

/** Off camera until the results show, then the results, and Restore when one version did better
 *  (only after the set: a Restore makes a new version). */
async function results(ctx, label, shot, { restore: click = true, timeout = 3 * HOURS } = {}) {
  const { page, cam } = ctx;
  const table = page.getByRole("table", { name: "Results" });
  await ctx.offCamera(label, () => table.waitFor({ timeout }));
  await cam.pause(2000);
  await cam.roi(`${shot}-results`, table);
  const resultsShot = await ctx.shot(`${shot}-results`);
  await subscriptionsSmoke(ctx, `${shot} results`, resultsShot);
  await cam.hover(table, "the results");
  await cam.pause(3500);
  const restore = page.getByRole("button", { name: /^Restore v\d+$/ });
  if ((await restore.count()) && !click) {
    await cam.hover(restore, (await restore.innerText()).trim());
    ctx.note(`${shot}: Restore offered, not clicked (one Restore, after the set)`);
  } else if (await restore.count()) {
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

/** The task set "Indicators" with hidden checks on v1 and v2; its results; Restore. */
async function filmSet(ctx) {
  const { page, cam, story } = ctx;
  if (!(await page.getByRole("heading", { name: "Compare versions" }).count())) await openCompare(ctx);
  await cam.click(page.getByRole("tab", { name: /Task sets/ }), "Task sets");
  await cam.click(page.getByRole("button", { name: "New task set" }).first(), "New task set");
  const sd = page.getByRole("dialog", { name: "New task set" });
  await sd.waitFor();
  await cam.type(sd.getByLabel("Name"), story.task_set.name, "the set's name");
  for (const [i, task] of story.task_set.tasks.entries()) {
    await cam.click(sd.getByRole("button", { name: "Add a task" }), "Add a task");
    await cam.type(sd.getByRole("textbox", { name: "Task", exact: true }).nth(i), task, task);
    await cam.type(sd.getByRole("textbox", { name: "Hidden check" }).nth(i), HIDDEN[i], "a hidden check", { cps: 40 });
  }
  await cam.click(sd.getByRole("button", { name: "Save set" }), "Save set");
  await sd.waitFor({ state: "hidden", timeout: 30000 });
  await cam.pause(1500);
  await cam.click(page.getByRole("tab", { name: /^Compare/ }), "Compare");
  await pickVersions(ctx);
  await cam.click(page.getByRole("radio", { name: "A task set" }), "A task set");
  await page.getByRole("list", { name: `Tasks in ${story.task_set.name}` }).waitFor({ timeout: 30000 });
  await cam.pause(2000);
  const estimateShot = await ctx.shot("6.3-set-estimate");
  await estimateSmoke(ctx, "set", estimateShot, story.task_set.tasks.length);
  await ctx.spend(
    "task_set",
    "Start compare (set)",
    () => cam.click(page.getByRole("button", { name: "Start compare" }), "Start compare"),
    2 * story.task_set.tasks.length,
  );
  await page.getByRole("heading", { name: new RegExp(`^v\\d+ and v\\d+ on ${story.task_set.name}`) }).waitFor({ timeout: 60000 });
  await cam.pause(15000);
  const runningShot = await ctx.shot("6.3-set-running");
  await subscriptionsSmoke(ctx, "set running", runningShot);
  // A queued cell: waiting for the other lane's job on the subscription (M-desk-4 H4).
  const queued = page.getByText(/Waiting for your .+ subscription — one job at a time\./).first();
  if (await queued.waitFor({ timeout: 5 * 60000 }).then(() => true, () => false)) {
    await cam.hover(queued, "a queued cell");
    await cam.pause(2500);
    smoke(ctx, "6.3 H4 (a queued set cell)", true, await ctx.shot("6.3-set-queued"), (await queued.innerText()).replace(/\s+/g, " ").trim());
  } else smoke(ctx, "6.3 H4 (a queued set cell)", false, runningShot, "no queued set cell in the first 5 minutes");
  await results(ctx, "the task set runs (2 tasks × 2 versions)", "6.3-set", { timeout: 6 * HOURS });
  const cards = page.getByRole("group", { name: "Hidden checks passed" });
  if (await cards.count()) {
    await cam.hover(cards, "the hidden checks");
    await cam.pause(2500);
    ctx.note(`hidden checks: ${(await cards.innerText()).replace(/\s+/g, " ").trim()}`);
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
    // The Task box starts with the team's newest task: clear it.
    await cam.type(page.getByRole("textbox", { name: "Task" }), story.runs.compare, "the task", { clear: true });
    await cam.pause(1500);
    const estimateShot = await ctx.shot("6.3-start-estimate");
    await estimateSmoke(ctx, "one task", estimateShot, 1);
    await ctx.spend(
      "compare",
      "Start compare",
      () => cam.click(page.getByRole("button", { name: "Start compare" }), "Start compare"),
      2,
    );
    await page.getByRole("heading", { name: /^v\d+ and v\d+ on/ }).waitFor({ timeout: 60000 });
    await cam.pause(15000); // the lanes: one works, the other waits its turn on the subscription
    const lanesShot = await ctx.shot("6.3-lanes");
    await subscriptionsSmoke(ctx, "lanes", lanesShot);
    await results(ctx, "the compare runs (both versions, taking turns)", "6.3-compare", { restore: false });
    await cam.click(page.getByRole("button", { name: "Done", exact: true }).last(), "Done").catch(() => {});
    await cam.pause(1500);
  },
  parts: [
    {
      key: "set",
      title: "The task set Indicators with hidden checks on v1 and v2; Restore",
      setup: async (ctx) => {
        const team = await filmTeam(ctx.api);
        for (const s of must(await ctx.api("GET", `/api/teams/${team}/task-sets`), "task sets").sets ?? [])
          if (s.name === ctx.story.task_set.name) must(await ctx.api("DELETE", `/api/task-sets/${s.id}`), "delete set");
        return { team };
      },
      film: async (ctx) => {
        await openCompare(ctx);
        await filmSet(ctx);
      },
    },
  ],
};
