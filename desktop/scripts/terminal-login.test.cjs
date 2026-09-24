/**
 * Connect opens the vendor's own login in Terminal (M-subs-desktop §3.0): the launcher script holds
 * COMMANDS only — it unsets API keys / Claude Code session vars and never contains a token.
 *
 * Run: node --test desktop/scripts/terminal-login.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { buildLoginScript, openLoginInTerminal } = require("../electron/harness/terminalLogin.cjs");

test("launcher script: clean env, enriched PATH, the vendor's own login command", () => {
  const script = buildLoginScript({
    provider: "claude",
    binaryPath: "/Users/me/.local/bin/claude",
    args: ["auth", "login"],
    pathValue: "/Users/me/.local/bin:/usr/bin:/bin",
  });
  assert.match(script, /^#!\/bin\/sh/);
  assert.match(script, /unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN XAI_API_KEY OPENAI_API_KEY CLAUDECODE/);
  assert.match(script, /CLAUDE_CODE_\[A-Za-z0-9_\]\*/);
  assert.match(script, /PATH='\/Users\/me\/\.local\/bin:\/usr\/bin:\/bin'; export PATH/);
  assert.match(script, /'\/Users\/me\/\.local\/bin\/claude' 'auth' 'login'/);
  assert.match(script, /never sees or stores your login/);
  assert.doesNotMatch(script, /setup-token|OAUTH_TOKEN=|sk-ant/);
});

test("macOS: writes a private .command launcher and asks Terminal to open it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-login-"));
  const calls = [];
  const res = await openLoginInTerminal({
    provider: "grok",
    binaryPath: "/Users/me/.grok/bin/grok",
    args: ["login"],
    env: { PATH: "/usr/bin:/bin" },
    platform: "darwin",
    scriptDir: dir,
    execFile: async (cmd, args, opts) => calls.push({ cmd, args, opts }),
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "open");
  assert.deepEqual(calls[0].args, ["-a", "Terminal", res.script]);
  const st = fs.statSync(res.script);
  assert.equal(st.mode & 0o777, 0o700);
  assert.match(fs.readFileSync(res.script, "utf8"), /'\/Users\/me\/\.grok\/bin\/grok' 'login'/);
});
