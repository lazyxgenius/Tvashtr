/**
 * The engines bridge behind `tvashtr:engines:*` (engines.md B1, B2, B5):
 * - a user Disconnect is sticky across relaunch (no probe until Connect),
 * - cancelConnect drops the pending sign-in re-probe,
 * - Refresh never rejects: a probe error is recorded as an `error` status.
 *
 * Run: node --test desktop/scripts/engine-controller.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createEnginePrefs, PREFS_FILENAME } = require("../electron/harness/enginePrefs.cjs");
const { createStatusStore } = require("../electron/harness/statusStore.cjs");
const { createEngineController } = require("../electron/runner/engineController.cjs");

const PROVIDERS = ["claude", "grok", "codex"];
const plainStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s),
  decryptString: (b) => Buffer.from(b).toString("utf8"),
};

function signedIn(provider) {
  return {
    provider,
    connected: true,
    state: "connected",
    account_hint: "Pro plan",
    source: "harness",
    checked_at: "2026-09-25T00:00:00.000Z",
  };
}

function needsLogin(provider) {
  return { ...signedIn(provider), connected: false, state: "needs_login", account_hint: null };
}

/** A CLI that is (and stays) signed in, counting how often it is asked. */
function fakeRegistry(toStatus = async (p) => signedIn(p), connect = async (p) => needsLogin(p)) {
  const probes = [];
  return {
    probes,
    get(provider) {
      if (!PROVIDERS.includes(provider)) return null;
      return {
        async toStatus() {
          probes.push(provider);
          return toStatus(provider);
        },
        connect: () => connect(provider),
      };
    },
  };
}

function fakeSync() {
  const puts = [];
  const clears = [];
  return {
    puts,
    clears,
    async push(s) {
      puts.push({ provider: s.provider, state: s.state });
    },
    async clear(p) {
      clears.push(p);
    },
  };
}

/** One "app launch" against a userData dir. */
function launch(userDataDir, registry = fakeRegistry(), opts = {}) {
  const store = createStatusStore({ userDataDir, safeStorage: plainStorage });
  const prefs = createEnginePrefs({ userDataDir, providers: PROVIDERS });
  const statusSync = fakeSync();
  const notified = [];
  const ctl = createEngineController({
    providers: PROVIDERS,
    registry,
    store,
    prefs,
    statusSync,
    notify: (s) => notified.push(s),
    ...opts,
  });
  return { ctl, store, prefs, statusSync, registry, notified };
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "tv-engctl-"));

test("the prefs store keeps user-disconnected providers across instances and ignores junk", () => {
  const dir = tmpDir();
  const a = createEnginePrefs({ userDataDir: dir, providers: PROVIDERS });
  a.markUserDisconnected("claude");
  a.markUserDisconnected("claude");
  a.markUserDisconnected("nope");
  const b = createEnginePrefs({ userDataDir: dir, providers: PROVIDERS });
  assert.deepEqual(b.userDisconnected(), ["claude"]);
  assert.equal(b.isUserDisconnected("claude"), true);
  b.clearUserDisconnected("claude");
  assert.equal(createEnginePrefs({ userDataDir: dir, providers: PROVIDERS }).isUserDisconnected("claude"), false);

  fs.writeFileSync(path.join(dir, PREFS_FILENAME), "{not json");
  assert.deepEqual(b.userDisconnected(), [], "a corrupt file reads as empty");
  fs.writeFileSync(
    path.join(dir, PREFS_FILENAME),
    JSON.stringify({ userDisconnected: ["grok", 7, "evil", "grok"] }),
  );
  assert.deepEqual(b.userDisconnected(), ["grok"]);
});

