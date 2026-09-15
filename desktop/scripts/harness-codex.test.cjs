/**
 * Run: node desktop/scripts/harness-codex.test.cjs
 *
 * Real Codex CLI contract: `codex login status` / `codex login` [--device-auth].
 */
const assert = require("assert");
const { createCodexHarness } = require("../electron/harness/codex.cjs");
const { createRegistry } = require("../electron/harness/registry.cjs");

function makeSpawnRecorder() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  return { spawn, calls };
}

async function run() {
  // --- connected via `login status` exit 0 ---
  const execOk = async (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key === "which codex") return { stdout: "/usr/local/bin/codex\n", code: 0 };
    if (cmd === "/usr/local/bin/codex" && args[0] === "login" && args[1] === "status") {
      return { stdout: "Logged in as ada@example.com via ChatGPT\n", code: 0 };
    }
    if (cmd === "codex" && args[0] === "login" && args[1] === "status") {
      return { stdout: "Logged in as ada@example.com via ChatGPT\n", code: 0 };
    }
    const err = new Error("unexpected " + key);
    err.code = 1;
    throw err;
  };

  const h = createCodexHarness({ execFile: execOk });
  const det = await h.detect();
  assert.strictEqual(det.installed, true);
  const st = await h.toStatus();
  assert.strictEqual(st.provider, "codex");
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.state, "connected");
  assert.strictEqual(st.account_hint, "ada@example.com");
  assert.strictEqual(st.source, "harness");
  assert.strictEqual(h.INSTALL_URL, "https://developers.openai.com/codex");

  // ChatGPT method hint when no email
  const execChatgpt = async (cmd, args) => {
    if (cmd === "which" && args[0] === "codex") return { stdout: "/bin/codex\n", code: 0 };
    if (args[0] === "login" && args[1] === "status") {
      return { stdout: "Authenticated with ChatGPT subscription\n", code: 0 };
    }
    const e = new Error("no");
    e.code = 1;
    throw e;
  };
  const stChat = await createCodexHarness({ execFile: execChatgpt }).toStatus();
  assert.strictEqual(stChat.state, "connected");
  assert.strictEqual(stChat.account_hint, "ChatGPT");

  // --- needs_login when status non-zero ---
  const execNeedsLogin = async (cmd, args) => {
    if (cmd === "which" && args[0] === "codex") return { stdout: "/bin/codex\n", code: 0 };
    if (args[0] === "login" && args[1] === "status") {
      const e = new Error("not logged in");
      e.code = 1;
      e.stdout = "Not logged in\n";
      e.stderr = "";
      throw e;
    }
    const e = new Error("unexpected");
    e.code = 1;
    throw e;
  };
  const stLogin = await createCodexHarness({ execFile: execNeedsLogin }).toStatus();
  assert.strictEqual(stLogin.state, "needs_login");
  assert.strictEqual(stLogin.connected, false);
  assert.strictEqual(stLogin.account_hint, null);

  // --- needs_install ---
  const execMissing = async (cmd, args) => {
    if (cmd === "which" && args[0] === "codex") {
      const e = new Error("not found");
      e.code = 1;
      throw e;
    }
    throw new Error("no");
  };
  const st2 = await createCodexHarness({ execFile: execMissing }).toStatus();
  assert.strictEqual(st2.state, "needs_install");
  assert.strictEqual(st2.connected, false);

  // --- connect triggers `login` via detached spawn (not blocking execFile) ---
  const loginCalls = [];
  const { spawn, calls: spawnCalls } = makeSpawnRecorder();
  const execConnect = async (cmd, args) => {
    if (cmd === "which" && args[0] === "codex") return { stdout: "/bin/codex\n", code: 0 };
    if (args[0] === "login" && args[1] === "status") {
      const e = new Error("not logged in");
      e.code = 1;
      e.stdout = "";
      e.stderr = "";
      throw e;
    }
    // login must NOT go through execFile
    loginCalls.push({ cmd, args });
    const e = new Error("login should use spawn");
    e.code = 1;
    throw e;
  };
  await createCodexHarness({ execFile: execConnect, spawn, env: {} }).connect();
  assert.strictEqual(spawnCalls.length, 1, "connect should spawn login once");
  assert.strictEqual(spawnCalls[0].cmd, "/bin/codex");
  assert.deepStrictEqual(spawnCalls[0].args, ["login"]);
  assert.strictEqual(spawnCalls[0].opts.detached, true);
  assert.strictEqual(loginCalls.length, 0, "login must not use execFile");

  // --- device-auth env ---
  const { spawn: spawnDev, calls: spawnDevCalls } = makeSpawnRecorder();
  await createCodexHarness({
    execFile: execConnect,
    spawn: spawnDev,
    env: { TVASHTR_HARNESS_DEVICE_AUTH: "1" },
  }).connect();
  assert.strictEqual(spawnDevCalls.length, 1);
  assert.deepStrictEqual(spawnDevCalls[0].args, ["login", "--device-auth"]);

  // --- registry ---
  const reg = createRegistry({ execFile: execOk });
  assert.ok(reg.get("codex"));
  assert.strictEqual(reg.get("codex").id, "codex");
  assert.deepStrictEqual(reg.list(), ["claude", "grok", "codex"]);

  console.log("harness-codex.test.cjs OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
