/**
 * M-subs-desktop §3.0 compliance + F3/F5/A2 for the Claude / Grok / Codex harnesses.
 *
 * - Every spawn (which, status probe, login) runs with a CLEAN env: no API keys, no inherited
 *   Claude Code session vars, and the enriched PATH (Dock launch ≠ Terminal).
 * - "Logged in" is asked of the CLI itself. Grok never reads ~/.grok/auth.json, and an
 *   XAI_API_KEY is not a subscription. Claude counts only a claude.ai subscription login.
 * - Connect opens the vendor's own login in Terminal and never blocks the main process.
 *
 * Run: node --test desktop/scripts/harness-compliance.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createClaudeHarness } = require("../electron/harness/claude.cjs");
const { createGrokHarness } = require("../electron/harness/grok.cjs");
const { createCodexHarness } = require("../electron/harness/codex.cjs");

const DOCK_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

// Everything the brief says must never reach a vendor CLI child.
const LEAKY_ENV = {
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  CLAUDE_CODE_SESSION_ID: "session-123",
  CLAUDE_CODE_MESSAGING_TOKEN: "msg-token",
  ANTHROPIC_API_KEY: "sk-ant-api03-leak",
  ANTHROPIC_AUTH_TOKEN: "auth-token-leak",
  CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-leak",
  XAI_API_KEY: "xai-leak",
  OPENAI_API_KEY: "sk-openai-leak",
};
const MUST_BE_STRIPPED = Object.keys(LEAKY_ENV);

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tv-home-"));
}

function baseEnv(home) {
  return { PATH: DOCK_PATH, HOME: home, KEEP_ME: "yes", ...LEAKY_ENV };
}

function assertCleanChildEnv(opts, home, label) {
  assert.ok(opts && opts.env, `${label}: spawn must pass an explicit env (not inherit process.env)`);
  for (const key of MUST_BE_STRIPPED) {
    assert.equal(opts.env[key], undefined, `${label}: ${key} leaked into the child env`);
  }
  assert.equal(opts.env.KEEP_ME, "yes", `${label}: unrelated vars are kept`);
  const parts = String(opts.env.PATH || "").split(":");
  assert.ok(parts.includes(path.join(home, ".local", "bin")), `${label}: PATH is enriched`);
  assert.ok(parts.includes(path.join(home, ".grok", "bin")), `${label}: PATH has vendor dirs`);
  assert.ok(parts.includes("/usr/bin"), `${label}: the original PATH is kept`);
}

function recorder(responder) {
  const calls = [];
  async function execFile(cmd, args, opts) {
    calls.push({ cmd, args: [...args], opts });
    const out = responder(cmd, args);
    if (out instanceof Error) throw out;
    return out;
  }
  return { calls, execFile };
}

function exitError(code, stdout = "", stderr = "") {
  const e = new Error(`exit ${code}`);
  e.code = code;
  e.stdout = stdout;
  e.stderr = stderr;
  return e;
}

// ---------------------------------------------------------------- Claude

function claudeResponder(statusJson) {
  return (cmd, args) => {
    if (cmd === "which") return { stdout: "/opt/fake/claude\n", stderr: "" };
    if (args[0] === "auth" && args[1] === "status") {
      return { stdout: JSON.stringify(statusJson), stderr: "" };
    }
    return exitError(1, "", `unexpected ${cmd} ${args.join(" ")}`);
  };
}

test("claude: every spawn runs with a clean env + enriched PATH (F3)", async () => {
  const home = tmpHome();
  const { calls, execFile } = recorder(
    claudeResponder({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }),
  );
  const h = createClaudeHarness({
    execFile,
    env: baseEnv(home),
    homedir: () => home,
    platform: "darwin",
    npmGlobalBin: null,
  });
  await h.toStatus();
  assert.ok(calls.length >= 2, "which + auth status");
  for (const c of calls) assertCleanChildEnv(c.opts, home, `${c.cmd} ${c.args.join(" ")}`);
});

test("claude: status comes from `claude auth status --json` (A2)", async () => {
  const home = tmpHome();
  const { calls, execFile } = recorder(
    claudeResponder({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }),
  );
  const h = createClaudeHarness({ execFile, env: baseEnv(home), homedir: () => home, npmGlobalBin: null });
  const st = await h.toStatus();
  const probe = calls.find((c) => c.args[0] === "auth");
  assert.deepEqual(probe.args, ["auth", "status", "--json"]);
  assert.equal(st.connected, true);
  assert.equal(st.state, "connected");
  assert.equal(st.account_hint, "Claude Pro", "a non-identifying plan hint, never the email");
  assert.equal(calls.filter((c) => c.args[0] === "whoami").length, 0, "no invented flags");
});

test("claude: a CLI signed in with an API key is NOT a subscription (A2)", async () => {
  const home = tmpHome();
  const { execFile } = recorder(
    claudeResponder({ loggedIn: true, authMethod: "api_key", apiProvider: "firstParty" }),
  );
  const h = createClaudeHarness({ execFile, env: baseEnv(home), homedir: () => home, npmGlobalBin: null });
  const st = await h.toStatus();
  assert.equal(st.connected, false);
  assert.equal(st.state, "api_key");
});

test("claude: loggedIn false (even on exit 0) reads needs_login", async () => {
  const home = tmpHome();
  const { execFile } = recorder(claudeResponder({ loggedIn: false }));
  const h = createClaudeHarness({ execFile, env: baseEnv(home), homedir: () => home, npmGlobalBin: null });
  const st = await h.toStatus();
  assert.equal(st.connected, false);
  assert.equal(st.state, "needs_login");
});

test("claude: Connect opens the vendor login in Terminal and never runs a blocking login", async () => {
  const home = tmpHome();
  const { calls, execFile } = recorder(claudeResponder({ loggedIn: false }));
  const opened = [];
  const h = createClaudeHarness({
    execFile,
    env: baseEnv(home),
    homedir: () => home,
    npmGlobalBin: null,
    openTerminal: async (req) => {
      opened.push(req);
    },
  });
  const st = await h.connect();
  assert.equal(opened.length, 1, "Terminal opened once");
  assert.equal(opened[0].binaryPath, "/opt/fake/claude");
  assert.deepEqual(opened[0].args, ["auth", "login"]);
  assertCleanChildEnv({ env: opened[0].env }, home, "terminal login env");
  assert.equal(
    calls.filter((c) => c.args[0] === "auth" && c.args[1] === "login").length,
    0,
    "no execFile(claude auth login) — login happens in the vendor's own flow in Terminal",
  );
  assert.equal(st.connected, false);
  assert.equal(st.state, "needs_login");
});

// ---------------------------------------------------------------- Grok

function grokResponder(modelsStdout) {
  return (cmd, args) => {
    if (cmd === "which") return { stdout: "/opt/fake/grok\n", stderr: "" };
    if (args[0] === "models") return { stdout: modelsStdout, stderr: "" };
    return exitError(1, "", `unexpected ${cmd} ${args.join(" ")}`);
  };
}

const GROK_LOGGED_OUT = "You are not authenticated.\n\nDefault model: grok-4.7\n";
const GROK_LOGGED_IN = "Default model: grok-4.7\n\nAvailable models:\n  * grok-4.7 (default)\n";

test("grok: XAI_API_KEY alone does NOT make Grok connected — an API key is not a subscription (F5)", async () => {
  const home = tmpHome();
  const { execFile } = recorder(grokResponder(GROK_LOGGED_OUT));
  const h = createGrokHarness({
    execFile,
    env: { PATH: DOCK_PATH, HOME: home, XAI_API_KEY: "xai-real-looking-key" },
    homedir: () => home,
    npmGlobalBin: null,
    readFile: async () => JSON.stringify({ access_token: "tok", email: "a@b.c" }),
  });
  const st = await h.toStatus();
  assert.equal(st.connected, false);
  assert.equal(st.state, "needs_login");
});

test("grok: never reads a vendor credential file (~/.grok/auth.json) (F5)", async () => {
  const home = tmpHome();
  const { execFile } = recorder(grokResponder(GROK_LOGGED_OUT));
  let reads = 0;
  const h = createGrokHarness({
    execFile,
    env: { PATH: DOCK_PATH, HOME: home },
    homedir: () => home,
    npmGlobalBin: null,
    readFile: async () => {
      reads += 1;
      return JSON.stringify({ access_token: "tok" });
    },
  });
  const st = await h.toStatus();
  assert.equal(reads, 0, "auth.json must never be read");
  assert.equal(st.connected, false);
});

test("grok: `grok models` without the not-authenticated phrase reads connected", async () => {
  const home = tmpHome();
  const { calls, execFile } = recorder(grokResponder(GROK_LOGGED_IN));
  const h = createGrokHarness({ execFile, env: baseEnv(home), homedir: () => home, npmGlobalBin: null });
  const st = await h.toStatus();
  assert.equal(st.connected, true);
  assert.equal(st.state, "connected");
  for (const c of calls) assertCleanChildEnv(c.opts, home, `${c.cmd} ${c.args.join(" ")}`);
});

test("grok: Connect opens `grok login` in Terminal (no detached background login)", async () => {
  const home = tmpHome();
  const { execFile } = recorder(grokResponder(GROK_LOGGED_OUT));
  const opened = [];
  let spawned = 0;
  const h = createGrokHarness({
    execFile,
    env: baseEnv(home),
    homedir: () => home,
    npmGlobalBin: null,
    spawn: () => {
      spawned += 1;
      return { unref() {} };
    },
    openTerminal: async (req) => {
      opened.push(req);
    },
  });
  await h.connect();
  assert.equal(spawned, 0);
  assert.equal(opened.length, 1);
  assert.equal(opened[0].binaryPath, "/opt/fake/grok");
  assert.deepEqual(opened[0].args, ["login"]);
  assertCleanChildEnv({ env: opened[0].env }, home, "grok terminal login env");
});

// ---------------------------------------------------------------- Codex (shared helpers only)

test("codex: status probe also runs with the clean env (shared helper; behaviour unchanged)", async () => {
  const home = tmpHome();
  const { calls, execFile } = recorder((cmd, args) => {
    if (cmd === "which") return { stdout: "/opt/fake/codex\n", stderr: "" };
    if (args[0] === "login" && args[1] === "status") {
      return { stdout: "Logged in using ChatGPT\n", stderr: "" };
    }
    return exitError(1);
  });
  const h = createCodexHarness({ execFile, env: baseEnv(home), homedir: () => home, npmGlobalBin: null });
  const st = await h.toStatus();
  assert.equal(st.connected, true);
  for (const c of calls) assertCleanChildEnv(c.opts, home, `${c.cmd} ${c.args.join(" ")}`);
});
