/**
 * Bridge v6 `auth` (desktop-app.md DB-1..DB-3): the browser PKCE sign-in in main, the last-user
 * store, the `tvashtr://auth/done` return link + the website's `from=web` hint, and app.getInfo.
 *
 * Run: node --test desktop/scripts/desktop-sign-in.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createDesktopSignIn,
  challengeFor,
  readSessionCookie,
  SIGN_IN_TIMEOUT_MS,
} = require("../electron/auth/desktopSignIn.cjs");
const { createLastUser, LAST_USER_FILENAME } = require("../electron/auth/lastUser.cjs");
const { parseDeepLink, parseAuthLink } = require("../electron/deepLink.cjs");
const { appInfo, bundlePathFor } = require("../electron/appInfo.cjs");

const USER = {
  id: "7b0c2a52-0000-4000-8000-000000000001",
  email: "lazyxgenius@users.noreply.github.com",
  github_login: "lazyxgenius",
  display_name: "lazyxgenius",
};

function fakeTimers() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      if (t) t.cleared = true;
    },
    fire() {
      for (const t of timers.filter((x) => !x.cleared)) {
        t.cleared = true;
        t.fn();
      }
    },
  };
}

function okExchange(calls, { cookie = "tv_session=signed.cookie.value; HttpOnly; Max-Age=1209600; Path=/; SameSite=lax" } = {}) {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => USER,
      headers: { getSetCookie: () => [cookie], get: () => cookie },
    };
  };
}

function setup(overrides = {}) {
  const events = [];
  const opened = [];
  const cookies = [];
  const saved = [];
  let focused = 0;
  const clock = fakeTimers();
  const signIn = createDesktopSignIn({
    apiOrigin: () => "https://tvashtr.fly.dev",
    localOrigin: () => "http://127.0.0.1:5178",
    openExternal: async (url) => opened.push(url),
    setSessionCookie: async (c) => cookies.push(c),
    lastUser: { save: (u) => saved.push(u) },
    focus: () => {
      focused += 1;
    },
    emit: (e) => events.push(e),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  });
  return { signIn, events, opened, cookies, saved, clock, focused: () => focused };
}

test("start opens the browser on the PKCE start URL and waits", async () => {
  const { signIn, events, opened, clock } = setup();
  const { signInUrl } = await signIn.start({ account: "current" });
  assert.equal(opened.length, 1);
  assert.equal(opened[0], signInUrl);
  const u = new URL(signInUrl);
  assert.equal(u.origin + u.pathname, "https://tvashtr.fly.dev/api/auth/desktop/start");
  assert.match(u.searchParams.get("challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(u.searchParams.get("state"), /^[A-Za-z0-9_-]{32}$/);
  assert.equal(u.searchParams.get("account"), "current");
  assert.equal(signInUrl.includes("verifier"), false, "the verifier never leaves main");
  assert.deepEqual(events, [{ state: "waiting", signInUrl }]);
  assert.equal(clock.timers[0].ms, SIGN_IN_TIMEOUT_MS);
  assert.equal(SIGN_IN_TIMEOUT_MS, 10 * 60 * 1000);
});

test("openBrowser:false only makes the link (Copy the sign-in link)", async () => {
  const { signIn, opened } = setup();
  const { signInUrl } = await signIn.start({ openBrowser: false });
  assert.equal(opened.length, 0);
  assert.equal(signIn.signInUrl(), signInUrl);
  assert.equal(new URL(signInUrl).searchParams.get("account"), "github");
});

test("a matching code is exchanged with the verifier; the cookie lands on the loopback origin", async () => {
  const calls = [];
  const { signIn, events, cookies, saved, focused } = setup({ fetchImpl: okExchange(calls) });
  const { signInUrl } = await signIn.start();
  const u = new URL(signInUrl);
  const state = u.searchParams.get("state");
  assert.equal(await signIn.handleDone({ code: "abc.def.ghi", state }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:5178/api/auth/desktop/exchange");
  assert.equal(calls[0].body.code, "abc.def.ghi");
  assert.equal(challengeFor(calls[0].body.verifier), u.searchParams.get("challenge"));
  assert.deepEqual(cookies, [
    { url: "http://127.0.0.1:5178", value: "signed.cookie.value", maxAgeSeconds: 1209600 },
  ]);
  assert.deepEqual(saved, [{ login: "lazyxgenius", displayName: "lazyxgenius", github: true }]);
  assert.equal(focused(), 1);
  assert.deepEqual(events.at(-1), { state: "signed_in", user: USER });
  assert.equal(signIn.isPending(), false);
  // The same code can't be replayed.
  assert.equal(await signIn.handleDone({ code: "abc.def.ghi", state }), false);
});

test("a link for another sign-in (state mismatch) is ignored", async () => {
  const calls = [];
  const { signIn, events } = setup({ fetchImpl: okExchange(calls) });
  await signIn.start();
  assert.equal(await signIn.handleDone({ code: "abc", state: "x".repeat(32) }), false);
  assert.equal(calls.length, 0);
  assert.equal(events.length, 1, "still waiting");
  assert.equal(signIn.isPending(), true);
});

test("no code within 10 minutes → failed:timeout, and a late code is ignored", async () => {
  const calls = [];
  const { signIn, events, clock } = setup({ fetchImpl: okExchange(calls) });
  const { signInUrl } = await signIn.start();
  clock.fire();
  assert.deepEqual(events.at(-1), {
    state: "failed",
    reason: "timeout",
    message: "The browser didn't send you back within 10 minutes.",
  });
  const state = new URL(signInUrl).searchParams.get("state");
  assert.equal(await signIn.handleDone({ code: "late", state }), false);
  assert.equal(calls.length, 0);
});

test("Open the browser again re-opens the same URL and restarts the clock", async () => {
  const { signIn, opened, clock } = setup();
  const { signInUrl } = await signIn.start();
  await signIn.reopen();
  assert.deepEqual(opened, [signInUrl, signInUrl]);
  assert.equal(clock.timers.length, 2);
  assert.equal(clock.timers[0].cleared, true);
  assert.equal(clock.timers[1].cleared, false);
});

test("GitHub cancel and an expired start come back as failed events", async () => {
  const { signIn, events } = setup();
  let state = new URL((await signIn.start()).signInUrl).searchParams.get("state");
  await signIn.handleDone({ error: "cancelled", state });
  assert.equal(events.at(-1).reason, "cancelled");
  state = new URL((await signIn.start()).signInUrl).searchParams.get("state");
  await signIn.handleDone({ error: "expired", state });
  assert.equal(events.at(-1).reason, "expired");
  // GitHub refused the code: not "you cancelled" — couldn't finish.
  state = new URL((await signIn.start()).signInUrl).searchParams.get("state");
  await signIn.handleDone({ error: "failed", state });
  assert.deepEqual(events.at(-1), {
    state: "failed",
    reason: "exchange_failed",
    message: "Couldn't finish signing in. Sign in again.",
  });
});

test("Cancel drops the pending sign-in: its code is no longer used", async () => {
  const calls = [];
  const { signIn } = setup({ fetchImpl: okExchange(calls) });
  const state = new URL((await signIn.start()).signInUrl).searchParams.get("state");
  signIn.cancel();
  assert.equal(await signIn.handleDone({ code: "abc", state }), false);
  assert.equal(calls.length, 0);
});

test("a refused exchange fails with the server's words and sets no cookie", async () => {
  const { signIn, events, cookies } = setup({
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ detail: "This sign-in belongs to another app window. Sign in again." }),
      headers: { getSetCookie: () => [], get: () => null },
    }),
  });
  const state = new URL((await signIn.start()).signInUrl).searchParams.get("state");
  await signIn.handleDone({ code: "abc", state });
  assert.deepEqual(events.at(-1), {
    state: "failed",
    reason: "exchange_failed",
    message: "This sign-in belongs to another app window. Sign in again.",
  });
  assert.equal(cookies.length, 0);
});

test("readSessionCookie picks tv_session and its Max-Age", () => {
  assert.deepEqual(readSessionCookie(["other=1", 'tv_session="a.b.c"; Path=/; Max-Age=60']), {
    value: "a.b.c",
    maxAgeSeconds: 60,
  });
  assert.equal(readSessionCookie(["tv_session=; Max-Age=0"]), null);
  assert.equal(readSessionCookie([]), null);
});

test("challengeFor matches RFC 7636's S256 test vector", () => {
  assert.equal(
    challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
  const v = crypto.randomBytes(32).toString("base64url");
  assert.match(challengeFor(v), /^[A-Za-z0-9_-]{43}$/);
});

test("lastUser round trip keeps only the login, display name and whether it's a GitHub login", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-last-user-"));
  const store = createLastUser({ userDataDir: dir });
  assert.equal(store.get(), null);
  assert.equal(store.githubLogin(), null);
  assert.equal(
    store.save({ login: "lazyxgenius", displayName: "lazyxgenius", github: true, token: "x" }),
    true,
  );
  assert.deepEqual(store.get(), { login: "lazyxgenius", displayName: "lazyxgenius", github: true });
  assert.equal(store.githubLogin(), "lazyxgenius");
  const raw = JSON.parse(fs.readFileSync(path.join(dir, LAST_USER_FILENAME), "utf8"));
  assert.deepEqual(Object.keys(raw).sort(), ["displayName", "github", "login"]);
  // Independent review: an email-only account's "login" is its display name ("Lazyx"), which is
  // not a GitHub login — "Set up git here" must never turn it into Lazyx@users.noreply.github.com.
  assert.equal(store.save({ login: "Lazyx", displayName: "Lazyx", github: false }), true);
  assert.equal(store.githubLogin(), null);
  // A file written before the flag existed can't vouch for its login either.
  fs.writeFileSync(
    path.join(dir, LAST_USER_FILENAME),
    JSON.stringify({ login: "Lazyx", displayName: "Lazyx" }),
  );
  assert.equal(store.get().login, "Lazyx");
  assert.equal(store.githubLogin(), null);
  assert.equal(store.save({ login: "../../etc" }), false, "a login is a login, not a path");
  store.forget();
  assert.equal(store.get(), null);
  store.forget(); // forgetting twice is fine
});

test("tvashtr://auth/done is main-only and strictly shaped", () => {
  const state = "s".repeat(32);
  assert.deepEqual(parseAuthLink(`tvashtr://auth/done?code=abc.DEF-1_2&state=${state}`), {
    code: "abc.DEF-1_2",
    state,
  });
  assert.deepEqual(parseAuthLink(`tvashtr://auth/done?error=cancelled&state=${state}`), {
    error: "cancelled",
    state,
  });
  assert.deepEqual(parseAuthLink(`tvashtr://auth/done?error=expired&state=${state}`), {
    error: "expired",
    state,
  });
  assert.deepEqual(parseAuthLink(`tvashtr://auth/done?error=failed&state=${state}`), {
    error: "failed",
    state,
  });
  assert.deepEqual(parseAuthLink("tvashtr://auth/done"), {}, "the bare link only focuses");
  for (const bad of [
    `tvashtr://auth/done?code=abc`,
    `tvashtr://auth/done?code=a%20b&state=${state}`,
    `tvashtr://auth/done?error=boom&state=${state}`,
    `tvashtr://auth/done?code=abc&error=cancelled&state=${state}`,
    `tvashtr://auth/done?code=abc&state=short`,
    `tvashtr://auth/other?code=abc&state=${state}`,
    `https://auth/done?code=abc&state=${state}`,
    "tvashtr://home",
  ]) {
    assert.equal(parseAuthLink(bad), null, bad);
  }
  assert.equal(parseDeepLink(`tvashtr://auth/done?code=abc&state=${state}`), null, "never a page");
});

test("the website's from=web hint names the configured API host only", () => {
  const link = "tvashtr://home?from=web&login=lazyxgenius&host=tvashtr.fly.dev";
  assert.deepEqual(parseDeepLink(link, { apiHost: "tvashtr.fly.dev" }), {
    path: "/home",
    hint: { login: "lazyxgenius", host: "tvashtr.fly.dev" },
  });
  assert.deepEqual(parseDeepLink(link, { apiHost: "evil.example" }), { path: "/home" });
  assert.deepEqual(parseDeepLink(link), { path: "/home" }, "no API host known → no hint");
  assert.deepEqual(
    parseDeepLink("tvashtr://engines/subscriptions?connect=grok&from=web&login=a_b&host=tvashtr.fly.dev", {
      apiHost: "tvashtr.fly.dev",
    }),
    { path: "/engines/subscriptions", params: { connect: "grok" } },
    "a login GitHub couldn't issue is dropped",
  );
});

test("app.getInfo: version, API host, and whether the bundle can update in place", () => {
  const exe = "/Applications/Tvashtr.app/Contents/MacOS/Tvashtr";
  assert.equal(bundlePathFor(exe), "/Applications/Tvashtr.app");
  assert.equal(bundlePathFor("/usr/local/bin/electron"), null);
  const ok = appInfo({
    version: "0.5.0",
    apiOrigin: "https://tvashtr.fly.dev",
    platform: "darwin",
    exePath: exe,
    isPackaged: true,
    access: () => {},
  });
  assert.deepEqual(ok, {
    version: "0.5.0",
    apiOrigin: "https://tvashtr.fly.dev",
    apiHost: "tvashtr.fly.dev",
    platform: "darwin",
    bundlePath: "/Applications/Tvashtr.app",
    bundleWritable: true,
  });
  const denied = appInfo({ ...ok, exePath: exe, isPackaged: true, access: () => {
    throw new Error("EACCES");
  } });
  assert.equal(denied.bundleWritable, false);
  const dmg = appInfo({
    ...ok,
    exePath: "/Volumes/Tvashtr/Tvashtr.app/Contents/MacOS/Tvashtr",
    isPackaged: true,
    access: () => {},
  });
  assert.equal(dmg.bundleWritable, false, "running from the mounted DMG");
  const dev = appInfo({ ...ok, exePath: exe, isPackaged: false, access: () => {} });
  assert.equal(dev.bundlePath, null);
  assert.equal(dev.bundleWritable, false);
});
