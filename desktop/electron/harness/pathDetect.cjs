/**
 * Shared CLI path probe for Desktop harnesses (Claude / Grok / Codex).
 *
 * Dock-launched Electron often has a minimal PATH (no npm globals, no Homebrew
 * extras) while Terminal shells see them. Enrich PATH and probe absolute
 * candidates so "Needs install" is not a false negative when `which` alone fails.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const childProcess = require("child_process");

const defaultExecFile = promisify(childProcess.execFile);
const defaultAccess = promisify(fs.access);
const defaultReaddir = promisify(fs.readdir);

const FIXED_UNIX_DIRS = ["/usr/local/bin", "/opt/homebrew/bin"];

/**
 * Bin dirs the vendors' OWN installers use, relative to $HOME (M-subs-desktop A1): the xAI Grok
 * installer (`~/.grok/bin`), Claude Code's native installer (`~/.local/bin`) and its older local
 * install (`~/.claude/local`). Under ~/.grok and ~/.claude these bin dirs are the ONLY paths this
 * app ever touches — and only to find/run the executable, never to read any other file.
 */
const VENDOR_BIN_DIRS = Object.freeze([
  [".local", "bin"],
  [".grok", "bin"],
  [".claude", "local"],
]);

/** Child env for `which` / `npm`: the shared clean env (lazy require — spawnEnv needs this module). */
function cleanEnvWithPath(env, pathValue, platform) {
  const { buildChildEnv } = require("./spawnEnv.cjs");
  const out = buildChildEnv(env, { pathDirs: [], platform });
  out.PATH = pathValue;
  return out;
}

/**
 * @param {object} opts
 * @param {() => string} [opts.homedir]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {string} [opts.platform]
 * @param {string|null} [opts.npmGlobalBin] pre-resolved npm global bin (skip npm spawn)
 * @param {(dir: string) => Promise<string[]>} [opts.listDir]
 * @returns {Promise<string[]>}
 */
async function listCandidateDirs({
  homedir = () => os.homedir(),
  env = process.env,
  platform = process.platform,
  npmGlobalBin = null,
  listDir = defaultReaddir,
} = {}) {
  const home = homedir();
  const dirs = [];

  if (platform === "win32") {
    if (env.APPDATA) dirs.push(path.join(env.APPDATA, "npm"));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, "Programs"));
  } else {
    dirs.push(...FIXED_UNIX_DIRS);
  }

  for (const rel of VENDOR_BIN_DIRS) dirs.push(path.join(home, ...rel));
  dirs.push(path.join(home, ".npm-global", "bin"));
  dirs.push(path.join(home, ".volta", "bin"));

  if (typeof npmGlobalBin === "string" && npmGlobalBin.trim()) {
    dirs.push(npmGlobalBin.trim());
  }

  // Cheap nvm: ~/.nvm/versions/node/<ver>/bin (no shell init)
  const nvmVersions = path.join(home, ".nvm", "versions", "node");
  try {
    const versions = await listDir(nvmVersions);
    for (const v of versions) {
      if (v && !String(v).startsWith(".")) {
        dirs.push(path.join(nvmVersions, String(v), "bin"));
      }
    }
  } catch {
    /* no nvm */
  }
  dirs.push(path.join(home, ".nvm", "current", "bin"));

  // Cheap fnm defaults
  if (typeof env.FNM_MULTISHELL_PATH === "string" && env.FNM_MULTISHELL_PATH.trim()) {
    dirs.push(env.FNM_MULTISHELL_PATH.trim());
  }
  dirs.push(path.join(home, ".local", "share", "fnm", "aliases", "default", "bin"));
  dirs.push(path.join(home, ".fnm", "aliases", "default", "bin"));

  return uniquePreserve(dirs.filter(Boolean));
}

/**
 * Absolute binary path candidates for a CLI name under the given dirs.
 * @param {string} name
 * @param {string[]} dirs
 * @param {string} [platform]
 * @returns {string[]}
 */
function listBinaryCandidates(name, dirs, platform = process.platform) {
  const out = [];
  for (const dir of dirs) {
    if (platform === "win32") {
      out.push(path.join(dir, `${name}.cmd`));
      out.push(path.join(dir, `${name}.exe`));
      out.push(path.join(dir, name));
    } else {
      out.push(path.join(dir, name));
    }
  }
  return uniquePreserve(out);
}

