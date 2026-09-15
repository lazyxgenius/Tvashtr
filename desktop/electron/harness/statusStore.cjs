/**
 * Persist engine subscription status (no secrets) via Electron safeStorage.
 * Falls back to a plain buffer file under userData when OS encryption is unavailable.
 */
const fs = require("fs");
const path = require("path");

const ALLOWED_STATUS_KEYS = [
  "provider",
  "connected",
  "state",
  "account_hint",
  "source",
  "checked_at",
];

const STORE_FILENAME = "engine-subscriptions.bin";

/**
 * @param {Record<string, unknown>|null|undefined} row
 * @returns {import('./types.cjs').EngineStatus|null}
 */
function sanitizeStatus(row) {
  if (!row || typeof row !== "object") return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of ALLOWED_STATUS_KEYS) {
    if (k in row) out[k] = /** @type {any} */ (row)[k];
  }
  if (typeof out.provider !== "string") return null;
  if (typeof out.connected !== "boolean") out.connected = false;
  if (typeof out.state !== "string") out.state = "disconnected";
  if (!("account_hint" in out)) out.account_hint = null;
  if (!("source" in out)) out.source = null;
  if (!("checked_at" in out)) out.checked_at = null;
  return /** @type {any} */ (out);
}

/**
 * @param {{ userDataDir: string, safeStorage: {
 *   isEncryptionAvailable: () => boolean,
 *   encryptString: (s: string) => Buffer,
 *   decryptString: (b: Buffer) => string,
 * } }} opts
 */
function createStatusStore({ userDataDir, safeStorage }) {
  const filePath = path.join(userDataDir, STORE_FILENAME);

  function loadMap() {
    try {
      if (!fs.existsSync(filePath)) return {};
      const buf = fs.readFileSync(filePath);
      if (!buf || buf.length === 0) return {};
      let json;
      if (safeStorage.isEncryptionAvailable()) {
        json = safeStorage.decryptString(buf);
      } else {
        json = buf.toString("utf8");
      }
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      /** @type {Record<string, any>} */
      const clean = {};
      for (const [k, v] of Object.entries(parsed)) {
        const s = sanitizeStatus(v);
        if (s) clean[k] = s;
      }
      return clean;
    } catch {
      return {};
    }
  }

  function persist(map) {
    const json = JSON.stringify(map);
    let buf;
    if (safeStorage.isEncryptionAvailable()) {
      buf = safeStorage.encryptString(json);
    } else {
      buf = Buffer.from(json, "utf8");
    }
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(filePath, buf);
  }

  function readAll() {
    return loadMap();
  }

  function read(provider) {
    const map = loadMap();
    return map[provider] || null;
  }

  function write(provider, status) {
    const sanitized = sanitizeStatus({ ...status, provider });
    if (!sanitized) return null;
    const map = loadMap();
    map[provider] = sanitized;
    persist(map);
    return sanitized;
  }

  function clear(provider) {
    const map = loadMap();
    if (!(provider in map)) return;
    delete map[provider];
    persist(map);
  }

  return { readAll, read, write, clear, sanitizeStatus };
}

module.exports = { createStatusStore, sanitizeStatus, ALLOWED_STATUS_KEYS };
