/**
 * `repos.initGit({path})` (bridge v6, DB-5): "Set up git here" on Desktop setup's Project step
 * (DT-30 c→d, OQ-22). Runs `git init` on branch main, `git add -A` (honours any .gitignore) and one
 * first commit "Start tracking with Tvashtr" — a run bundles a branch, so the folder needs a commit.
 *
 * It never touches a folder that is already a repository (or sits inside one), your home folder
 * or `/`, an empty folder, or one with more than 20,000 files. Every refusal is a RepoError whose
 * message the UI shows as is. If git fails after `git init`, the `.git` it just made is removed so
 * the folder is left as it was.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RepoError, requireDirectory, displayPath, gitErrorLine } = require("./common.cjs");

const MAX_FILES = 20_000;
const COMMIT_MESSAGE = "Start tracking with Tvashtr";
/** Used only for the identity keys git doesn't already have (as the backend's ship step does). */
const FALLBACK_IDENTITY = { name: "Tvashtr Agent", email: "agent@tvashtr.local" };

/**
 * Regular files under `dir` (not following symlinks, skipping `.git` folders), counting stops at
 * `limit + 1`.
 * @param {string} dir @param {number} limit
 */
function countFiles(dir, limit) {
  let count = 0;
  const stack = [dir];
  while (stack.length && count <= limit) {
    const cur = /** @type {string} */ (stack.pop());
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue; // unreadable: git can't add it either
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name !== ".git") stack.push(path.join(cur, e.name));
      } else if (e.isFile()) {
        count += 1;
        if (count > limit) break;
      }
    }
  }
  return count;
}

/**
 * The committer for the first commit: the user's own git identity when git has one; otherwise
 * their Tvashtr login (a GitHub login gets its noreply address), else the Tvashtr agent.
 * @param {string | null | undefined} login
 */
function fallbackIdentity(login) {
  if (login && login.includes("@")) return { name: login.split("@")[0] || login, email: login };
  if (login) return { name: login, email: `${login}@users.noreply.github.com` };
  return FALLBACK_IDENTITY;
}

/**
 * @param {unknown} args `{ path }`
 * @param {{
 *   git: ReturnType<typeof import("./common.cjs").createGit>,
 *   home?: string,
 *   login?: () => string | null | undefined,
 *   maxFiles?: number,
 * }} deps
 * @returns {Promise<{ branch: "main", commit: string, file_count: number }>}
 */
async function initGitRepo(args, { git, home = os.homedir(), login = () => null, maxFiles = MAX_FILES }) {
  const raw = args && typeof args === "object" ? /** @type {any} */ (args).path : undefined;
  const dir = requireDirectory(raw);
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return p;
    }
  };
  if (dir === path.parse(dir).root || (home && real(dir) === real(home))) {
    throw new RepoError("home_folder", "Choose a project folder, not your home folder.");
  }

  const inside = await git.tryRun(dir, ["rev-parse", "--is-inside-work-tree"]);
  if (inside && inside.trim() === "true") {
    const top = ((await git.tryRun(dir, ["rev-parse", "--show-toplevel"])) || "").trim();
    if (top && real(top) !== real(dir)) {
      throw new RepoError(
        "inside_repo",
        `This folder is inside the git repository at ${displayPath(real(top), home ? real(home) : home)}. Choose that folder instead.`,
      );
    }
    throw new RepoError("already_git", "This folder is already a git repository.");
  }
  if (fs.existsSync(path.join(dir, ".git"))) {
    throw new RepoError("already_git", "This folder is already a git repository.");
  }

  const files = countFiles(dir, maxFiles);
  if (files > maxFiles) {
    throw new RepoError(
      "too_many_files",
      "This folder has more than 20,000 files. Set up git in it yourself, then choose it again.",
    );
  }
  if (files === 0) {
    throw new RepoError("empty_folder", "This folder is empty. Add your project's files, then set up git.");
  }

  const dotGit = path.join(dir, ".git");
  let created = false;
  try {
    await git.run(dir, ["init", "-q"]);
    created = true;
    await git.run(dir, ["symbolic-ref", "HEAD", "refs/heads/main"]);
    await git.run(dir, ["add", "-A"]);
    const who = fallbackIdentity(login());
    const hasName = ((await git.tryRun(dir, ["config", "--get", "user.name"])) || "").trim();
    const hasEmail = ((await git.tryRun(dir, ["config", "--get", "user.email"])) || "").trim();
    const identity = [
      ...(hasName ? [] : ["-c", `user.name=${who.name}`]),
      ...(hasEmail ? [] : ["-c", `user.email=${who.email}`]),
    ];
    await git.run(dir, [
      ...identity,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-q",
      "--no-verify",
      "-m",
      COMMIT_MESSAGE,
    ]);
    const commit = (await git.run(dir, ["rev-parse", "HEAD"])).trim();
    const tracked = (await git.run(dir, ["ls-files"], { maxBuffer: 512 * 1024 * 1024 }))
      .split("\n")
      .filter((l) => l.trim()).length;
    return { branch: "main", commit, file_count: tracked };
  } catch (e) {
    if (created) fs.rmSync(dotGit, { recursive: true, force: true });
    if (e instanceof RepoError) throw e;
    throw new RepoError("git_failed", `Couldn't set up git here: ${gitErrorLine(e)}`);
  }
}

module.exports = { initGitRepo, countFiles, fallbackIdentity, MAX_FILES, COMMIT_MESSAGE };
