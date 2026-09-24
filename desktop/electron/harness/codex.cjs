/**
 * Codex harness adapter (@openai/codex).
 *
 * Real CLI auth contract (see https://developers.openai.com/codex/auth):
 * - Detect: enriched PATH which/where + absolute candidates → codex
 * - Probe: `codex login status` — exit 0 ⇒ authenticated; parse stdout for
 *   account/method hint (email, "ChatGPT", or "API key")
 * - Login: `codex login` (browser OAuth). Prefer this for Desktop Connect.
 *   If TVASHTR_HARNESS_DEVICE_AUTH=1, use `codex login --device-auth` (headless).
 *   Login is spawn/detached fire-and-forget (interactive browser) then re-probe —
 *   never treat it as a 15s blocking execFile success path.
 * - M-subs-desktop: every spawn (which, status, login) uses the shared clean env + enriched PATH
 *   (no API keys, no inherited Claude Code session vars). Behaviour otherwise unchanged.
 */
const { promisify } = require("util");
const childProcess = require("child_process");
const defaultExecFile = promisify(childProcess.execFile);
const defaultSpawn = childProcess.spawn;
const { detectCliBinary } = require("./pathDetect.cjs");
const { resolveCliEnv } = require("./spawnEnv.cjs");

const INSTALL_URL = "https://developers.openai.com/codex";

function createCodexHarness({
  execFile = defaultExecFile,
  spawn = defaultSpawn,
  env = process.env,
  homedir,
  platform = process.platform,
  pathExists,
  listDir,
  npmGlobalBin,
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
    return detectCliBinary("codex", {
      execFile,
      env,
      homedir,
      platform,
      pathExists,
      listDir,
      npmGlobalBin,
    });
  }

  function parseHint(text) {
    const email = text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    if (email) return email[1];
    if (/\bChatGPT\b/i.test(text)) return "ChatGPT";
    if (/\bAPI\s*key\b/i.test(text)) return "API key";
    const m =
      text.match(/Logged in as\s+(\S+)/i) ||
      text.match(/account:\s*(\S+)/i) ||
      text.match(/method:\s*(\S+)/i);
    return m ? m[1] : null;
  }

  async function probeAuth(binaryPath) {
    const bin = binaryPath || "codex";
    const res = await run(bin, ["login", "status"]);
    if (res.code === 0) {
      return {
        authenticated: true,
        accountHint: parseHint(res.stdout + "\n" + res.stderr),
      };
    }
    return { authenticated: false, accountHint: null };
  }

  function loginArgs() {
    if (String(env.TVASHTR_HARNESS_DEVICE_AUTH || "") === "1") {
      return ["login", "--device-auth"];
    }
    return ["login"];
  }

  /** Fire-and-forget: interactive browser login must not block on execFile. */
  async function startLogin(binaryPath) {
    const bin = binaryPath || "codex";
    const args = loginArgs();
    const child = spawn(bin, args, {
      detached: true,
      stdio: "ignore",
      env: await childEnv(),
    });
    if (child && typeof child.unref === "function") child.unref();
  }

  async function toStatus() {
    const checked_at = new Date().toISOString();
    const det = await detect();
    if (!det.installed) {
      return {
        provider: "codex",
        connected: false,
        state: "needs_install",
        account_hint: null,
        source: null,
        checked_at,
      };
    }
    const auth = await probeAuth(det.binaryPath);
    if (!auth.authenticated) {
      return {
        provider: "codex",
        connected: false,
        state: "needs_login",
        account_hint: null,
        source: "harness",
        checked_at,
      };
    }
    return {
      provider: "codex",
      connected: true,
      state: "connected",
      account_hint: auth.accountHint,
      source: "harness",
      checked_at,
    };
  }

  async function connect() {
    const det = await detect();
    if (!det.installed) return toStatus();
    const auth = await probeAuth(det.binaryPath);
    if (!auth.authenticated) {
      try {
        await startLogin(det.binaryPath);
      } catch {
        /* re-probe below */
      }
    }
    return toStatus();
  }

  return { id: "codex", detect, probeAuth, startLogin, toStatus, connect, INSTALL_URL };
}

module.exports = { createCodexHarness };
