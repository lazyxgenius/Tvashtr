/**
 * Grok harness contract (M-subs-desktop A2/F5): status comes from `grok models` only — no
 * auth-file read, no XAI_API_KEY shortcut; Connect opens `grok login` in Terminal.
 *
 * Run: node --test desktop/scripts/harness-grok.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createGrokHarness } = require("../electron/harness/grok.cjs");
const { createRegistry } = require("../electron/harness/registry.cjs");

function execModels(stdout, code = 0) {
  return async (cmd, args) => {
    if (cmd === "which" && args[0] === "grok") return { stdout: "/usr/local/bin/grok\n" };
    if (args[0] === "models") {
      if (code === 0) return { stdout };
      const e = new Error("exit");
      e.code = code;
      e.stdout = stdout;
      throw e;
    }
    const err = new Error(`unexpected ${cmd} ${args.join(" ")}`);
    err.code = 1;
    throw err;
  };
}

test("`grok models` without the not-authenticated phrase → connected", async () => {
  const st = await createGrokHarness({
    execFile: execModels("Default model: grok-4.7\n\nAvailable models:\n  * grok-4.7\n"),
    env: {},
    npmGlobalBin: null,
  }).toStatus();
  assert.equal(st.provider, "grok");
  assert.equal(st.connected, true);
  assert.equal(st.state, "connected");
  assert.equal(st.account_hint, "Grok subscription");
});

test("`grok models` saying 'You are not authenticated' (exit 0) → needs_login", async () => {
  const st = await createGrokHarness({
    execFile: execModels("You are not authenticated.\n\nDefault model: grok-4.7\n"),
    env: {},
    npmGlobalBin: null,
  }).toStatus();
  assert.equal(st.state, "needs_login");
  assert.equal(st.connected, false);
});

test("a failing `grok models` → needs_login", async () => {
  const st = await createGrokHarness({ execFile: execModels("boom", 2), env: {}, npmGlobalBin: null }).toStatus();
  assert.equal(st.state, "needs_login");
});

test("missing install → needs_install", async () => {
  const execMissing = async (cmd) => {
    const e = new Error("not found");
    e.code = 1;
    if (cmd === "which") throw e;
    throw new Error("no");
  };
  const st = await createGrokHarness({
    execFile: execMissing,
    env: {},
    npmGlobalBin: null,
    pathExists: async () => false,
    listDir: async () => [],
    homedir: () => "/nonexistent-home",
  }).toStatus();
  assert.equal(st.state, "needs_install");
});

test("Connect opens `grok login` (or --device-auth when asked) in Terminal", async () => {
  const opened = [];
  const openTerminal = async (req) => opened.push(req);
  await createGrokHarness({
    execFile: execModels("You are not authenticated\n"),
    env: {},
    npmGlobalBin: null,
    openTerminal,
  }).connect();
  await createGrokHarness({
    execFile: execModels("You are not authenticated\n"),
    env: { TVASHTR_HARNESS_DEVICE_AUTH: "1" },
    npmGlobalBin: null,
    openTerminal,
  }).connect();
  assert.equal(opened[0].binaryPath, "/usr/local/bin/grok");
  assert.deepEqual(opened[0].args, ["login"]);
  assert.deepEqual(opened[1].args, ["login", "--device-auth"]);
});

test("INSTALL_URL + registry order", () => {
  assert.equal(createGrokHarness({}).INSTALL_URL, "https://docs.x.ai/build/cli/reference");
  const reg = createRegistry({ env: {} });
  assert.equal(reg.get("grok").id, "grok");
  assert.deepEqual(reg.list(), ["claude", "grok", "codex"]);
});
