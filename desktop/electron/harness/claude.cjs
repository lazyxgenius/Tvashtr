/**
 * Claude Code harness adapter (M-subs-desktop).
 *
 * Asks the user's OWN, unmodified `claude` CLI — never a credential file, never the Keychain:
 * - Detect: enriched-PATH `which` + vendor installer dirs (`~/.local/bin`, `~/.claude/local`).
 * - Status: `claude auth status --json` → `loggedIn` + `authMethod`. Only a `claude.ai`
 *   subscription login counts as connected; a CLI on an API key reads state `api_key` (A2).
 * - Connect: opens `claude auth login` in the user's Terminal (the vendor's own sign-in flow)
 *   and returns immediately; the main process re-probes when the window regains focus.
 * - Every spawn uses the clean env (no API keys, no inherited Claude Code session vars).
 */
const { promisify } = require("util");
const childProcess = require("child_process");
const defaultExecFile = promisify(childProcess.execFile);
const { detectCliBinary } = require("./pathDetect.cjs");
const { resolveCliEnv } = require("./spawnEnv.cjs");
const { openLoginInTerminal } = require("./terminalLogin.cjs");

const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/overview";
const SUBSCRIPTION_AUTH_METHOD = "claude.ai";

/** A non-identifying plan hint for the card — never the account email. */
function planHint(subscriptionType) {
  const t = String(subscriptionType || "").trim().toLowerCase();
  const names = { pro: "Claude Pro", max: "Claude Max", team: "Claude Team", enterprise: "Claude Enterprise" };
  return names[t] || "Claude subscription";
}

/**
 * Parse `claude auth status --json` defensively (pure, unit-tested).
 * @returns {{ authenticated: boolean, subscription: boolean, authMethod: string|null, accountHint: string|null }}
 */
function parseAuthStatus(stdout) {
  let data = null;
  try {
    data = JSON.parse(String(stdout || "").trim());
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object" || data.loggedIn !== true) {
    return { authenticated: false, subscription: false, authMethod: null, accountHint: null };
  }
  const authMethod = typeof data.authMethod === "string" ? data.authMethod : null;
  const subscription = authMethod === SUBSCRIPTION_AUTH_METHOD;
  return {
    authenticated: true,
    subscription,
    authMethod,
    accountHint: subscription ? planHint(data.subscriptionType) : "Signed in with an API key",
  };
}

function createClaudeHarness({
  execFile = defaultExecFile,
  env = process.env,
  homedir,
  platform = process.platform,
  pathExists,
  listDir,
  npmGlobalBin,
  openTerminal = openLoginInTerminal,
  loginScriptDir,
} = {}) {
  const childEnv = () =>
    resolveCliEnv({ env, homedir, platform, listDir, npmGlobalBin: npmGlobalBin ?? null });

  async function run(cmd, args) {
    const runEnv = await childEnv();
    try {
      const { stdout, stderr } = await execFile(cmd, args, {
        timeout: 15000,
        encoding: "utf8",
        env: runEnv,
      });
      return { stdout: String(stdout || ""), stderr: String(stderr || ""), code: 0 };
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && (err.stdout !== undefined || err.stderr !== undefined || err.code !== undefined)) {
        return {
          stdout: String(err.stdout || ""),
          stderr: String(err.stderr || ""),
          code: typeof err.code === "number" ? err.code : 1,
        };
      }
      throw e;
    }
  }

  async function detect() {
    return detectCliBinary("claude", {
      execFile,
      env,
      homedir,
      platform,
      pathExists,
      listDir,
      npmGlobalBin,
    });
  }

  async function probeAuth(binaryPath) {
    const res = await run(binaryPath || "claude", ["auth", "status", "--json"]);
    return parseAuthStatus(res.stdout);
  }

  async function startLogin(binaryPath) {
    await openTerminal({
      provider: "claude",
      binaryPath: binaryPath || "claude",
      args: ["auth", "login"],
      env: await childEnv(),
      scriptDir: loginScriptDir,
    });
  }

  function statusFrom(det, auth) {
    const checked_at = new Date().toISOString();
    if (!det.installed) {
      return {
        provider: "claude",
        connected: false,
        state: "needs_install",
        account_hint: null,
        source: null,
        checked_at,
      };
    }
    if (!auth.authenticated) {
      return {
        provider: "claude",
        connected: false,
        state: "needs_login",
        account_hint: null,
        source: "harness",
        checked_at,
      };
    }
    if (!auth.subscription) {
      return {
        provider: "claude",
        connected: false,
        state: "api_key",
        account_hint: auth.accountHint,
        source: "harness",
        checked_at,
      };
    }
    return {
      provider: "claude",
      connected: true,
      state: "connected",
      account_hint: auth.accountHint,
      source: "harness",
      checked_at,
    };
  }

  async function toStatus() {
    const det = await detect();
    if (!det.installed) return statusFrom(det, { authenticated: false });
    return statusFrom(det, await probeAuth(det.binaryPath));
  }

  async function connect() {
    const det = await detect();
    if (!det.installed) return statusFrom(det, { authenticated: false });
    const auth = await probeAuth(det.binaryPath);
    if (!auth.subscription) {
      try {
        await startLogin(det.binaryPath);
      } catch {
        /* the card still says needs_login; Refresh re-probes */
      }
    }
    return statusFrom(det, auth);
  }

  return { id: "claude", detect, probeAuth, startLogin, toStatus, connect, INSTALL_URL };
}

module.exports = { createClaudeHarness, parseAuthStatus, planHint };
