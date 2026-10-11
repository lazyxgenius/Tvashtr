/**
 * On-camera flows shared by the run scenes (chapters 3–6): every click goes through the cursor
 * (cam), every subscription spend through ctx.spend (a --dry rehearsal stops there), every step
 * inside a paid run through ctx.advance. Selectors follow frontend/e2e and video/SCENES.md.
 */
import { sleep } from "./desktop.mjs";

export const nowBar = (page) => page.getByRole("region", { name: "Now" });
export const activity = (page) => page.getByRole("region", { name: "Activity" });
export const summary = (page) => page.getByRole("region", { name: "Run summary" });

/** The ids a scene works on: from a recording when replaying, else from its setup. */
export const ids = (ctx) => ({
  team: ctx.recorded?.team ?? ctx.state.team,
  run: ctx.recorded?.run ?? ctx.state.run,
  task: ctx.recorded?.task ?? ctx.state.task,
});

/**
 * "Run this team" on the canvas → Home's composer → the task → the repo → (Options: branch,
 * folder) → Launch (a spend). Returns the new run's id (null if --dry stopped first).
 */
export async function composeAndLaunch(ctx, { task, repo, folder = null, branch = null }) {
  const { page, cam } = ctx;
  await cam.click(page.getByRole("button", { name: "Run this team", exact: true }), "Run this team");
  const composer = page.locator("section[aria-label='Start a run']");
  const ready = page.locator("section.dt-ready__card");
  await composer.or(ready).first().waitFor({ timeout: 30000 });
  if (await ready.count()) {
    // An account with no runs yet: Desktop Home's ready card takes the task, then hands it to the
    // composer ("Decide when I launch a run").
    await cam.roi("ready-card", ready);
    await cam.type(ready.getByRole("textbox"), task, "the task", { cps: 22 });
    await cam.click(ready.getByRole("button", { name: "Launch", exact: true }), "Launch (ready card)");
    await composer.waitFor({ timeout: 30000 });
    await cam.roi("composer", composer);
  } else {
    await cam.roi("composer", composer);
    const box = composer.getByRole("textbox", { name: "What should the team build?" });
    await cam.type(box, task, "the task", { cps: 22 });
    await page.keyboard.press("Escape").catch(() => {}); // close Recent tasks
  }
  await cam.click(composer.locator(".hm-picker--repo"), "the repo picker");
  const pop = page.getByRole("dialog", { name: /^Pick a (repo|folder)$/ });
  await pop.waitFor({ timeout: 30000 });
  const option = pop
    .getByRole("listbox", { name: /^(Repos|Folders)$/ })
    .locator("[role='option']", { has: page.locator(".hm-picker__code", { hasText: new RegExp(`^${repo}$`) }) });
  await option.waitFor({ timeout: 60000 });
  await cam.click(option, repo);
  await composer.locator(".hm-picker--repo", { hasText: repo.split("/")[1] }).waitFor({ timeout: 30000 });
  if (folder || branch) {
    await cam.click(composer.getByRole("button", { name: "Options", exact: true }), "Options");
    const opts = page.getByRole("dialog", { name: "Run options" });
    await opts.waitFor();
    if (branch) await cam.type(opts.getByLabel("Base branch"), branch, "base branch", { clear: true });
    if (folder) {
      await cam.click(opts.getByLabel("Scope"), "Scope");
      await opts.getByLabel("Scope").selectOption(folder);
      cam.mark(`folder ${folder}/`);
    }
    await cam.roi("options", opts);
    await cam.pause(1200);
    await page.keyboard.press("Escape");
  }
  await cam.pause(600);
  const launch = composer.getByRole("button", { name: "Launch", exact: true });
  return ctx.spend("run", "Launch", async () => {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/runs") && r.request().method() === "POST", {
        timeout: 120000,
      }),
      cam.click(launch, "Launch"),
    ]);
    const body = await res.json().catch(() => ({}));
    const open = page.getByRole("status").filter({ hasText: "Run started on" }).getByRole("button", { name: "Open run" });
    await open.waitFor({ timeout: 30000 });
    await cam.click(open, "Open run");
    await nowBar(page).waitFor({ timeout: 60000 });
    return body.run_id ?? null;
  });
}

