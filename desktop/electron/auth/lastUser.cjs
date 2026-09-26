/**
 * Bridge v6 `auth` (DB-1): who last signed in on this Mac — `userData/last-user.json`.
 *
 * Only the GitHub login and the display name (never an id, email, cookie or token), so Desktop can
 * say "Last signed in as <login>" when the session ends (DT-11) and offer the Expired screen
 * instead of the first-launch Welcome. `forget()` is Switch / sign out (DT-12).
 */
const fs = require("fs");
const path = require("path");

const LAST_USER_FILENAME = "last-user.json";
const LOGIN_RE = /^[A-Za-z0-9._@+-]{1,100}$/;

/** @param {unknown} v */
function clean(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 && s.length <= 100 ? s : null;
}

/** @param {{ userDataDir: string }} deps */
function createLastUser({ userDataDir }) {
  const file = path.join(userDataDir, LAST_USER_FILENAME);

  return {
    /** @returns {{ login: string, displayName: string } | null} */
    get() {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8"));
        const login = clean(raw && raw.login);
        const displayName = clean(raw && raw.displayName) || login;
        if (!login || !LOGIN_RE.test(login) || !displayName) return null;
        return { login, displayName };
      } catch {
        return null;
      }
    },
    /** @param {{ login: unknown, displayName?: unknown }} user */
    save(user) {
      const login = clean(user && user.login);
      if (!login || !LOGIN_RE.test(login)) return false;
      const displayName = clean(user && user.displayName) || login;
      fs.mkdirSync(userDataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ login, displayName }), { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    },
    forget() {
      fs.rmSync(file, { force: true });
    },
  };
}

module.exports = { createLastUser, LAST_USER_FILENAME };
