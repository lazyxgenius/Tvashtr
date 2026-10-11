#!/usr/bin/env node
/**
 * The take runner (V1, F8): re-records any scene by name, in any order.
 *
 *   node video/camera/take.mjs 2.4            # setup off camera → pre-roll → film → video/takes/v1/2.4/
 *   node video/camera/take.mjs 2.4 --dry      # stop before anything that spends a subscription
 *   node video/camera/take.mjs 8.1-web        # one part of a scene
 *   node video/camera/take.mjs list           # the registry
 *   make -C video take SCENE=2.4 [DRY=1]
 *
 * Each scene is video/camera/scenes/<id>.mjs (default export, see scenes/README in video/README.md).
 * Modes: live (the real app on tvashtr_film) · sample (video/fixtures answer the renderer, F6) ·
 * record (live, and every renderer /api response is saved, F5) · replay (a recording answers the
 * renderer, F5) · web (the local frontend in Chromium, not Desktop mode) · run (scripted; films for
 * real only within the run budget) · mac / motion (not filmed by the camera: video/SCENES.md).
 *
 * Output per take: take.mp4 (2880×1800, 30 fps), take.json (scene, mode, recording or fixtures,
 * steps with time/kind/label/position, regions of interest), poster.png, shots/.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

import { assemble, extractFrame, probe, startScreencast } from "./capture.mjs";
import { makeCursor } from "./cursor.mjs";
import {
  DEV_URL,
  EMAIL,
  PASSWORD,
  apiSession,
  frontmost,
  launchDesktop,
  nav,
  repoRoot,
  sleep,
  waitRunnerFresh,
} from "./desktop.mjs";
import { clockScript, loadRecording, recordApi, replayApi, serveFixtures } from "./intercept.mjs";

const VIDEO = path.join(repoRoot, "video");
const SCENES = path.join(VIDEO, "camera", "scenes");
export const TAKES = path.join(VIDEO, "takes", "v1");
const RECORDINGS = path.join(VIDEO, "recordings");
const LEDGER = path.join(VIDEO, "out", "v1", "budget.json");
export const story = JSON.parse(fs.readFileSync(path.join(VIDEO, "story.json"), "utf8"));

/** F3: the V1 subscription budget. Compares and task sets are not allowed at all. */
const CAPS = { run: 2, test: 1, ask: 1, compare: 0, task_set: 0, save_with_tests: 0 };

/** --preview's stand-in for the Desktop's preload bridge (the real one exists in Electron). */
const PREVIEW_BRIDGE = `(() => {
  const st = (provider, connected) => ({ provider, connected, state: connected ? "connected" : "needs_install",
    account_hint: provider === "claude" ? "Claude Max" : provider === "grok" ? "Grok subscription" : null,
    source: connected ? "harness" : null, checked_at: new Date().toISOString() });
  const all = () => [st("claude", true), st("grok", true), st("codex", false)];
  window.tvashtrDesktop = {
    engines: { getStatus: async () => all(), connect: async (p) => st(p, true), disconnect: async (p) => st(p, false),
      refresh: async (p) => st(p, p !== "codex"), cancelConnect: async () => null, onStatus: () => () => {} },
    setup: { get: async () => ({ version: 1, step: null, finishedAt: new Date().toISOString(), planConsentAt: null, workspace: { kind: "ask" } }), update: async (_a, p) => p },
    repos: { recent: { list: async () => [], add: async () => [], remove: async () => [] }, pickFolder: async () => null,
      inspect: async () => null, prepareRun: async () => ({ snapshot_id: "preview" }) },
    auth: { getLaunchContext: async () => ({ openedFromWeb: false, lastUser: null }), onSignIn: () => () => {} },
    update: { getState: async () => ({ state: "idle" }), onState: () => () => {} },
    navigation: { onNavigate: () => () => {}, consumePending: async () => null },
    app: { getInfo: async () => ({ version: "0.25.0", platform: "darwin" }), setUnsavedChanges: () => {} },
  };
  window.tvashtrDesktopInfo = { shell: "electron", version: 6, platform: "darwin" };
  try { sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1"); } catch {}
})();`;

