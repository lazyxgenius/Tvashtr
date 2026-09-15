/**
 * Run: node desktop/scripts/harness-grok.test.cjs
 *
 * Real Grok CLI contract: primary `grok models` probe; XAI_API_KEY / auth.json
 * fallbacks; `grok login` [--device-auth] via detached spawn. Never expose tokens.
 */
const assert = require("assert");
const path = require("path");
const { createGrokHarness } = require("../electron/harness/grok.cjs");
const { createRegistry } = require("../electron/harness/registry.cjs");

function makeSpawnRecorder() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  return { spawn, calls };
}

function whichOk(cmd, args) {
  if (cmd === "which" && args[0] === "grok") return { stdout: "/usr/local/bin/grok\n", code: 0 };
  return null;
}

async function run() {
  // --- primary: grok models authenticated (exit 0, no "not authenticated") ---
  const execModelsOk = async (cmd, args) => {
    const w = whichOk(cmd, args);
    if (w) return w;
    if (args[0] === "models") {
      return { stdout: "grok-3\ngrok-2\nLogged in as ada@x.ai\n", code: 0 };
    }
    const err = new Error("unexpected " + cmd + " " + args.join(" "));
    err.code = 1;
    throw err;
  };
  const stModels = await createGrokHarness({
    execFile: execModelsOk,
    env: {},
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  }).toStatus();
  assert.strictEqual(stModels.provider, "grok");
  assert.strictEqual(stModels.connected, true);
  assert.strictEqual(stModels.state, "connected");
  assert.strictEqual(stModels.account_hint, "ada@x.ai");
  assert.strictEqual(stModels.source, "harness");

  // --- models says not authenticated (exit 0 but message) → needs_login ---
  const execNotAuth = async (cmd, args) => {
    const w = whichOk(cmd, args);
    if (w) return w;
    if (args[0] === "models") {
      return { stdout: "You are not authenticated. Run grok login.\n", code: 0 };
    }
    const err = new Error("unexpected");
    err.code = 1;
    throw err;
  };
  const stNot = await createGrokHarness({
    execFile: execNotAuth,
    env: {},
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  }).toStatus();
  assert.strictEqual(stNot.state, "needs_login");
  assert.strictEqual(stNot.connected, false);

  // --- XAI_API_KEY fallback when models says not authenticated ---
  const stKey = await createGrokHarness({
    execFile: execNotAuth,
    env: { XAI_API_KEY: "xai-secret-should-never-leak" },
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  }).toStatus();
  assert.strictEqual(stKey.state, "connected");
  assert.strictEqual(stKey.account_hint, "api-key");
  assert.ok(!JSON.stringify(stKey).includes("xai-secret"));

  // --- auth.json session fallback ---
  const authPath = path.join("/tmp/fake-grok-home", "auth.json");
  const stSession = await createGrokHarness({
    execFile: execNotAuth,
    env: { GROK_HOME: "/tmp/fake-grok-home" },
    homedir: () => "/tmp/unused-home",
    readFile: async (p) => {
      assert.strictEqual(p, authPath);
      return JSON.stringify({
        access_token: "tok_SECRET_raw",
        refresh_token: "ref_SECRET",
        email: "user@x.ai",
      });
    },
  }).toStatus();
  assert.strictEqual(stSession.state, "connected");
  assert.strictEqual(stSession.account_hint, "user@x.ai");
  const dumped = JSON.stringify(stSession);
  assert.ok(!dumped.includes("tok_SECRET"), "must never expose access_token");
  assert.ok(!dumped.includes("ref_SECRET"), "must never expose refresh_token");

  // auth.json without safe hint → "session"
  const stSessOnly = await createGrokHarness({
    execFile: execNotAuth,
    env: { GROK_HOME: "/tmp/fake-grok-home" },
    readFile: async () => JSON.stringify({ token: "abc123SECRET" }),
  }).toStatus();
  assert.strictEqual(stSessOnly.state, "connected");
  assert.strictEqual(stSessOnly.account_hint, "session");
  assert.ok(!JSON.stringify(stSessOnly).includes("abc123SECRET"));

  // --- missing install ---
  const execMissing = async (cmd, args) => {
    if (cmd === "which" && args[0] === "grok") {
      const e = new Error("not found");
      e.code = 1;
      throw e;
    }
    throw new Error("no");
  };
  const st2 = await createGrokHarness({ execFile: execMissing, env: {} }).toStatus();
  assert.strictEqual(st2.state, "needs_install");
  assert.strictEqual(st2.connected, false);

  // --- connect triggers `login` via detached spawn ---
  const { spawn, calls: spawnCalls } = makeSpawnRecorder();
  const execLoginProbe = async (cmd, args) => {
    const w = whichOk(cmd, args);
    if (w) return w;
    if (args[0] === "models") {
      return { stdout: "You are not authenticated\n", code: 0 };
    }
    const e = new Error("login should use spawn not execFile");
    e.code = 1;
    throw e;
  };
  await createGrokHarness({
    execFile: execLoginProbe,
    spawn,
    env: {},
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  }).connect();
  assert.strictEqual(spawnCalls.length, 1);
  assert.strictEqual(spawnCalls[0].cmd, "/usr/local/bin/grok");
  assert.deepStrictEqual(spawnCalls[0].args, ["login"]);
  assert.strictEqual(spawnCalls[0].opts.detached, true);

  // --- device-auth env ---
  const { spawn: spawnDev, calls: spawnDevCalls } = makeSpawnRecorder();
  await createGrokHarness({
    execFile: execLoginProbe,
    spawn: spawnDev,
    env: { TVASHTR_HARNESS_DEVICE_AUTH: "1" },
    readFile: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  }).connect();
  assert.deepStrictEqual(spawnDevCalls[0].args, ["login", "--device-auth"]);

  // INSTALL_URL
  assert.strictEqual(
    createGrokHarness({ execFile: execMissing }).INSTALL_URL,
    "https://docs.x.ai/build/cli/reference"
  );

  // --- registry ---
  const reg = createRegistry({ execFile: execModelsOk, env: {} });
  assert.ok(reg.get("grok"));
  assert.strictEqual(reg.get("grok").id, "grok");
  assert.deepStrictEqual(reg.list(), ["claude", "grok", "codex"]);

  console.log("harness-grok.test.cjs OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
