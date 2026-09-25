/**
 * Engine preferences that must survive a relaunch (engines.md B1 / spec OQ-9).
 *
 * Today only one: the providers the user DISCONNECTED in Tvashtr. The vendor CLI itself stays
 * signed in ("You stay signed in to Claude Code itself"), so without this a relaunch would probe
 * it, find it signed in, and bring the engine back as Connected. A disconnected provider is not
 * probed at launch or on Refresh; Connect removes the flag.
 *
 * Plain JSON in userData (`engine-prefs.json`) — provider ids only, nothing secret.
 */
const fs = require("fs");
const path = require("path");

const PREFS_FILENAME = "engine-prefs.json";

/**
 * @param {{ userDataDir: string, providers: readonly string[] }} opts
 */
function createEnginePrefs({ userDataDir, providers }) {
  const filePath = path.join(userDataDir, PREFS_FILENAME);
  const known = new Set(providers);

  /** @returns {string[]} */
  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const list = parsed && Array.isArray(parsed.userDisconnected) ? parsed.userDisconnected : [];
      return [...new Set(list.filter((p) => typeof p === "string" && known.has(p)))];
    } catch {
      return [];
    }
  }

  /** @param {string[]} list */
  function save(list) {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, userDisconnected: list }, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    /** @param {string} provider */
    isUserDisconnected: (provider) => load().includes(provider),
    userDisconnected: () => load(),
    /** @param {string} provider */
    markUserDisconnected(provider) {
      if (!known.has(provider)) return;
      const list = load();
      if (!list.includes(provider)) save([...list, provider]);
    },
    /** @param {string} provider */
    clearUserDisconnected(provider) {
      const list = load();
      if (list.includes(provider)) save(list.filter((p) => p !== provider));
    },
  };
}

module.exports = { createEnginePrefs, PREFS_FILENAME };
