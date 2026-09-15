/**
 * Codex harness adapter — detect/status shell.
 * Assumes Claude-like CLI auth verbs (`auth status` / `whoami` / login) for Connect IPC.
 * Not production-proven against a real Codex CLI yet; Claude remains the deep path.
 */
const { promisify } = require("util");
const childProcess = require("child_process");
const defaultExecFile = promisify(childProcess.execFile);

const INSTALL_URL = "https://github.com/openai/codex";

function createCodexHarness({ execFile = defaultExecFile } = {}) {
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
    const res = await run(whichCmd, ["codex"]);
    if (res.code !== 0) return { installed: false, binaryPath: null };
    const binaryPath =
      res.stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean) || null;
    return { installed: Boolean(binaryPath), binaryPath };
  }

  function parseHint(text) {
    const m =
      text.match(/Logged in as\s+(\S+)/i) ||
      text.match(/account:\s*(\S+)/i) ||
      text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    return m ? m[1] : null;
  }

  async function probeAuth(binaryPath) {
    const bin = binaryPath || "codex";
    for (const args of [["auth", "status"], ["whoami"]]) {
      const res = await run(bin, args);
      if (res.code === 0) {
        return {
          authenticated: true,
          accountHint: parseHint(res.stdout + "\n" + res.stderr),
        };
      }
    }
    return { authenticated: false, accountHint: null };
  }

  async function startLogin(binaryPath) {
    const bin = binaryPath || "codex";
    await run(bin, ["auth", "login"]);
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