/**
 * PATH string with candidate dirs prepended (Dock ≠ Terminal enrichment).
 * @param {string|undefined} currentPath
 * @param {string[]} dirs
 * @param {string} [platform]
 */
function enrichPathString(currentPath, dirs, platform = process.platform) {
  const sep = platform === "win32" ? ";" : ":";
  const existing = String(currentPath || "")
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
  return uniquePreserve([...dirs, ...existing]).join(sep);
}

/**
 * Resolve npm's global bin dir (`npm prefix -g` → …/bin, or `npm bin -g`).
 * Best-effort; never throws.
 */
async function resolveNpmGlobalBin({
  execFile = defaultExecFile,
  env = process.env,
  platform = process.platform,
  pathEnv = null,
} = {}) {
  const runEnv = cleanEnvWithPath(env, pathEnv || env.PATH || env.Path || "", platform);
  const tryNpm = async (args) => {
    try {
      const { stdout } = await execFile("npm", args, {
        timeout: 5000,
        encoding: "utf8",
        env: runEnv,
      });
      return String(stdout || "").trim() || null;
    } catch {
      return null;
    }
  };

  const prefix = await tryNpm(["prefix", "-g"]);
  if (prefix) {
    return platform === "win32" ? prefix : path.join(prefix, "bin");
  }
  const bin = await tryNpm(["bin", "-g"]);
  return bin || null;
}

async function defaultPathExists(p) {
  try {
    await defaultAccess(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseWhichStdout(stdout) {
  return (
    String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) || null
  );
}

/**
 * Detect an installed CLI binary by enriched `which`/`where` then absolute probes.
 *
 * @param {string} name e.g. "grok" | "claude" | "codex"
 * @param {object} [opts]
 * @returns {Promise<{ installed: boolean, binaryPath: string|null }>}
 */
async function detectCliBinary(
  name,
  {
    execFile = defaultExecFile,
    env = process.env,
    homedir = () => os.homedir(),
    platform = process.platform,
    pathExists = defaultPathExists,
    listDir = defaultReaddir,
    npmGlobalBin = undefined,
  } = {},
) {
  let resolvedNpm = npmGlobalBin;
  if (resolvedNpm === undefined) {
    // Defer npm until after a cheap which attempt with static dirs — callers that
    // pass npmGlobalBin: null skip the spawn entirely (tests).
    resolvedNpm = null;
  }

  let dirs = await listCandidateDirs({
    homedir,
    env,
    platform,
    npmGlobalBin: resolvedNpm,
    listDir,
  });
  let enriched = enrichPathString(env.PATH || env.Path, dirs, platform);
  const whichCmd = platform === "win32" ? "where" : "which";

  const tryWhich = async (pathValue) => {
    try {
      const { stdout } = await execFile(whichCmd, [name], {
        timeout: 15000,
        encoding: "utf8",
        env: cleanEnvWithPath(env, pathValue, platform),
      });
      return parseWhichStdout(stdout);
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err && (err.stdout !== undefined || err.stderr !== undefined || err.code !== undefined)) {
        return parseWhichStdout(err.stdout);
      }
      return null;
    }
  };

  let found = await tryWhich(enriched);
  if (found) return { installed: true, binaryPath: found };

  // which missed — resolve npm global bin (if not injected) and retry / probe
  if (npmGlobalBin === undefined) {
    const npmBin = await resolveNpmGlobalBin({
      execFile,
      env,
      platform,
      pathEnv: enriched,
    });
    if (npmBin) {
      dirs = await listCandidateDirs({
        homedir,
        env,
        platform,
        npmGlobalBin: npmBin,
        listDir,
      });
      enriched = enrichPathString(env.PATH || env.Path, dirs, platform);
      found = await tryWhich(enriched);
      if (found) return { installed: true, binaryPath: found };
    }
  }

  const candidates = listBinaryCandidates(name, dirs, platform);
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return { installed: true, binaryPath: candidate };
    }
  }

  return { installed: false, binaryPath: null };
}

function uniquePreserve(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

module.exports = {
  FIXED_UNIX_DIRS,
  VENDOR_BIN_DIRS,
  listCandidateDirs,
  listBinaryCandidates,
  enrichPathString,
  resolveNpmGlobalBin,
  detectCliBinary,
};