export class DryStop extends Error {
  constructor(label) {
    super(`--dry: stopped before ${label}`);
    this.label = label;
  }
}

const log = (...a) => console.log("[take]", ...a);

// ---- the registry ---------------------------------------------------------------------------

export async function registry() {
  const files = fs.readdirSync(SCENES).filter((f) => /^\d\.\d\.mjs$/.test(f));
  const scenes = [];
  for (const f of files) scenes.push((await import(pathToFileURL(path.join(SCENES, f)).href)).default);
  const order = (id) => id.split(".").map(Number);
  scenes.sort((a, b) => order(a.id)[0] - order(b.id)[0] || order(a.id)[1] - order(b.id)[1]);
  return scenes;
}

/** Every take a scene makes: the scene itself plus its parts (`<id>-<key>`). */
export function takesOf(scene) {
  const base = { ...scene };
  delete base.parts;
  const list = scene.film || ["mac", "motion"].includes(scene.mode) ? [{ ...base, take: scene.id }] : [];
  for (const p of scene.parts ?? []) list.push({ ...base, ...p, take: `${scene.id}-${p.key}` });
  return list;
}

// ---- the ledger (F3) ------------------------------------------------------------------------

function ledger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER, "utf8"));
  } catch {
    return { spends: [] };
  }
}
function spent(kind) {
  return ledger().spends.filter((s) => s.kind === kind).length;
}
function addSpend(entry) {
  const l = ledger();
  l.spends.push({ ...entry, at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

// ---- guards ---------------------------------------------------------------------------------

/** The stack on :8000/:5173 must be this checkout's; no other Tvashtr Desktop may run (rule 9). */
function guards() {
  const cwdOf = (port) =>
    execFileSync("sh", ["-c", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t || true`], { encoding: "utf8" })
      .split(/\s+/)
      .filter(Boolean)
      .map((pid) =>
        execFileSync("sh", ["-c", `lsof -a -p ${pid} -d cwd -Fn || true`], { encoding: "utf8" })
          .split("\n")
          .find((l) => l.startsWith("n"))
          ?.slice(1) || "",
      );
  for (const port of [8000, 5173]) {
    const cwds = cwdOf(port);
    if (!cwds.length) throw new Error(`nothing listens on :${port} — run video/stack/up`);
    if (!cwds.every((c) => c.startsWith(repoRoot))) {
      console.log(`STACK_WAITING :${port} is another checkout's (${cwds.join(" | ")})`);
      process.exit(3);
    }
  }
  const others = execFileSync("ps", ["-axo", "command"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => /Tvashtr\.app\/Contents\/MacOS\//.test(l) && !l.includes(repoRoot));
  if (others.length) {
    console.log(`STACK_WAITING another Tvashtr Desktop runs: ${others.join(" | ")}`);
    process.exit(3);
  }
}

/**
 * One Desktop at a time (rule 9): takes queue on a lock directory; a lock whose owner died is
 * taken over. Released when this process exits.
 */
function lock() {
  const dir = path.join(VIDEO, "out", "v1", "desktop.lock");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  for (let i = 0; ; i += 1) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, "pid"), String(process.pid));
      process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
      for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
      return;
    } catch {
      const owner = Number(fs.readFileSync(path.join(dir, "pid"), "utf8") || 0);
      let alive = false;
      try {
        process.kill(owner, 0);
        alive = true;
      } catch {
        /* gone */
      }
      if (!alive) {
        fs.rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (i % 30 === 0) console.log(`STACK_WAITING the Desktop is in use by take pid ${owner}`);
      execFileSync("sleep", ["2"]);
    }
  }
}

/** The run view's Now bar, Activity and summary texts (F5's matched pairs). */
const regionTexts = (page) =>
  page.evaluate(() => {
    const t = (n) => document.querySelector(`section[aria-label="${n}"]`)?.innerText?.trim() ?? null;
    return { now: t("Now"), activity: t("Activity"), summary: t("Run summary") };
  });
// Relative ages ("4 s ago", "1m 05s") tick with each poll: normalised per text, not on the JSON
// string (there "\n1 s ago" has no word boundary before the digit).
export const ageless = (x) =>
  x && Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "string" ? v.replace(/\b\d+\s?(h|m|s)\b( \d+\s?s\b)?/g, "#") : v]));
