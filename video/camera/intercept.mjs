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
    window.__tvOff = ${Math.round(offsetMs)};
    const R = Date;
    function D(...a) {
      if (!new.target) return new R(R.now() + window.__tvOff).toString();
      return a.length ? new R(...a) : new R(R.now() + window.__tvOff);
    }
    D.prototype = R.prototype;
    D.now = () => R.now() + window.__tvOff;
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
const PEEK = 1000;

export async function replayApi(page, recording) {
  const byKey = new Map();
  for (const e of recording.entries) {
    const k = `${e.method} ${e.path}${e.search}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }
  const activityByPath = new Map();
  for (const e of recording.entries)
    if (e.method === "GET" && /\/activity$/.test(e.path) && e.status === 200) {
      if (!activityByPath.has(e.path)) activityByPath.set(e.path, []);
      activityByPath.get(e.path).push(e);
    }
  const missing = new Set();
  let served = 0;
  let t0 = Date.now();
  // The run waits for the person, as it did live: each gate decision the page posted is a hold —
  // the recording's clock stops just before it until the replay's page posts it too, then goes on
  // (the page clock and the pair moments shift by the time held).
  const holds = recording.entries
    .filter((e) => e.method === "POST" && /\/tasks\/[^/]+\/resolve$/.test(e.path))
    .map((e) => ({ at: Math.max(0, e.t - 300), key: `POST ${e.path}${e.search}`, released: false, froze: null }));
  let shift = 0;
  const clock = () => {
    const raw = Date.now() - t0 - shift;
    const h = holds.find((x) => !x.released && x.at <= raw);
    if (!h) return raw;
    h.froze ??= Date.now() - (raw - h.at);
    return h.at;
  };
  const release = async (k) => {
    const h = holds.find((x) => !x.released && x.key === k);
    if (!h) return;
    const held = h.froze === null ? 0 : Date.now() - h.froze;
    h.released = true;
    shift += held;
    await page.evaluate((ms) => {
      window.__tvOff -= ms;
    }, held).catch(() => {});
  };
  await page.route(API_RE, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const k = `${req.method()} ${u.pathname}${u.search}`;
    const list = byKey.get(k);
    if (!list) {
      missing.add(k);
      return route.fulfill({ status: 599, json: { detail: "not in the recording (video replay)" } });
    }
    if (req.method() === "POST") await release(k);
    const t = clock();
    // A replay that starts part-way in asks for the run's Activity from scratch, which the live page
    // asked only at the start: answer with the Activity as it stood then — the newest response's
    // state and every line the recording had shown by then (all from the recording).
    if (/\/activity$/.test(u.pathname) && !u.searchParams.has("after")) {
      const next = holds.find((x) => !x.released);
      const limit = next ? Math.min(t + PEEK, next.at) : t + PEEK;
      const acts = (activityByPath.get(u.pathname) ?? []).filter((e) => e.t <= limit);
      if (acts.length && acts[acts.length - 1].t > (list[0]?.t ?? 0) + 3000) {
        const lines = new Map();
        let top = null;
        for (const e of acts) {
          const b = JSON.parse(Buffer.from(e.body, "base64").toString("utf8"));
          for (const l of b.lines ?? []) lines.set(l.id, l);
          top = b;
        }
        served += 1;
        return route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...top, lines: [...lines.values()] }),
        });
      }
    }
    // The live page polled on its own timers; the replay's polls land at other phases. Answer with
    // the recorded response nearest in time, looking at most PEEK ms ahead, so a poll that comes a
    // moment before the live one doesn't show the state one poll older than the live page did.
    // Never look past a hold the page hasn't released (the state after a person's decision).
    const next = holds.find((x) => !x.released);
    const limit = next ? Math.min(t + PEEK, next.at) : t + PEEK;
    let hit = list[0];
    for (const e of list) if (e.t <= limit) hit = e;
    if (hit.t > t) {
      const before = [...list].reverse().find((e) => e.t <= t);
      if (before && t - before.t < hit.t - t) hit = before;
    }
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
    /** ms held so far (pair moments after a hold move by this much). */
    get shift() {
      return shift;
    },
    get holds() {
      return holds.map(({ at, key, released }) => ({ at, key, released }));
    },
    start(at = Date.now()) {
      t0 = at;
      // A replay that starts part-way in (spec.from) is past the holds before its start.
      const from = Date.now() - at;
      for (const h of holds) if (h.at < from) h.released = true;
    },
  };
}
