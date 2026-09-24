/**
 * Grok Build harness adapter (M-subs-desktop).
 *
 * Asks the user's OWN, unmodified `grok` CLI — never a credential file, never an API key:
 * - Detect: enriched-PATH `which` + vendor installer dirs (the xAI installer's `~/.grok/bin`).
 * - Status: `grok models` (the CLI has no status command). It exits 0 even when logged out and then
 *   prints "You are not authenticated" — that phrase ⇒ needs_login; exit 0 without it ⇒ connected.
 *   There is NO auth-file fallback and NO XAI_API_KEY fallback: an API key is not a subscription,
 *   and ~/.grok/ is never read (F5). The probe's env has XAI_API_KEY stripped, so the answer is
 *   about the user's own Grok sign-in.
 * - Connect: opens `grok login` in the user's Terminal and returns immediately (A2/§3.0).
 */
const { promisify } = require("util");
const childProcess = require("child_process");
const { detectCliBinary } = require("./pathDetect.cjs");
const { resolveCliEnv } = require("./spawnEnv.cjs");
const { openLoginInTerminal } = require("./terminalLogin.cjs");

const defaultExecFile = promisify(childProcess.execFile);

const INSTALL_URL = "https://docs.x.ai/build/cli/reference";
const NOT_AUTH_RE = /You are not authenticated/i;

function createGrokHarness({
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
        timeout: 20000,
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
    return detectCliBinary("grok", {
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
    const res = await run(binaryPath || "grok", ["models"]);
    const text = `${res.stdout}\n${res.stderr}`;
    if (res.code === 0 && !NOT_AUTH_RE.test(text)) {
      return { authenticated: true, accountHint: "Grok subscription" };
    }
    return { authenticated: false, accountHint: null };
  }

  function loginArgs() {
    return String(env.TVASHTR_HARNESS_DEVICE_AUTH || "") === "1"
      ? ["login", "--device-auth"]
      : ["login"];
  }

  async function startLogin(binaryPath) {
    await openTerminal({
      provider: "grok",
      binaryPath: binaryPath || "grok",
      args: loginArgs(),
      env: await childEnv(),
      scriptDir: loginScriptDir,
    });
  }

  function statusFrom(det, auth) {
    const checked_at = new Date().toISOString();
    if (!det.installed) {
      return {
        provider: "grok",
        connected: false,
        state: "needs_install",
        account_hint: null,
        source: null,
        checked_at,
      };
    }
    if (!auth.authenticated) {
      return {
        provider: "grok",
        connected: false,
        state: "needs_login",
        account_hint: null,
        source: "harness",
        checked_at,
      };
    }
    return {
      provider: "grok",
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
    if (!auth.authenticated) {
      try {
        await startLogin(det.binaryPath);
      } catch {
        /* the card still says needs_login; Refresh re-probes */
      }
    }
    return statusFrom(det, auth);
  }

  return { id: "grok", detect, probeAuth, startLogin, toStatus, connect, INSTALL_URL };
}

module.exports = { createGrokHarness };
