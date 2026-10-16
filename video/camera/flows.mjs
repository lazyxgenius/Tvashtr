/**
 * On-camera flows shared by the run scenes (chapters 3–6): every click goes through the cursor
 * (cam), every subscription spend through ctx.spend (a --dry rehearsal stops there), every step
 * inside a paid run through ctx.advance. Selectors follow frontend/e2e and video/SCENES.md.
 */
import fs from "node:fs";
import path from "node:path";
import { processTree, repoRoot, sleep } from "./desktop.mjs";

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
    // Recent tasks opens once its matches load; Esc closes it only while it is open.
    const recent = page.getByRole("listbox", { name: "Recent tasks" });
    if (await recent.waitFor({ timeout: 3000 }).then(() => true, () => false)) {
      await page.keyboard.press("Escape");
      await recent.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }
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
export async function answerNotifyAsk(ctx, choice = "Not now", { wait = 6000, offCamera = false } = {}) {
  const { page, cam } = ctx;
  const ask = page.getByRole("dialog", { name: "Notifications" });
  try {
    await ask.waitFor({ timeout: wait });
  } catch {
    return false;
  }
  if (offCamera) {
    await ask.getByRole("button", { name: choice, exact: true }).click();
    return true;
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

/**
 * G1: a gate the run waits on (the Escalation gate after 3 review rounds: "ship the last build
 * as-is, or stop") is approved on camera — its blocker card's Approve, a step inside the paid run.
 * Returns the card's title, or null when nothing waits.
 */
export async function approveWaiting(ctx) {
  const { page, cam } = ctx;
  const blocker = page.locator("article.tv-task").filter({ hasText: "Awaiting your approval" }).first();
  if (!(await blocker.count())) return null;
  const title = (await blocker.locator(".tv-task__title").first().innerText()).trim();
  await cam.roi("blocker", blocker);
  await cam.pause(1500);
  await ctx.advance(`Approve: ${title}`, () =>
    cam.click(blocker.getByRole("button", { name: "Approve", exact: true }), "Approve"),
  );
  await blocker.waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
  ctx.note(`approved on camera: ${title}`);
  return title;
}

const engineerWorking = (page) =>
  nowBar(page).getByRole("button", { name: /^Engineer/ }).filter({ hasText: /Working|Running/ });

export const reviewerWorking = (page) =>
  nowBar(page).getByRole("button", { name: /^Reviewer/ }).filter({ hasText: /Working|Running/ });

/** V2b's live smoke (brief Part B): one `SMOKE: <check> PASS|FAIL <shot> — <why>` line, echoed and
 *  kept in take.json's notes. */
export function smoke(ctx, check, ok, shot = null, why = "") {
  const where = shot ? path.relative(repoRoot, path.resolve(repoRoot, shot)) : "-";
  const line = `SMOKE: ${check} ${ok ? "PASS" : "FAIL"} ${where}${why ? ` — ${why}` : ""}`;
  console.log(line);
  ctx?.note?.(line);
  return ok;
}

export const MONEY = /\$0\.00 \+|\$0\.0000/;
/** S1 + F2 + L1 on the page as it stands: the toolbar's height (one row is 56 px), the run card
 *  (RunBanner's .tv-card) inside the bar and clear of every other item, the Done summary's "total
 *  time" inside the summary on one line, and any "$0.00 +" / "$0.0000". */
export const layout = (page) =>
  page.evaluate((money) => {
    const box = (e) => e.getBoundingClientRect();
    const bar = document.querySelector('[role="toolbar"][aria-label="Team"]');
    const card = bar?.querySelector(".tv-card");
    const others = card
      ? [...bar.querySelectorAll(".cv-bar__group > *, .cv-right > *")].filter(
          (e) => !e.contains(card) && !card.contains(e) && e.getClientRects().length,
        )
      : [];
    const hit = (a, z) => a.left < z.right - 1 && z.left < a.right - 1 && a.top < z.bottom - 1 && z.top < a.bottom - 1;
    const done = document.querySelector("section.lv-done");
    const stat = [...(done?.querySelectorAll(".lv-done__stat") ?? [])].find((e) => e.textContent.includes("total time"));
    const words = `${bar?.innerText ?? ""}\n${done?.innerText ?? ""}`;
    return {
      toolbar_px: bar ? Math.round(box(bar).height * 10) / 10 : null,
      card_clear: card
        ? box(card).top >= box(bar).top - 1 &&
          box(card).bottom <= box(bar).bottom + 1 &&
          card.scrollWidth <= card.clientWidth + 1 &&
          !others.some((e) => hit(box(e), box(card)))
        : null,
      total_time_whole: stat
        ? box(stat).right <= Math.min(box(done).right, innerWidth) + 1 &&
          box(stat).height < 2 * box(stat.firstElementChild).height
        : null,
      money: words.match(new RegExp(money))?.[0] ?? null,
    };
  }, MONEY.source);

const CHECK = {
  "Running the tests…": "running",
  "Tests passed": "passed",
  "Tests failed": "failed",
  "Couldn’t run the tests": "couldnt",
  "Stopped while running the tests": "stopped",
};
/** V2b (G5): each Tests check moment — "Running the tests…", then its result — gets a shot; a
 *  failed check's lines are opened under its row ("Show output" is the page's own state, no
 *  request, so a replay opens it itself). */
export async function testsMoments(ctx, seen) {
  const { page, cam } = ctx;
  const rows = activity(page).locator("li.lv-line").filter({ hasText: new RegExp(Object.keys(CHECK).join("|")) });
  for (const row of await rows.all()) {
    const what = (await row.locator(".lv-line__what").innerText().catch(() => "")).trim();
    const lead = Object.keys(CHECK).find((k) => what.startsWith(k));
    if (!lead) continue;
    const key = `${await row.locator(".lv-line__time").innerText().catch(() => "")}|${lead}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const show = row.getByRole("button", { name: "Show output", exact: true });
    if (CHECK[lead] === "failed" && (await show.count())) await cam.click(show, "Show output");
    else await cam.hover(row.locator(".lv-line__what"), lead);
    await cam.pause(2500);
    await ctx.shot(`tests-${seen.size}-${CHECK[lead]}`);
    ctx.note(`tests: ${what}`);
  }
}

/** S4: a run drawer's Activity → Raw log: its job's own lines, the lock line among them. */
export async function rawLog(ctx, drawer, shot) {
  const { cam } = ctx;
  await cam.click(drawer.getByRole("group", { name: "Steps" }).getByRole("button", { name: "Raw log", exact: true }), "Raw log");
  await drawer.getByText(/is locked to this job's copy of the repo/).first().waitFor({ timeout: 60000 }).catch(() => {});
  await cam.pause(2000);
  return ctx.shot(shot);
}

/** S4 for jobs the server keeps no log of (an Ask, a test replay): the Grok CLIs this Desktop
 *  starts, read from its own process tree, with their --sandbox. */
export function watchGrok(ctx) {
  const seen = new Map();
  const timer = setInterval(() => {
    for (const p of processTree(ctx.app.process().pid))
      if (/--output-format streaming-json/.test(p.command) && !/tvashtr-lock-check/.test(p.command))
        seen.set(p.pid, p.command.match(/--sandbox (\S+)/)?.[1] ?? "none");
  }, 1000);
  return () => {
    clearInterval(timer);
    return [...seen.values()];
  };
}

/** S4 for Claude jobs the server keeps no log of (a test replay, an Ask): the Claude CLIs this
 *  Desktop starts, read from its own process tree — each must carry its lock flags. */
export function watchClaude(ctx) {
  const seen = new Map();
  const timer = setInterval(() => {
    for (const p of processTree(ctx.app.process().pid))
      if (/--output-format stream-json/.test(p.command) && /(^|\/)claude\s/.test(p.command))
        seen.set(p.pid, /--restricted/.test(p.command) && /--safe-mode/.test(p.command) ? "--restricted --safe-mode" : "unlocked");
  }, 1000);
  return () => {
    clearInterval(timer);
    return [...seen.values()];
  };
}

/** V2b's in-take smoke on the hero after Done (the record take): S1/F2, F1, L1 on screen, S2. */
async function heroSmoke(ctx, runId, { running, runShot, doneShot }) {
  const { page } = ctx;
  const done = await layout(page);
  smoke(
    ctx,
    "Hero S1+F2 (running toolbar one row, run card clear)",
    running.length > 0 && running.every((m) => m.toolbar_px !== null && m.toolbar_px <= 57 && m.card_clear),
    runShot,
    running.map((m) => `${m.toolbar_px}px card_clear=${m.card_clear}`).join(" · "),
  );
  smoke(ctx, "Hero S1 (Done summary keeps “total time”)", done.total_time_whole === true, doneShot);
  smoke(ctx, "F1 (run view card)", (await gateCard(page, "Tests pass").count()) === 1, doneShot);
  const money = [...running, done].map((m) => m.money).filter(Boolean);
  smoke(ctx, "Hero L1/H1 (toolbar chip, banner, Done summary)", !money.length, doneShot, money.join(", "));
  // S2: the Done line before and after the post-ship memory save, through the node-side session
  // (a page fetch would land in the recording).
  const read = async () => (await ctx.api("GET", `/api/runs/${runId}/activity?desktop_target=1`)).json ?? {};
  const doneOf = (a) => a.lines?.find((l) => l.kind === "done")?.text ?? null;
  const first = await read();
  let later = first;
  for (let i = 0; i < 60 && !later.lines?.some((l) => l.review_memories); i += 1) {
    await sleep(3000);
    later = await read();
  }
  const memo = later.lines?.find((l) => l.review_memories)?.text ?? "no memory line within 3 min";
  const shot = await ctx.shot("done-after-memories");
  smoke(
    ctx,
    "Hero S2 (the Done line keeps its time)",
    Boolean(doneOf(first)) && doneOf(first) === doneOf(later) && first.summary?.elapsed_s === later.summary?.elapsed_s,
    shot,
    `${doneOf(first)} → ${doneOf(later)}; ${memo}`,
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
  page.locator(".react-flow__node").filter({ has: page.locator(".rf-gate__label", { hasText: new RegExp(`^${label}$`) }) });

/** Wait for the canvas to draw its cards. */
export async function canvasReady(page) {
  await page.locator(".react-flow__node").first().waitFor({ timeout: 60000 });
  await sleep(600);
}

/** Click an agent's card; returns its settings drawer. */
export async function openAgent(ctx, title, { label } = {}) {
  const { page, cam } = ctx;
  const drawer = page.getByRole("complementary", { name: `${title} settings` });
  await cam.click(card(page, title).locator(".rf-node__role"), label ?? title);
  // A click that lands while the canvas is still settling only selects the card: click again.
  if (!(await drawer.waitFor({ timeout: 6000 }).then(() => true, () => false)))
    await cam.click(card(page, title).locator(".rf-node__role"), label ?? title);
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

/** K8: a model the picker's lists don't carry, typed as a custom model ID (provider/model). */
export async function pickCustomModel(ctx, drawer, id) {
  const { page, cam } = ctx;
  await cam.click(drawer.getByRole("region", { name: "Model" }).locator('button[aria-haspopup="dialog"]'), "Model");
  const picker = drawer.getByRole("dialog", { name: "Choose a model" });
  await picker.waitFor();
  const use = picker.getByRole("button", { name: /custom model ID/i });
  await use.scrollIntoViewIfNeeded();
  await cam.click(use, "Use a custom model ID");
  await cam.type(picker.getByLabel("Custom model ID"), id, "the model ID", { clear: true });
  await cam.pause(1500);
  await cam.click(picker.getByRole("button", { name: "Use this model" }), "Use this model");
  await picker.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  return page;
}

/** Close the open drawer with its own close button (Escape where it has none). */
export async function closeDrawer(ctx) {
  const { page, cam } = ctx;
  const x = page.getByRole("complementary").getByRole("button", { name: /^Close( panel)?$/ }).first();
  if (await x.isVisible().catch(() => false)) await cam.click(x, "close the drawer");
  else await cam.press("Escape", "close the drawer");
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
  // V2b: only a Tests check's Activity line carries refs.result (activity.py _check_line).
  testsRunning: (r) => firstTime(r, /\/activity$/, /"result":\s*"running"/),
  tests: (r) => firstTime(r, /\/activity$/, /"result":\s*"(passed|failed|skipped)"/),
  verdict: (r) => firstTime(r, /\/activity$/, /"kind":\s*"verdict"/),
  shipped: (r) => firstTime(r, /\/activity$/, /"kind":\s*"(pr|done)"/),
};
export const runPath = (ctx) => `#/teams/${ids(ctx).team}/runs/${ids(ctx).run}`;

/**
 * The whole recorded run, as 3.1 (V2's hero) and the F5 proof film it: the composer → Launch → the
 * notifications ask → the spec gate (one line edited, approved) → the Engineer's drawer while it
 * works → to the end (a waiting Escalation gate approved on camera) → the Reviewer's drawer and
 * Changes. G5: every view a replay of 3.2–3.6 shows is opened here. Pair moments on a record take.
 */
export async function recordedRun(ctx, { folder = null, branch = null, edit = "Keep the change small and tested." } = {}) {
  const { page, cam } = ctx;
  // V2b's extra views and smoke reads: the record take only (3.2-replay replays V1's proof).
  const rec = ctx.mode === "record";
  const task = ctx.recorded?.task ?? ctx.state.task;
  const runId = await composeAndLaunch(ctx, { task, repo: ctx.story.repo.full_name, folder, branch });
  if (rec) ctx.recordMeta = { team: ctx.state.team, run: runId, task };
  await answerNotifyAsk(ctx, "Not now", { wait: 8000 });
  await cam.roi("now", nowBar(page));
  await cam.roi("activity", activity(page));
  if (rec) await ctx.pair("run view");
  await watch(ctx, async () => (await gateWaiting(page).count()) > 0, { label: "waiting for the spec gate" });
  if (rec) await ctx.pair("spec gate waiting");
  await editAndApproveSpec(ctx, edit);
  if (rec) await ctx.pair("approved with edits");
  // G5: the Engineer's drawer while it works — 3.4's replay shows it.
  await watch(ctx, async () => (await engineerWorking(page).count()) > 0, {
    label: "the Engineer working",
    timeout: 20 * 60000,
  });
  const running = rec ? [await layout(page)] : []; // S1/F2: the running toolbar, no drawer open
  const eng = await openRunAgent(ctx, "Engineer");
  await cam.pause(6000);
  if (rec) await ctx.pair("the Engineer's drawer");
  const runShot = await ctx.shot("running"); // the live smoke: the toolbar chip and banner while it runs
  if (rec) await rawLog(ctx, eng, "engineer-raw-log"); // S4 (Claude); records the run events for 3.4
  await closeDrawer(ctx);
  // To the end: each Tests check moment (a failed one's lines opened), the Reviewer's drawer once it
  // works (S4, Grok; F2 with both subscriptions in the chip), a gate it waits on approved on camera (G1).
  const seen = new Set();
  let reviewer = !rec;
  await watch(
    ctx,
    async () => {
      if (rec) await testsMoments(ctx, seen);
      if (!reviewer && (await reviewerWorking(page).count())) {
        reviewer = true;
        running.push(await layout(page));
        await ctx.shot("running-reviewer");
        await rawLog(ctx, await openRunAgent(ctx, "Reviewer"), "reviewer-raw-log");
        await closeDrawer(ctx);
      }
      await approveWaiting(ctx);
      return runEnded(page);
    },
    { label: "the run", timeout: 120 * 60000 },
  );
  if (rec) await testsMoments(ctx, seen);
  if (rec) await ctx.pair("the end");
  await cam.pause(3000);
  const doneShot = await ctx.shot("done"); // the live smoke: Done line, Done summary, banner, toolbar
  if (rec && runId) await heroSmoke(ctx, runId, { running, runShot, doneShot });
  const drawer = await openRunAgent(ctx, "Reviewer");
  await cam.pause(1500);
  await ctx.shot("reviewer-verdict");
  const changes = drawer.getByRole("button", { name: "Changes", exact: true });
  if (await changes.count()) {
    await cam.click(changes, "Changes");
    await cam.pause(2500);
    await ctx.shot("reviewer-changes");
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

/**
 * V2: the hero run (3.1's recording, "Add a Hull moving average indicator") — 0.1, 3.7, 5.1 and 6.1
 * work on it by id, never on "the newest run" (4.2's resumed run is newer).
 */
export async function heroRun(api) {
  const meta = path.join(repoRoot, "video", "recordings", "hero", "meta.json");
  if (!fs.existsSync(meta)) throw new Error("no hero recording yet: film 3.1 first");
  const { team, run } = JSON.parse(fs.readFileSync(meta, "utf8"));
  const r = await api("GET", `/api/runs/${run}`);
  if (r.status !== 200) throw new Error(`hero run ${run}: HTTP ${r.status}`);
  return { team, run_id: run, status: r.json.run?.status ?? null, pr_url: r.json.run?.pr_url ?? null };
}

/**
 * K9 (brief m-desk-8-v2b2): chapter 6's run — the seed run on the fresh film team, recorded in
 * video/out/v2b/seed.json when it ran (off camera). 6.1 makes its test from this run's Reviewer.
 */
export async function seedRun(api) {
  const file = path.join(repoRoot, "video", "out", "v2b", "seed.json");
  if (!fs.existsSync(file)) throw new Error("no seed run yet: run video/camera/seed.mjs first");
  const { team, run } = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = await api("GET", `/api/runs/${run}`);
  if (r.status !== 200) throw new Error(`seed run ${run}: HTTP ${r.status}`);
  return { team, run_id: run, status: r.json.run?.status ?? null, pr_url: r.json.run?.pr_url ?? null };
}

/**
 * V2: a long run to its end OFF camera (a jump cut), coming back on camera for each gate it waits
 * on (approved on camera, G1) and for the end. The Desktop stays open: its runner does the work.
 */
export async function toTheEnd(ctx, label, { timeout = 120 * 60000 } = {}) {
  const { page } = ctx;
  const blocker = page.locator("article.tv-task").filter({ hasText: "Awaiting your approval" });
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    await ctx.offCamera(label, async () => {
      while (Date.now() < end && !(await runEnded(page)) && !(await blocker.count())) await sleep(3000);
    });
    if (await approveWaiting(ctx)) continue;
    if (await runEnded(page)) return true;
  }
  throw new Error(`timed out: ${label}`);
}
