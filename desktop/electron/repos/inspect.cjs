/**
 * `repos.inspect(path)` — what the Start-a-run composer needs about a local folder: its branch,
 * branches, tracked file count and top-level folders (the Scope picker). Mirrors the backend's
 * `worktree.repo_inspect` + `repo_subpaths` so a picked scope passes `create_run`'s validation
 * after the bundle is cloned server side.
 *
 * Non-git folders are a RESULT (`{is_git:false, error}`), not a throw, so the UI can show it inline.
 */
const fs = require("fs");
const path = require("path");
const { RepoError, requireDirectory, displayPath } = require("./common.cjs");

/** Same cap as the backend's `_SUBPATHS_MAX`. */
const SUBPATHS_MAX = 100;

/** Drop any credentials from an https remote (`https://user:token@host/…` → `https://host/…`). */
function safeRemoteUrl(raw) {
  const url = String(raw || "").trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) {
      u.username = "";
      u.password = "";
      return u.toString();
    }
  } catch {
    /* scp-style git@host:owner/repo.git — nothing to strip */
  }
  return url;
}

/**
 * @param {string} lsFiles `git ls-files` output (default quoting: unusual names are "C-quoted")
 */
function summariseTrackedFiles(lsFiles) {
  let tracked = 0;
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const raw of lsFiles.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    tracked += 1;
    // Quoted names can't round-trip the server's subpath check — don't offer them as a scope.
    if (line.startsWith('"') || !line.includes("/")) continue;
    const top = line.split("/", 1)[0];
    if (top) counts.set(top, (counts.get(top) || 0) + 1);
  }
  const subpaths = [...counts.keys()]
    .sort()
    .slice(0, SUBPATHS_MAX)
    .map((p) => ({ path: p, file_count: /** @type {number} */ (counts.get(p)) }));
  return { tracked_file_count: tracked, subpaths };
}

/**
 * @param {unknown} dir
 * @param {{ git: ReturnType<typeof import("./common.cjs").createGit>, home?: string }} deps
 */
async function inspectRepo(dir, { git, home }) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) {
    throw new RepoError("invalid_path", "Choose a folder on this computer.");
  }
  let repo;
  try {
    repo = requireDirectory(dir);
  } catch (e) {
    return { is_git: false, error: /** @type {Error} */ (e).message };
  }

  const inside = await git.tryRun(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside || inside.trim() !== "true") {
    return { is_git: false, error: "This folder isn't a git repository." };
  }
  // The bundle carries the whole repository and Scope is relative to its top, so the folder
  // must BE the top of the work tree, not somewhere inside one.
  const top = (await git.tryRun(repo, ["rev-parse", "--show-toplevel"])) || "";
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return p;
    }
  };
  if (!top.trim() || real(top.trim()) !== real(repo)) {
    const shown = top.trim() ? displayPath(real(top.trim()), home) : "a parent folder";
    return {
      is_git: false,
      error: `This folder is inside the git repository at ${shown}. Choose that folder instead.`,
    };
  }

  const head = await git.tryRun(repo, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branchesOut = (await git.tryRun(repo, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
  ])) || "";
  const lsFiles = (await git.tryRun(repo, ["ls-files"], { maxBuffer: 512 * 1024 * 1024 })) || "";
  const remote = await git.tryRun(repo, ["remote", "get-url", "origin"]);

  return {
    is_git: true,
    current_branch: head && head.trim() ? head.trim() : null,
    branches: branchesOut
      .split("\n")
      .map((b) => b.trim())
      .filter(Boolean),
    ...summariseTrackedFiles(lsFiles),
    remote_url: safeRemoteUrl(remote),
  };
}

module.exports = { inspectRepo, summariseTrackedFiles, safeRemoteUrl, SUBPATHS_MAX };