/** Answer the run view's notifications ask, if it opened (F9: "Not now" unless the scene shows it). */
export async function answerNotifyAsk(ctx, choice = "Not now", { wait = 6000 } = {}) {
  const { page, cam } = ctx;
  const ask = page.getByRole("dialog", { name: "Notifications" });
  try {
    await ask.waitFor({ timeout: wait });
  } catch {
    return false;
  }
  await cam.roi("notify-ask", ask);
  await cam.pause(1800);
  await cam.click(ask.getByRole("button", { name: choice, exact: true }), choice);
  return true;
}

/** Pair moments every `every` ms until `until()` holds (or the timeout). */
export async function watch(ctx, until, { every = 20000, timeout = 30 * 60000, label = "watch" } = {}) {
  const end = Date.now() + timeout;
  let next = Date.now() + every;
  while (Date.now() < end) {
    if (await until()) return true;
    if (Date.now() >= next && ctx.mode === "record") {
      await ctx.pair(label);
      next = Date.now() + every;
    }
    await sleep(1000);
  }
  throw new Error(`timed out: ${label}`);
}

export const gateWaiting = (page) =>
  page.locator(".react-flow__node .rf-gate--awaiting").first();

/** 3.3: the waiting spec gate → its drawer → one line edited → "Approve with my edits". */
export async function editAndApproveSpec(ctx, line) {
  const { page, cam } = ctx;
  await cam.click(gateWaiting(page), "the waiting spec gate");
  const drawer = page.getByRole("complementary", { name: /^Spec v\d+$/ });
  await drawer.waitFor({ timeout: 30000 });
  await cam.roi("spec", drawer);
  await cam.pause(1500);
  const editor = drawer.locator(".dv-editor .ProseMirror");
  await editor.waitFor();
  const last = editor.locator("p, li").last();
  await cam.click(last, "the spec's last line", { park: false });
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await cam.type(editor, line, "one line", { click: false });
  await drawer.getByText(/^\d+ edits?$/).waitFor({ timeout: 15000 });
  await cam.pause(900);
  await ctx.advance("Approve with my edits", () =>
    cam.click(drawer.getByRole("button", { name: "Approve with my edits" }), "Approve with my edits"),
  );
}

/** The run ended: the summary shows (shipped) or a failed callout does. */
export const runEnded = async (page) =>
  (await summary(page).count()) > 0 ||
  (await page.locator(".lv-pin__box").filter({ hasText: /failed|Failed/ }).count()) > 0;

// ---- the canvas (chapter 2) ------------------------------------------------------------------

export const card = (page, title) =>
  page.locator(".react-flow__node").filter({ has: page.locator(".rf-node__role", { hasText: new RegExp(`^${title}$`) }) });
export const gateCard = (page, label) =>
  page.locator(".react-flow__node").filter({ has: page.locator(".rf-gate__label", { hasText: label }) });

/** Wait for the canvas to draw its cards. */
export async function canvasReady(page) {
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await sleep(600);
}

/** Click an agent's card; returns its settings drawer. */
export async function openAgent(ctx, title, { label } = {}) {
  const { page, cam } = ctx;
  await cam.click(card(page, title).locator(".rf-node__role"), label ?? title);
  const drawer = page.getByRole("complementary", { name: `${title} settings` });
  await drawer.waitFor({ timeout: 30000 });
  await sleep(400);
  return drawer;
}

