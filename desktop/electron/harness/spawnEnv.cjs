/**
 * The ONE environment every vendor-CLI child process gets (probe, login, headless run).
 *
 * M-subs-desktop §3.0: the user's own CLI must use the user's own sign-in — never an API key by
 * accident, and never an inherited Claude Code session (a Desktop app started from a Claude Code
 * terminal carries CLAUDECODE / CLAUDE_CODE_* which trip nested-session detection). So we REMOVE
 * the API-key vars and those session vars, and put the enriched PATH (Dock launch ≠ Terminal) in
 * front. No token of any kind is ever ADDED — this module only subtracts.
 */
const { enrichPathString, listCandidateDirs } = require("./pathDetect.cjs");

/** Exact keys that must never reach a vendor CLI child. */
const STRIPPED_ENV_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "CLAUDECODE",
]);

/** Prefix of the inherited Claude Code session vars (CLAUDE_CODE_SESSION_ID, …_MESSAGING_TOKEN…). */
const STRIPPED_ENV_PREFIX = "CLAUDE_CODE_";

/** @param {string} key */
function isStrippedEnvKey(key) {
  const k = String(key);
  return STRIPPED_ENV_KEYS.includes(k) || k.startsWith(STRIPPED_ENV_PREFIX);
}

/**
 * Copy ``baseEnv`` minus every stripped key, with ``pathDirs`` prepended to PATH.
 *
 * @param {NodeJS.ProcessEnv} baseEnv
 * @param {{ pathDirs?: string[], platform?: string }} [opts]
 * @returns {NodeJS.ProcessEnv}
 */
function buildChildEnv(baseEnv, { pathDirs = [], platform = process.platform } = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [k, v] of Object.entries(baseEnv || {})) {
    if (v === undefined || isStrippedEnvKey(k)) continue;
    out[k] = v;
  }
  const pathKey = platform === "win32" && "Path" in out && !("PATH" in out) ? "Path" : "PATH";
  out[pathKey] = enrichPathString(out.PATH || out.Path, pathDirs, platform);
  return out;
}

/**
 * The clean child env with the FULL candidate PATH (vendor installer dirs, npm-global, nvm, fnm,
 * Homebrew) — what every harness spawn and every runner job uses.
 *
 * @param {{ env?: NodeJS.ProcessEnv, homedir?: () => string, platform?: string,
 *   listDir?: (dir: string) => Promise<string[]>, npmGlobalBin?: string|null }} [opts]
 */
async function resolveCliEnv({
  env = process.env,
  homedir,
  platform = process.platform,
  listDir,
  npmGlobalBin = null,
} = {}) {
  const pathDirs = await listCandidateDirs({ env, homedir, platform, listDir, npmGlobalBin });
  return buildChildEnv(env, { pathDirs, platform });
}

module.exports = {
  STRIPPED_ENV_KEYS,
  STRIPPED_ENV_PREFIX,
  isStrippedEnvKey,
  buildChildEnv,
  resolveCliEnv,
};