const norm = (x) => JSON.stringify(ageless(x));

// ---- one take -------------------------------------------------------------------------------

async function runTake(spec, { dry, keepFrames, preview = false, browser: debugBrowser = false }) {
  let mode = spec.mode;
  let recordingName = spec.recording;
  // A run scene's --dry rehearses against a real recording when it names one that exists (no
  // spend is possible in a replay).
  if (dry && spec.rehearse && fs.existsSync(path.join(RECORDINGS, spec.rehearse, "recording.json.gz"))) {
    mode = "replay";
    recordingName = spec.rehearse;
  } else if (dry && mode === "record") mode = "live"; // a rehearsal never writes a recording
  if (mode === "mac" || mode === "motion") {
    log(`${spec.take} is a ${mode.toUpperCase()} shot — not filmed by the camera (video/SCENES.md)`);
    return { take: spec.take, status: mode };
  }
  if (mode === "run" && !dry && !spec.film) throw new Error(`${spec.take}: no film script`);
  const id = (dry ? `${spec.take}-dry` : spec.take).replace(/^.*\/|\.mjs$/g, "");
  // --preview: a sample or web take rendered headless in Chromium (a stub Desktop bridge for
  // sample), to author fixtures without the one Desktop. Never a real take.
  if (preview && !(mode === "sample" || mode === "web")) throw new Error(`--preview is for sample/web takes, not ${mode}`);
  // --browser: debug a live scene's script in headless Chromium (stub Desktop bridge) against the
  // real stack — never a take, never a spend.
  if (debugBrowser && !(mode === "live" || mode === "run")) throw new Error(`--browser is for live scenes, not ${mode}`);
  if (debugBrowser) preview = true;
  const out = preview ? path.join(VIDEO, "out", "v1", "preview", id) : path.join(TAKES, id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "shots"), { recursive: true });

  // Off camera: a node-side session and the scene's starting state, through the app's own API.
  const api = apiSession();
  const login = await api("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) throw new Error(`sign-in for setup failed: HTTP ${login.status}`);
  const me = login.json;
  const ctx = {
    take: spec.take,
    mode,
    dry,
    story,
    api,
    me,
    out,
    notes: [],
    shots: [],
    pairs: [],
    spends: [],
    note: (t) => ctx.notes.push(t),
  };
  // A preview never changes the account: no setup (sample scenes need none); --browser does.
  ctx.state = spec.setup && (!preview || debugBrowser || mode === "web") ? (await spec.setup(ctx)) ?? {} : {};

  // F9: the notifications ask answered "Not now" (the scene may want it asked: 3.2).
  if (mode === "live" || mode === "record" || mode === "run") {
    const asked = spec.notifyAsk ? { notify_asked: false } : { notify_asked: true };
    const off = { notify_needs_you: false, notify_stalls_fails: false, notify_finishes: false };
    const r = await api("PATCH", "/api/account/preferences", { ...asked, ...off });
    if (r.status >= 300) ctx.note(`preferences PATCH HTTP ${r.status}`);
  }

  let routes = null;
  if (mode === "sample" || (mode === "web" && spec.fixtures)) {
    const mod = await import(pathToFileURL(path.join(VIDEO, "fixtures", `${spec.fixtures}.mjs`)).href);
    routes = typeof mod.default === "function" ? await mod.default(ctx) : mod.default;
    if (spec.routes) routes = { ...routes, ...(await spec.routes(ctx)) };
  }
  const recording = mode === "replay" ? loadRecording(path.join(RECORDINGS, recordingName)) : null;
  if (recording) {
    const { entries: _e, ...meta } = recording;
    ctx.recorded = meta;
  }

  // F9 pre-roll: a fresh throwaway profile with first-run setup finished for this account.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tvashtr-take-"));
  const fixtureMe = routes?.["GET /api/auth/me"];
  const ids = [me.id, fixtureMe?.id, ...(recording?.entries ?? []).filter((e) => e.path === "/api/auth/me").slice(0, 1).map((e) => JSON.parse(Buffer.from(e.body, "base64").toString()).id)].filter(Boolean);
  const finished = new Date().toISOString();
  const accounts = {};
  for (const a of ids)
    accounts[a] = spec.setupState ?? { version: 1, step: null, finishedAt: finished, planConsentAt: null, workspace: { kind: "ask" } };
  fs.writeFileSync(path.join(profile, "desktop-setup.json"), JSON.stringify({ version: 1, accounts }));

  let app = null;
  let browser = null;
  let page;
  let cast = null;
  let recorder = null;
  const result = { take: id, scene: spec.id, status: "ok" };
  const failures = [];
  try {
    if (mode === "web" || preview) {
      browser = await chromium.launch({ headless: true });
      // A web take of github.com (0.1) uses the operator's saved GitHub session (github-login.mjs).
      const gh = path.join(VIDEO, "out", "github-session.json");
      if (spec.githubSession && !fs.existsSync(gh))
        throw new Error("BLOCKED: trade_mcp is private — run node video/camera/github-login.mjs once (operator)");
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        ...(spec.githubSession ? { storageState: gh } : {}),
      });
      if (preview && mode !== "web") await context.addInitScript(PREVIEW_BRIDGE);
      page = await context.newPage();
    } else {
      ({ app, page } = await launchDesktop(out, "take", {}, profile));
    }
    ctx.app = app;
    ctx.page = page;
    page.on("pageerror", (e) => failures.push(`pageerror: ${String(e).slice(0, 300)}`));
    const cam = makeCursor(page, { speed: spec.speed ?? 1 });
    ctx.cam = cam;
    await cam.install();

    // The renderer's /api: fixtures, a recording, or the real backend (recorded or not).
    let intercept = null;
    if (routes) intercept = await serveFixtures(page, routes);
    if (recording) intercept = await replayApi(page, recording);
    if (mode === "record") recorder = recordApi(page, path.join(RECORDINGS, spec.record));

    if (mode === "web" || preview) {
      intercept?.start?.();
      ctx.anchor = Date.now();
      if (debugBrowser) {
        await page.goto(`${DEV_URL}/#/home`);
        await page.evaluate(
          async ({ email, password }) =>
            fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }),
          { email: EMAIL, password: PASSWORD },
        );
        await page.reload();
      }
      await page.goto(spec.url ? (typeof spec.url === "function" ? await spec.url(ctx) : spec.url) : `${DEV_URL}/${spec.start ?? "#/home"}`);
    } else {
      if (mode === "live" || mode === "record" || mode === "run") {
        const s = await page.evaluate(
          async ({ email, password }) =>
            (await fetch("/api/auth/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ email, password }),
            })).status,
          { email: EMAIL, password: PASSWORD },
        );
        if (s !== 200) throw new Error(`Desktop sign-in failed: HTTP ${s}`);
      }
      const anchor = Date.now();
      // A replay may start part-way into its recording (spec.from: ms, or (recording) => ms): the
      // app then loads the run as it stood at that moment.
      const from = recording ? Math.max(0, (typeof spec.from === "function" ? spec.from(recording) : spec.from) ?? 0) : 0;
      ctx.from = from;
      if (recording) await page.addInitScript(clockScript(recording.anchor + from - anchor));
      recorder?.start(anchor);
      intercept?.start?.(anchor - from);
      ctx.anchor = anchor;
      await page.evaluate((h) => {
        window.location.hash = h;
      }, "#/home");
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
    }
    await page.evaluate(() => document.fonts.ready);
    if (spec.ready) await spec.ready(ctx);
    else if (mode !== "web" || preview) await nav(page).waitFor({ timeout: 60000 });
    else await page.waitForLoadState("networkidle");

    // The subscriptions must read Connected (rule 6). The Desktop probes the CLIs at launch; a probe
    // that stumbled (seen once for Grok while `grok models` answered in 1 s) gets the app's own
    // Refresh, never a Terminal sign-in.
    if ((mode === "live" || mode === "record" || mode === "run") && !debugBrowser) {
      const states = () =>
        page.evaluate(async () =>
          Object.fromEntries(
            ((await window.tvashtrDesktop?.engines?.getStatus?.()) ?? []).map((s) => [s.provider, s.state]),
          ),
        );
      let s = await states();
      for (let i = 0; i < 3 && !(s.claude === "connected" && s.grok === "connected"); i += 1) {
        for (const p of ["claude", "grok"])
          if (s[p] !== "connected") await page.evaluate((p) => window.tvashtrDesktop.engines.refresh(p), p);
        await sleep(2000);
        s = await states();
      }
      ctx.engines = s;
      if (!(s.claude === "connected" && s.grok === "connected"))
        throw new Error(`NEEDS_HUMAN: Claude/Grok not Connected on the Desktop: ${JSON.stringify(s)}`);
      // …and the server must count this Desktop's runner as fresh, or a team "can't run yet".
      const fresh = await waitRunnerFresh(api, 40);
      if (!fresh) throw new Error("the server never saw this Desktop's runner as fresh (Claude + Grok)");
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      if (spec.ready) await spec.ready(ctx);
      else await nav(page).waitFor({ timeout: 60000 });
    }

    const view = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    if (view.join("x") !== "1440x900x2") throw new Error(`window is ${view.join("x")}, not 1440x900x2`);
    if (app) await frontmost(app, true);

    // Helpers the scene's script uses.
    ctx.go = async (hash, ready) => {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, hash);
      if (ready) await ready.waitFor({ timeout: 60000 });
      await sleep(400);
    };
    ctx.inPage = (method, p, body) =>
      page.evaluate(
        async ({ method, p, body }) => {
          const r = await fetch(p, {
            method,
            headers: { "content-type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const t = await r.text();
          let json = t;
          try {
            json = JSON.parse(t);
          } catch {
            /* text */
          }
          return { status: r.status, json };
        },
        { method, p, body },
      );
    ctx.shot = async (name) => {
      const file = path.join(out, "shots", `${name}.png`);
      await page.screenshot({ path: file });
      ctx.shots.push({ t: cam.t, name, file: path.relative(repoRoot, file) });
      return file;
    };
    ctx.spend = async (kind, label, fn) => {
      if (mode === "replay" && !dry) return fn(); // answered from the recording: nothing is spent
      if (dry || debugBrowser) throw new DryStop(label);
      // A spend needs the operator's say-so for this process (V1: the F3 budget is the architect's).
      if (process.env.VIDEO_ALLOW_SPEND !== "1")
        throw new Error(`refusing to spend (${kind}: ${label}) without VIDEO_ALLOW_SPEND=1 — rehearse with --dry`);
      if (!(kind in CAPS)) throw new Error(`unknown spend kind ${kind}`);
      if (spent(kind) >= CAPS[kind]) throw new Error(`budget: no ${kind} left (F3 cap ${CAPS[kind]})`);
      addSpend({ kind, take: id, label });
      ctx.spends.push({ kind, label, t: cam.t });
      return fn();
    };
    ctx.roi = cam.roi;
    /** A step inside a run that is already paid for (a gate, a resume click): --dry stops here. */
    ctx.advance = async (label, fn) => {
      if ((dry || debugBrowser) && mode !== "replay") throw new DryStop(label);
      return fn();
    };
    ctx.rehearsal = dry && mode === "replay";
    /** F5: a matched-pair moment — the Now bar and Activity texts, once they hold still. */
    ctx.pair = async (name) => {
      let a = await regionTexts(page);
      for (let i = 0; i < 6; i += 1) {
        await sleep(1500);
        const b = await regionTexts(page);
        if (norm(b) === norm(a)) {
          a = b;
          break;
        }
        a = b;
      }
      const t_ms = Date.now() - ctx.anchor;
      const file = path.join(out, "shots", `pair-${String(ctx.pairs.length + 1).padStart(2, "0")}-${mode}.png`);
      await page.screenshot({ path: file });
      ctx.pairs.push({ name, t_ms, texts: a, file: path.relative(repoRoot, file) });
    };

    if (spec.start && (mode !== "web" || debugBrowser)) await ctx.go(spec.start);
    if (spec.before) await spec.before(ctx);
    await page.mouse.move(1300, 860);
    await cam.rest(1300, 860);
    await sleep(spec.settle ?? 700);

    // F5: a replay re-takes the live take's pair moments at the same elapsed times.
    let pairTask = null;
    if (mode === "replay" && spec.pairsFrom) {
      const live = JSON.parse(fs.readFileSync(path.join(TAKES, spec.pairsFrom, "take.json"), "utf8")).pairs ?? [];
      pairTask = (async () => {
        for (const [i, lp] of live.entries()) {
          const wait = ctx.anchor + lp.t_ms + (intercept?.shift ?? 0) - 1500 - Date.now();
          if (wait > 0) await sleep(wait);
          // The replay's moment: within one poll of the live one (t − 1.5 s … t + 3 s), the first
          // exact match; else the first match apart from relative ages ("4 s ago"); else the
          // sample nearest the live moment.
          let best = null;
          let aged = null;
          let near = null;
          const until = ctx.anchor + lp.t_ms + (intercept?.shift ?? 0) + 3000;
          while (Date.now() < until) {
            const tx = await regionTexts(page).catch(() => null);
            const at = Date.now() - ctx.anchor - (intercept?.shift ?? 0);
            if (tx && JSON.stringify(tx) === JSON.stringify(lp.texts)) {
              best = { tx, exact: true, t_ms: at };
              break;
            }
            if (tx && !aged && norm(tx) === norm(lp.texts)) aged = { tx, exact: false, aged: true, t_ms: at };
            if (tx && (!near || Math.abs(at - lp.t_ms) < Math.abs(near.t_ms - lp.t_ms))) near = { tx, exact: false, t_ms: at };
            await sleep(250);
          }
          best ??= aged ?? near;
          const file = path.join(out, "shots", `pair-${String(i + 1).padStart(2, "0")}-replay.png`);
          await page.screenshot({ path: file }).catch(() => {});
          ctx.pairs.push({
            name: lp.name,
            t_ms: lp.t_ms,
            replay_t_ms: best?.t_ms ?? null,
            match: Boolean(best?.exact),
            same_but_ages: Boolean(best?.exact || best?.aged),
            texts: best?.tx ?? null,
            live: lp.file,
            file: path.relative(repoRoot, file),
          });
        }
      })();
    }

    // Film.
    cast = await startScreencast(page, path.join(out, "frames"), { every: spec.castEvery ?? 1 });
    cam.start(Date.now());
    try {
      await spec.film(ctx);
      await sleep(spec.tail ?? 1200);
    } catch (e) {
      if (e instanceof DryStop) {
        result.status = "dry";
        result.stopped_before = e.label;
        log(`${id}: ${e.message}`);
        await sleep(1200);
      } else throw e;
    }
    if (pairTask) await pairTask;
    // Off camera after the take (e.g. delete a placeholder secret typed on camera).
    if (spec.after) await spec.after(ctx);

    if (intercept?.missing?.size) failures.push(`unanswered /api requests: ${[...intercept.missing].join(", ")}`);
    if (intercept && "served" in intercept) {
      result.replay_served = intercept.served;
      ctx.note(`replay holds: ${JSON.stringify(intercept.holds)}; held ${Math.round(intercept.shift / 1000)} s in all`);
    }
  } catch (e) {
    result.status = "failed";
    result.error = String(e && e.stack ? e.stack : e).slice(0, 2000);
  } finally {
    // A recording is kept even when the take fails: the run it holds happened.
    if (recorder && ctx.anchor) {
      result.recording = path.relative(repoRoot, await recorder.save({ take: id, scene: spec.id, ...(ctx.recordMeta ?? {}) }));
      result.recorded = recorder.count;
    }
    const endTs = cast ? await cast.stop() : null;
    if (cast && cast.frames.length) {
      const mp4 = path.join(out, "take.mp4");
      assemble(cast.frames, endTs, mp4, { preset: cast.frames.length > 4000 ? "veryfast" : "slow" });
      const dur = Number(probe(mp4).format.duration);
      result.duration_s = Math.round(dur * 10) / 10;
      extractFrame(mp4, Math.min(dur - 0.1, spec.poster ?? dur * 0.6), path.join(out, "poster.png"));
      if (!keepFrames) fs.rmSync(path.join(out, "frames"), { recursive: true, force: true });
    }
    if (app) await app.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
  if (failures.length && result.status !== "failed") {
    result.status = "failed";
    result.error = failures.join(" | ");
  }
  const takeJson = {
    scene: spec.id,
    take: id,
    title: spec.title,
    chapter: Number(spec.id.split(".")[0]),
    mode: dry ? `${mode} (dry)` : mode,
    recording: recordingName ? `video/recordings/${recordingName}` : result.recording ?? null,
    recorded: ctx.recorded ?? ctx.recordMeta ?? null,
    fixtures: routes ? `video/fixtures/${spec.fixtures}.mjs` : null,
    status: result.status,
    stopped_before: result.stopped_before ?? null,
    error: result.error ?? null,
    duration_s: result.duration_s ?? null,
    budget_s: spec.budget ?? null,
    video: fs.existsSync(path.join(out, "take.mp4")) ? { file: "take.mp4", width: 2880, height: 1800, fps: 30, css: [1440, 900], scale: 2 } : null,
    account: ctx.me?.display_name ?? null,
    spends: ctx.spends,
    steps: ctx.cam?.steps ?? [],
    regions: ctx.cam?.regions ?? {},
    shots: ctx.shots,
    pairs: ctx.pairs,
    pairs_matched: ctx.pairs.length && mode === "replay" ? `${ctx.pairs.filter((p) => p.match).length}/${ctx.pairs.length}` : null,
    pairs_same_but_ages:
      ctx.pairs.length && mode === "replay" ? `${ctx.pairs.filter((p) => p.same_but_ages).length}/${ctx.pairs.length}` : null,
    notes: ctx.notes,
    recorded_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(out, "take.json"), JSON.stringify(takeJson, null, 2));
  log(`${id}: ${result.status}${result.duration_s ? ` ${result.duration_s}s` : ""}${result.error ? ` — ${result.error.split("\n")[0]}` : ""}`);
  return { ...result, out: path.relative(repoRoot, out) };
}

// ---- main -----------------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const keepFrames = argv.includes("--keep-frames");
  const preview = argv.includes("--preview");
  const browser = argv.includes("--browser");
  const ids = argv.filter((a) => !a.startsWith("--"));
  const scenes = await registry();
  const all = scenes.flatMap(takesOf);
  if (!ids.length || ids[0] === "list") {
    for (const t of all) console.log(`${t.take.padEnd(10)} ${t.mode.padEnd(7)} ${t.title}`);
    return 0;
  }
  if (argv.includes("--reset")) execFileSync(path.join(VIDEO, "stack", "reset"), { stdio: "inherit" });
  // A path to a scene file (e.g. video/fixtures/capture-live.mjs) runs that file's takes.
  for (const f of ids.filter((i) => i.endsWith(".mjs")))
    all.push(...takesOf((await import(pathToFileURL(path.resolve(f)).href)).default).map((t) => ({ ...t, take: f })));
  // "2.4" is that take; "3.2*" is every take of scene 3.2 (its parts too).
  const pick = (t, i) => t.take === i || (i.endsWith("*") && t.id === i.slice(0, -1));
  const wanted = all.filter((t) => ids.some((i) => pick(t, i)));
  const unknown = ids.filter((i) => !all.some((t) => pick(t, i)));
  if (unknown.length) throw new Error(`no such scene: ${unknown.join(", ")} (try: list)`);
  if (!preview && !browser) {
    guards();
    lock();
  }
  // Keep the Mac awake for the take (F9); caffeinate ends with this process.
  spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], { stdio: "ignore" }).unref();
  let failed = 0;
  for (const t of wanted) {
    const r = await runTake(t, { dry, keepFrames, preview, browser });
    if (r.status === "failed") failed += 1;
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