/** The drawer's Save, then wait for "Saved". */
export async function saveDrawer(ctx, drawer) {
  const { cam } = ctx;
  await cam.click(drawer.getByRole("button", { name: /^Save/ }).last(), "Save");
  await drawer.getByText(/^Saved/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await cam.pause(900);
}

/** Model picker in a drawer: provider group (regex) → option (short id). */
export async function pickModel(ctx, drawer, group, option) {
  const { page, cam } = ctx;
  await cam.click(drawer.getByRole("region", { name: "Model" }).locator('button[aria-haspopup="dialog"]'), "Model");
  const picker = drawer.getByRole("dialog", { name: "Choose a model" });
  await picker.waitFor();
  const opt = picker.getByRole("group", { name: group }).getByRole("option", { name: option, exact: true });
  await opt.scrollIntoViewIfNeeded();
  await cam.click(opt, option);
  await picker.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  return page;
}

/** Close a drawer by clicking an empty part of the canvas. */
export async function closeDrawer(ctx) {
  const { page, cam } = ctx;
  await cam.press("Escape", "close the drawer");
  await sleep(500);
  return page;
}

// ---- recordings (V2's chapter 3: one recorded hero run, re-taken scene by scene) ---------------

/** The first time (ms into the recording) a response matched: path regex and body regex. */
export function firstTime(recording, pathRe, bodyRe = null, method = "GET") {
  for (const e of recording.entries) {
    if (e.method !== method || !pathRe.test(e.path)) continue;
    if (bodyRe && !bodyRe.test(Buffer.from(e.body, "base64").toString("utf8"))) continue;
    return e.t;
  }
  throw new Error(`no ${pathRe} ${bodyRe ?? ""} in the recording`);
}
export const MARK = {
  launch: (r) => firstTime(r, /^\/api\/runs$/, null, "POST"),
  gate: (r) => firstTime(r, /\/api\/runs\/[^/]+\/tasks$/, /"prd_approval"/),
  approved: (r) => firstTime(r, /\/activity$/, /Approved with your edits/),
  verdict: (r) => firstTime(r, /\/activity$/, /"kind":\s*"verdict"/),
  shipped: (r) => firstTime(r, /\/activity$/, /"kind":\s*"(pr|done)"/),
};
export const runPath = (ctx) => `#/teams/${ids(ctx).team}/runs/${ids(ctx).run}`;

/**
 * The whole recorded run, as 3.1 (V2's hero) and the F5 proof film it: the composer → Launch → the
 * notifications ask → the spec gate (one line edited, approved) → to the end → the Reviewer's
 * drawer and Changes (so replays of 3.7 have them). Pair moments are taken on a record take.
 */
export async function recordedRun(ctx, { folder = null, branch = null, edit = "Keep the change small and tested." } = {}) {
  const { page, cam } = ctx;
  const task = ctx.recorded?.task ?? ctx.state.task;
  const runId = await composeAndLaunch(ctx, { task, repo: ctx.story.repo.full_name, folder, branch });
  if (ctx.mode === "record") ctx.recordMeta = { team: ctx.state.team, run: runId, task };
  await answerNotifyAsk(ctx, "Not now", { wait: 8000 });
  await cam.roi("now", nowBar(page));
  await cam.roi("activity", activity(page));
  if (ctx.mode === "record") await ctx.pair("run view");
  await watch(ctx, async () => (await gateWaiting(page).count()) > 0, { label: "waiting for the spec gate" });
  if (ctx.mode === "record") await ctx.pair("spec gate waiting");
  await editAndApproveSpec(ctx, edit);
  if (ctx.mode === "record") await ctx.pair("approved with edits");
  await watch(ctx, () => runEnded(page), { label: "the run" });
  if (ctx.mode === "record") await ctx.pair("the end");
  await cam.pause(3000);
  const drawer = await openRunAgent(ctx, "Reviewer");
  const changes = drawer.getByRole("button", { name: "Changes", exact: true });
  if (await changes.count()) {
    await cam.click(changes, "Changes");
    await cam.pause(2500);
  }
  if (ctx.mode === "record") await ctx.pair("the Reviewer's drawer");
}

/** A run view agent's drawer ("<title> in this run"), opened from its card. */
export async function openRunAgent(ctx, title) {
  const { page, cam } = ctx;
  await cam.click(card(page, title).locator(".rf-node__role"), title);
  const drawer = page.getByRole("complementary", { name: `${title} in this run` });
  await drawer.waitFor({ timeout: 30000 });
  await cam.pause(1200);
  return drawer;
}

/** The newest run of the account that ended `status` (default completed), or null. */
export async function latestRun(api, status = "completed") {
  const r = await api("GET", `/api/runs?status=${status}&limit=5`);
  const runs = (r.json?.runs ?? []).filter((x) => !status || x.status === status);
  return runs[0] ?? null;
}

/** A point a third of the way along an edge's path, in page coordinates (design-parity's clickPath). */
export async function edgePoint(page, edgeId) {
  return page.evaluate((id) => {
    const path = document.querySelector(`.react-flow__edge[data-id="${id}"] .react-flow__edge-path`);
    const p = path.getPointAtLength(path.getTotalLength() / 3);
    const m = path.getScreenCTM();
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f };
  }, edgeId);
}
