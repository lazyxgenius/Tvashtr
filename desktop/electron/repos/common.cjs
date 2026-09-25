/**
 * Shared pieces for the `repos.*` bridge (home-run.md §4, P10): readable errors, path checks and
 * a git runner. Every git call goes through execFile with an argument array (never a shell), in the
 * enriched-PATH child env the vendor CLIs use (harness/spawnEnv.cjs), with prompts and hooks off.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const childProcess = require("child_process");

const defaultExecFile = promisify(childProcess.execFile);

/** An error whose message is safe to show the user as is. `code` is for logs and tests. */
class RepoError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "RepoError";
    this.code = code;
  }
}

/**
 * An absolute path to a directory that exists, normalised. Throws RepoError("invalid_path").
 * @param {unknown} p
 * @returns {string}
 */
function requireDirectory(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0")) {
    throw new RepoError("invalid_path", "Choose a folder on this computer.");
  }
  if (!path.isAbsolute(p)) {
    throw new RepoError("invalid_path", "Choose a folder on this computer.");
  }
  const resolved = path.resolve(p);
  let st;
  try {
    st = fs.statSync(resolved);
  } catch {
    throw new RepoError("invalid_path", "That folder doesn't exist any more.");
  }
  if (!st.isDirectory()) throw new RepoError("invalid_path", "That isn't a folder.");
  return resolved;
}

/**
 * `/Users/ada/code/x` → `~/code/x` (the home dir itself → `~`).
 * @param {string} p @param {string} [home]
 */
function displayPath(p, home = os.homedir()) {
  if (!home) return p;
  const h = home.replace(/[\\/]+$/, "");
  if (p === h) return "~";
  if (p.startsWith(`${h}/`) || p.startsWith(`${h}\\`)) return `~${p.slice(h.length)}`;
  return p;
}

/** Run-id / snapshot-id shape: a UUID (it names a branch and a URL segment). */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * @param {{ execFile?: Function, env?: () => Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv }} [deps]
 */
function createGit({ execFile = defaultExecFile, env = () => process.env } = {}) {
  /**
   * Run git in ``cwd``. Resolves stdout; rejects with the git error (``stderr`` attached). A
   * missing git binary becomes RepoError("git_missing").
   * @param {string} cwd @param {string[]} args @param {{ maxBuffer?: number }} [opts]
   */
  async function run(cwd, args, opts = {}) {
    const base = await env();
    try {
      const { stdout } = await execFile(
        "git",
        ["-c", `core.hooksPath=${os.devNull}`, "-c", "core.fsmonitor=false", ...args],
        {
          cwd,
          env: { ...base, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
          encoding: "utf8",
          maxBuffer: opts.maxBuffer || 64 * 1024 * 1024,
          windowsHide: true,
        },
      );
      return String(stdout || "");
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && err.code === "ENOENT") {
        throw new RepoError(
          "git_missing",
          "Git isn't installed on this computer, or Tvashtr can't find it.",
        );
      }
      throw err;
    }
  }

  /** Like run, but resolves null instead of rejecting on a non-zero exit. */
  async function tryRun(cwd, args, opts) {
    try {
      return await run(cwd, args, opts);
    } catch (e) {
      if (e instanceof RepoError) throw e;
      return null;
    }
  }

  return { run, tryRun };
}

/** First line of a git error, for a readable message. */
function gitErrorLine(e) {
  const err = /** @type {any} */ (e);
  const text = String((err && (err.stderr || err.message)) || e || "");
  const line = text
    .split(/\r?\n/)
    .map((s) => s.replace(/^(fatal|error):\s*/i, "").trim())
    .find(Boolean);
  return line ? line.slice(0, 300) : "git failed";
}

module.exports = { RepoError, requireDirectory, displayPath, createGit, gitErrorLine, UUID_RE };
