/**
 * Bridge v6 `setup` (DB-4, desktop-app.md DT-17): this Mac's first-run setup, per account —
 * `userData/desktop-setup.json`, keyed by the Tvashtr account id.
 *
 * Setup is per Mac and per account: the step the user is on, when they ticked the plan consent
 * (OQ-36: a time on this Mac, no server record), the project choice and when setup finished. Quitting
 * mid-setup resumes at the same step. Not localStorage: the loopback port can change between
 * launches (listenPrefer walks 5178…5198), and localStorage is per origin.
 *
 * Only these fields are ever stored; `update` rejects anything else with a SetupError whose message
 * is ready to show.
 */
const fs = require("fs");
const path = require("path");

const SETUP_FILENAME = "desktop-setup.json";
const STEPS = ["engines", "project", "team"];
const ACCOUNT_RE = /^[A-Za-z0-9-]{1,64}$/;
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SAVE_FAILED = "Couldn't save this Mac's setup. Try again.";

class SetupError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

/** A fresh account on this Mac: setup starts at Engines (DT-2 step 3). */
function emptySetup() {
  return { version: 1, step: null, finishedAt: null, planConsentAt: null, workspace: null };
}

/** @param {unknown} v @returns {string | null | undefined} undefined = invalid */
function timestamp(v) {
  if (v === null) return null;
  if (typeof v !== "string" || v.length > 40) return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** @param {unknown} v @returns {object | null | undefined} undefined = invalid */
function workspace(v) {
  if (v === null) return null;
  if (!v || typeof v !== "object") return undefined;
  const w = /** @type {Record<string, unknown>} */ (v);
  if (w.kind === "ask") return { kind: "ask" };
  if (w.kind === "github") {
    return typeof w.repo === "string" && REPO_RE.test(w.repo)
      ? { kind: "github", repo: w.repo }
      : undefined;
  }
  if (w.kind === "folder") {
    const p = w.path;
    const shown = w.displayPath;
    if (typeof p !== "string" || p.length === 0 || p.length > 4096 || p.includes("\0")) {
      return undefined;
    }
    if (!path.isAbsolute(p)) return undefined;
    if (typeof shown !== "string" || shown.length === 0 || shown.length > 4096) return undefined;
    return { kind: "folder", path: path.resolve(p), displayPath: shown };
  }
  return undefined;
}

/** A stored row, cleaned: anything unexpected falls back to the empty value. */
function clean(raw) {
  const out = emptySetup();
  if (!raw || typeof raw !== "object") return out;
  if (STEPS.includes(raw.step)) out.step = raw.step;
  out.finishedAt = timestamp(raw.finishedAt) ?? null;
  out.planConsentAt = timestamp(raw.planConsentAt) ?? null;
  out.workspace = workspace(raw.workspace) ?? null;
  return out;
}

/** @param {unknown} accountId */
function requireAccount(accountId) {
  if (typeof accountId !== "string" || !ACCOUNT_RE.test(accountId)) {
    throw new SetupError("invalid_account", SAVE_FAILED);
  }
  return accountId;
}

/** @param {{ userDataDir: string }} deps */
function createSetupStore({ userDataDir }) {
  const file = path.join(userDataDir, SETUP_FILENAME);

  /** @returns {Record<string, unknown>} */
  function readAll() {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      const accounts = raw && typeof raw === "object" ? raw.accounts : null;
      return accounts && typeof accounts === "object" && !Array.isArray(accounts) ? accounts : {};
    } catch {
      return {};
    }
  }

  /** @param {Record<string, unknown>} accounts */
  function writeAll(accounts) {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, accounts }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    /** @param {unknown} accountId */
    get(accountId) {
      const id = requireAccount(accountId);
      return clean(readAll()[id]);
    },
    /**
     * Merge `patch` (any of step, finishedAt, planConsentAt, workspace) into the account's setup.
     * @param {unknown} accountId @param {unknown} patch
     */
    update(accountId, patch) {
      const id = requireAccount(accountId);
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new SetupError("invalid_patch", SAVE_FAILED);
      }
      const p = /** @type {Record<string, unknown>} */ (patch);
      const accounts = readAll();
      const next = clean(accounts[id]);
      for (const key of Object.keys(p)) {
        if (key === "step") {
          if (p.step !== null && !STEPS.includes(/** @type {string} */ (p.step))) {
            throw new SetupError("invalid_patch", SAVE_FAILED);
          }
          next.step = /** @type {any} */ (p.step);
        } else if (key === "finishedAt" || key === "planConsentAt") {
          const t = timestamp(p[key]);
          if (t === undefined) throw new SetupError("invalid_patch", SAVE_FAILED);
          next[key] = t;
        } else if (key === "workspace") {
          const w = workspace(p.workspace);
          if (w === undefined) throw new SetupError("invalid_patch", SAVE_FAILED);
          next.workspace = /** @type {any} */ (w);
        } else {
          throw new SetupError("invalid_patch", SAVE_FAILED);
        }
      }
      accounts[id] = next;
      writeAll(accounts);
      return next;
    },
  };
}

module.exports = { createSetupStore, SetupError, SETUP_FILENAME };
