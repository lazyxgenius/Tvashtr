/**
 * "Recent folders" in the Start-a-run composer (HOME-20/21): up to 8 local folders, most recent
 * first, in `userData/recent-folders.json`. `list()` re-checks every folder (still there? which
 * branch?) so a moved or deleted folder shows as unavailable instead of failing later.
 */
const fs = require("fs");
const path = require("path");
const { requireDirectory, displayPath } = require("./common.cjs");

const RECENT_FILENAME = "recent-folders.json";
const RECENT_MAX = 8;

/**
 * @param {{ userDataDir: string, branchOf: (dir: string) => Promise<string | null>,
 *   home?: string, max?: number }} deps
 */
function createRecentFolders({ userDataDir, branchOf, home, max = RECENT_MAX }) {
  const filePath = path.join(userDataDir, RECENT_FILENAME);

  /** @returns {string[]} */
  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const folders = parsed && Array.isArray(parsed.folders) ? parsed.folders : [];
      const out = [];
      for (const f of folders) {
        const p = f && typeof f.path === "string" ? f.path : null;
        if (p && path.isAbsolute(p) && !out.includes(p)) out.push(p);
      }
      return out.slice(0, max);
    } catch {
      return [];
    }
  }

  /** @param {string[]} paths */
  function save(paths) {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    const body = { version: 1, folders: paths.slice(0, max).map((p) => ({ path: p })) };
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    async list() {
      const out = [];
      for (const p of load()) {
        let available = false;
        try {
          available = fs.statSync(p).isDirectory();
        } catch {
          available = false;
        }
        let branch = null;
        if (available) {
          try {
            branch = await branchOf(p);
          } catch {
            branch = null;
          }
        }
        out.push({ path: p, displayPath: displayPath(p, home), branch, available });
      }
      return out;
    },
    /** Put a folder at the top (it must exist). */
    async add(p) {
      const dir = requireDirectory(p);
      save([dir, ...load().filter((x) => x !== dir)]);
    },
    /** Forget a folder (it need not exist any more). */
    async remove(p) {
      if (typeof p !== "string") return;
      const target = path.isAbsolute(p) ? path.resolve(p) : p;
      const current = load();
      const next = current.filter((x) => x !== target && x !== p);
      if (next.length !== current.length) save(next);
    },
  };
}

module.exports = { createRecentFolders, RECENT_FILENAME, RECENT_MAX };
