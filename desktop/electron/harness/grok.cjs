/**
 * Grok harness adapter (grok / @xai-official/grok).
 *
 * Real CLI auth contract (see https://docs.x.ai/build/cli/reference):
 * - Detect: which/where → grok
 * - No official `login status`. Probe in order:
 *   1. Primary: `grok models` — exits 0 even when logged out; stdout/stderr
 *      containing "You are not authenticated" ⇒ unauthenticated. Exit 0 without
 *      that phrase ⇒ authenticated (parse safe account hint if present).
 *   2. Fallback: non-empty XAI_API_KEY env → authenticated, accountHint "api-key"
 *      (API-key path; still useful for local Connect detection)
 *   3. Fallback: auth file at $GROK_HOME/auth.json or ~/.grok/auth.json — if
 *      present and JSON has a session-like field, treat as authenticated.
 *      Never return raw tokens; account_hint from safe fields or "session"
 *   4. Else unauthenticated
 * - Login: `grok login`. If TVASHTR_HARNESS_DEVICE_AUTH=1, use `--device-auth`.
 *   Login is spawn/detached fire-and-forget then re-probe — never a blocking
 *   15s execFile success path.
 */
const { promisify } = require("util");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const defaultExecFile = promisify(childProcess.execFile);
const defaultReadFile = promisify(fs.readFile);
const defaultSpawn = childProcess.spawn;

const INSTALL_URL = "https://docs.x.ai/build/cli/reference";

const SAFE_HINT_KEYS = ["email", "account", "user", "login", "name"];
const NOT_AUTH_RE = /You are not authenticated/i;

function hasSessionLike(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (obj.access_token || obj.token || obj.refresh_token || obj.session) return true;
  if (obj.auth && typeof obj.auth === "object") {
    const a = obj.auth;
    if (a.access_token || a.token || a.refresh_token || a.session) return true;
  }
  return false;
}

function safeAccountHint(obj) {
  if (!obj || typeof obj !== "object") return "session";
  for (const key of SAFE_HINT_KEYS) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim();
  }
  if (obj.auth && typeof obj.auth === "object") {
    for (const key of SAFE_HINT_KEYS) {
      if (typeof obj.auth[key] === "string" && obj.auth[key].trim()) {
        return obj.auth[key].trim();
      }
    }
  }
  return "session";
}

function parseModelsHint(text) {
  const email = text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
  if (email) return email[1];
  const m =
    text.match(/Logged in as\s+(\S+)/i) ||
    text.match(/account:\s*(\S+)/i) ||
    text.match(/user:\s*(\S+)/i);
  return m ? m[1] : null;
}

function createGrokHarness({
  execFile = defaultExecFile,
  spawn = defaultSpawn,
  readFile = defaultReadFile,
  homedir = () => os.homedir(),
  env = process.env,
} = {}) {
  async function run(cmd, args) {
    try {
      const { stdout, stderr } = await execFile(cmd, args, {
        timeout: 15000,
        encoding: "utf8",
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
    const whichCmd = process.platform === "win32" ? "where" : "which";
    const res = await run(whichCmd, ["grok"]);
    if (res.code !== 0) return { installed: false, binaryPath: null };
    const binaryPath =
      res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || null;
    return { installed: Boolean(binaryPath), binaryPath };
  }

  function authFilePath() {
    const base = env.GROK_HOME || path.join(homedir(), ".grok");
    return path.join(base, "auth.json");
  }

  async function probeAuthFile() {
    try {
      const raw = await readFile(authFilePath(), "utf8");
      const data = JSON.parse(String(raw));
      if (!hasSessionLike(data)) return { authenticated: false, accountHint: null };
      return { authenticated: true, accountHint: safeAccountHint(data) };
    } catch {
      return { authenticated: false, accountHint: null };
    }
  }

  async function probeModels(binaryPath) {
    const bin = binaryPath || "grok";
    const res = await run(bin, ["models"]);
    const text = res.stdout + "\n" + res.stderr;
    if (NOT_AUTH_RE.test(text)) {
      return { authenticated: false, accountHint: null, probed: true };
    }
    if (res.code === 0) {
      return {
        authenticated: true,
        accountHint: parseModelsHint(text),
        probed: true,
      };
    }
    return { authenticated: false, accountHint: null, probed: true };
  }

  async function probeAuth(binaryPath) {
    const models = await probeModels(binaryPath);
    if (models.authenticated) {
      return { authenticated: true, accountHint: models.accountHint };
    }

    const key = env.XAI_API_KEY;
    if (typeof key === "string" && key.trim()) {
      return { authenticated: true, accountHint: "api-key" };
    }

    return probeAuthFile();
  }

  function loginArgs() {
    if (String(env.TVASHTR_HARNESS_DEVICE_AUTH || "") === "1") {
      return ["login", "--device-auth"];
    }
    return ["login"];
  }

  /** Fire-and-forget: interactive browser login must not block on execFile. */
  async function startLogin(binaryPath) {
    const bin = binaryPath || "grok";
    const args = loginArgs();
    const child = spawn(bin, args, {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...env },
    });
    if (child && typeof child.unref === "function") child.unref();
  }

  async function toStatus() {
    const checked_at = new Date().toISOString();
    const det = await detect();
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
    const auth = await probeAuth(det.binaryPath);
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

  return { id: "grok", detect, probeAuth, startLogin, toStatus, connect, INSTALL_URL };
}

module.exports = { createGrokHarness };
