/**
 * Claude harness contract (M-subs-desktop A2): status is asked of the user's own CLI with
 * `claude auth status --json`; only a claude.ai subscription login counts as connected.
 *
 * Run: node --test desktop/scripts/harness-claude.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createClaudeHarness, parseAuthStatus, planHint } = require("../electron/harness/claude.cjs");

function execWith(statusStdout) {
  return async (cmd, args) => {
    if (cmd === "which" && args[0] === "claude") return { stdout: "/usr/local/bin/claude\n" };
    if (args[0] === "auth" && args[1] === "status") return { stdout: statusStdout };
    const err = new Error(`unexpected ${cmd} ${args.join(" ")}`);
    err.code = 1;
    throw err;
  };
}

test("claude.ai subscription login → connected with a plan hint (never the email)", async () => {
  const h = createClaudeHarness({
    execFile: execWith(
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "ada@example.com", subscriptionType: "max" }),
    ),
    env: {},
    npmGlobalBin: null,
  });
  assert.equal((await h.detect()).installed, true);
  const st = await h.toStatus();
  assert.deepEqual(
    { provider: st.provider, connected: st.connected, state: st.state, hint: st.account_hint, source: st.source },
    { provider: "claude", connected: true, state: "connected", hint: "Claude Max", source: "harness" },
  );
  assert.ok(!JSON.stringify(st).includes("ada@example.com"));
});

test("parseAuthStatus: api-key / logged-out / garbage never count as a subscription", () => {
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "api_key" })).subscription, false);
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: true, authMethod: "console" })).subscription, false);
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: false })).authenticated, false);
  assert.equal(parseAuthStatus("Logged in as ada@example.com").authenticated, false);
  assert.equal(parseAuthStatus("").authenticated, false);
  assert.equal(planHint("pro"), "Claude Pro");
  assert.equal(planHint(undefined), "Claude subscription");
});

test("missing CLI → needs_install", async () => {
  const execMissing = async (cmd) => {
    const e = new Error("not found");
    e.code = 1;
    if (cmd === "which") throw e;
    throw new Error("no");
  };
  const st = await createClaudeHarness({
    execFile: execMissing,
    env: {},
    npmGlobalBin: null,
    pathExists: async () => false,
    listDir: async () => [],
    homedir: () => "/nonexistent-home",
  }).toStatus();
  assert.equal(st.state, "needs_install");
  assert.equal(st.connected, false);
});