test("Disconnect survives relaunch: the signed-in CLI is not probed and boots Disconnected", async () => {
  const dir = tmpDir();
  const first = launch(dir);
  await first.ctl.boot();
  assert.equal(first.ctl.getStatus()[0].state, "connected");

  const gone = await first.ctl.disconnect("claude");
  assert.equal(gone.state, "disconnected");
  assert.deepEqual(first.statusSync.clears, ["claude"], "mirror row cleared");

  const second = launch(dir); // relaunch; the CLI is still signed in
  await second.ctl.boot();
  assert.deepEqual(second.registry.probes, ["grok", "codex"], "claude is not probed");
  const byId = Object.fromEntries(second.ctl.getStatus().map((s) => [s.provider, s]));
  assert.equal(byId.claude.connected, false);
  assert.equal(byId.claude.state, "disconnected");
  assert.equal(byId.grok.state, "connected");
  assert.deepEqual(second.statusSync.clears, ["claude"], "boot re-clears the mirror row");
  assert.deepEqual(second.ctl.connectedProviders(), ["grok", "codex"], "runner won't claim claude");

  // Refresh and window focus don't bring it back either.
  const refreshed = await second.ctl.refresh("claude");
  assert.equal(refreshed.state, "disconnected");
  assert.deepEqual(second.registry.probes, ["grok", "codex"]);
});

test("Connect clears the sticky flag", async () => {
  const dir = tmpDir();
  const app = launch(dir, fakeRegistry(undefined, async (p) => signedIn(p)));
  await app.ctl.disconnect("grok");
  assert.equal(app.prefs.isUserDisconnected("grok"), true);
  const st = await app.ctl.connect("grok");
  assert.equal(st.state, "connected");
  assert.equal(app.prefs.isUserDisconnected("grok"), false);

  const relaunched = launch(dir);
  await relaunched.ctl.boot();
  assert.ok(relaunched.registry.probes.includes("grok"), "probed again after Connect");
});

test("cancelConnect drops the pending sign-in re-probe and returns the cached status", async () => {
  const app = launch(tmpDir());
  const st = await app.ctl.connect("claude"); // opens Terminal; not signed in yet
  assert.equal(st.state, "needs_login");
  assert.deepEqual(app.ctl.pendingLogins(), ["claude"]);

  const cancelled = await app.ctl.cancelConnect("claude");
  assert.deepEqual(app.ctl.pendingLogins(), []);
  assert.equal(cancelled.provider, "claude");
  assert.equal(cancelled.state, "needs_login", "the last known status, unchanged");

  await app.ctl.onWindowFocus();
  assert.deepEqual(app.registry.probes, [], "focus no longer re-asks the CLI");
});

test("without cancelConnect, focusing the window re-probes until connected", async () => {
  let t = 0;
  const app = launch(tmpDir(), undefined, { now: () => t });
  await app.ctl.connect("grok");
  await app.ctl.onWindowFocus();
  assert.deepEqual(app.registry.probes, ["grok"]);
  assert.deepEqual(app.ctl.pendingLogins(), [], "connected → no longer pending");

  await app.ctl.connect("codex");
  t = 31 * 60 * 1000;
  await app.ctl.onWindowFocus();
  assert.deepEqual(app.registry.probes, ["grok"], "an old Connect is dropped, not probed");
});

test("Refresh never rejects: a failing probe records and returns an error status", async () => {
  const registry = fakeRegistry(async () => {
    throw new Error("spawn claude ENOENT");
  });
  const logs = [];
  const app = launch(tmpDir(), registry, { log: (m) => logs.push(m) });
  const st = await app.ctl.refresh("claude");
  assert.equal(st.provider, "claude");
  assert.equal(st.connected, false);
  assert.equal(st.state, "error");
  assert.equal(app.store.read("claude").state, "error", "cached for getStatus");
  assert.deepEqual(app.statusSync.puts, [{ provider: "claude", state: "error" }], "mirror told");
  assert.equal(app.notified.at(-1).state, "error", "cards told");
  assert.ok(logs.some((m) => m.includes("ENOENT")));
});

test("Refresh still resolves when even saving the error status fails", async () => {
  const registry = fakeRegistry(async () => {
    throw new Error("boom");
  });
  const app = launch(tmpDir(), registry);
  app.store.write = () => {
    throw new Error("disk full");
  };
  const st = await app.ctl.refresh("grok");
  assert.equal(st.state, "error");
});

test("unknown providers are answered without touching a CLI", async () => {
  const app = launch(tmpDir());
  assert.equal((await app.ctl.refresh("evil")).state, "disconnected");
  assert.equal((await app.ctl.cancelConnect("evil")).state, "disconnected");
  assert.equal((await app.ctl.connect("evil")).state, "disconnected");
  assert.deepEqual(app.registry.probes, []);
});
