/**
 * The renderer's /api traffic in the REAL Electron window (Playwright route interception):
 *  - sample mode (F6): answered from video/fixtures (design-parity's route format);
 *  - record (F5): every /api response the renderer received during a live take, with its time;
 *  - replay (F5): answered from a recording by elapsed time.
 * A request the fixtures or the recording can't answer fails the take loudly — it never falls
 * through to the backend. Only the renderer is intercepted: the Desktop's main process (runner,
 * engine-status mirror, updater) uses Node fetch and is not; replay strips Set-Cookie so the runner
 * never gets a session from a recording and stays idle.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// Anchored to the path start: Vite serves source modules like /src/lib/api/teams.ts.
export const API_RE = /^https?:\/\/[^/]+\/(api\/|health)/;

/** design-parity's matcher: exact "METHOD /path?query", then "METHOD /path", then ":param" keys. */
export function match(routes, method, pathname, search) {
  const key = `${method} ${pathname}`;
  if (routes[`${key}${search}`] !== undefined) return routes[`${key}${search}`];
  if (routes[key] !== undefined) return routes[key];
  for (const [k, v] of Object.entries(routes)) {
    const [m, p] = k.split(" ");
    if (m !== method || !p.includes(":") || p.includes("?")) continue;
    if (new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname)) return v;
  }
  return undefined;
}

/** Sample mode: every renderer /api call answered from `routes`. Returns { missing }. */
export async function serveFixtures(page, routes) {
  const missing = new Set();
  await page.route(API_RE, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const hit = match(routes, req.method(), u.pathname, u.search);
    if (hit === undefined) {
      missing.add(`${req.method()} ${u.pathname}${u.search}`);
      return route.fulfill({ status: 599, json: { detail: "no fixture (video sample mode)" } });
    }
    if (typeof hit === "function") {
      const r = await hit(req);
      return route.fulfill({ status: r.status ?? 200, json: r.json ?? null });
    }
    return route.fulfill({ status: 200, json: hit });
  });
  return { missing };
}

/** Record mode: passive — the renderer talks to the real backend; each response is saved. */
export function recordApi(page, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  let t0 = Date.now();
  const pending = new Set();
  const onResponse = (res) => {
    const req = res.request();
    if (!API_RE.test(req.url())) return;
    const t = Date.now() - t0;
    const u = new URL(req.url());
    const p = res
      .body()
      .then((buf) => {
        entries.push({
          t,
          method: req.method(),
          path: u.pathname,
          search: u.search,
          req: req.postData() || null,
          status: res.status(),
          type: res.headers()["content-type"] || "application/json",
          body: buf.toString("base64"),
        });
      })
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
  };
  page.on("response", onResponse);
  return {
    /** The recording's clock starts now (the same anchor the replay uses). */
    start(at = Date.now()) {
      t0 = at;
      entries.length = 0;
    },
    get anchor() {
      return t0;
    },
    get count() {
      return entries.length;
    },
    async save(meta = {}) {
      page.off("response", onResponse);
      await Promise.all([...pending]);
      entries.sort((a, b) => a.t - b.t);
      const file = path.join(dir, "recording.json.gz");
      fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ ...meta, anchor: t0, entries })));
      fs.writeFileSync(
        path.join(dir, "meta.json"),
        JSON.stringify({ ...meta, entries: entries.length, saved: new Date().toISOString() }, null, 2),
      );
      return file;
    },
  };
}

/**
 * The replay's page clock: Date runs `offsetMs` behind (or ahead), so every "2m ago" and every
 * elapsed time the app computes reads as it did in the live take.
 */
export function clockScript(offsetMs) {
  return `(() => {
    const off = ${Math.round(offsetMs)};
    const R = Date;
    function D(...a) {
      if (!new.target) return new R(R.now() + off).toString();
      return a.length ? new R(...a) : new R(R.now() + off);
    }
    D.prototype = R.prototype;
    D.now = () => R.now() + off;
    D.parse = R.parse;
    D.UTC = R.UTC;
    window.Date = D;
  })();`;
}

export function loadRecording(dir) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, "recording.json.gz"))).toString());
}

/**
 * Replay mode: each renderer /api call answered with the recorded response for the same
 * method + path + query whose recorded time is the latest at or before the replay's elapsed time
 * (the first one when the replay asks earlier than the live take did). Returns { missing, served,
 * start(at) }. Unknown requests answer 599 and are listed: the take fails.
 */
export async function replayApi(page, recording) {
  const byKey = new Map();
  for (const e of recording.entries) {
    const k = `${e.method} ${e.path}${e.search}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  const missing = new Set();
  let served = 0;
  let t0 = Date.now();
  await page.route(API_RE, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const k = `${req.method()} ${u.pathname}${u.search}`;
    const list = byKey.get(k);
    if (!list) {
      missing.add(k);
      return route.fulfill({ status: 599, json: { detail: "not in the recording (video replay)" } });
    }
    const t = Date.now() - t0;
    let hit = list[0];
    for (const e of list) if (e.t <= t) hit = e;
    served += 1;
    return route.fulfill({
      status: hit.status,
      headers: { "content-type": hit.type }, // no Set-Cookie: the runner stays signed out
      body: Buffer.from(hit.body, "base64"),
    });
  });
  return {
    missing,
    get served() {
      return served;
    },
    start(at = Date.now()) {
      t0 = at;
    },
  };
}
