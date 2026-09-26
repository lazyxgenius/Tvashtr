/**
 * `repos.initGit({path})` (bridge v6, DB-5) against real temp folders: git init on main + one
 * first commit, the identity fallback, and every refusal with its exact copy (the UI shows them
 * as is). A failure after `git init` leaves no `.git` behind.
 *
 * Run: node --test desktop/scripts/init-git.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createGit, RepoError } = require("../electron/repos/common.cjs");
const { createRepoService } = require("../electron/repos/service.cjs");
const { initGitRepo, countFiles, fallbackIdentity } = require("../electron/repos/initGit.cjs");

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tv-initgit-")));
const emptyConfig = path.join(scratch, "gitconfig");
fs.writeFileSync(emptyConfig, "");
/** No global identity (like a fresh Mac): the fallback identity must be used. */
const BARE_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: scratch,
};
for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) {
  delete BARE_ENV[k];
}
const git = createGit({ env: () => BARE_ENV });

function sh(cwd, ...args) {
  return childProcess.execFileSync("git", args, { cwd, env: BARE_ENV, encoding: "utf8" }).trim();
}

function folder(files = { "notes.md": "# notes\n" }) {
  const dir = fs.mkdtempSync(path.join(scratch, "f-"));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function rejectsWith(promise, code, message) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof RepoError, `expected RepoError, got ${e && e.stack}`);
    assert.equal(e.code, code, e.message);
    if (message !== undefined) assert.equal(e.message, message);
    return true;
  });
}

const init = (dir, deps = {}) =>
  initGitRepo({ path: dir }, { git, home: path.join(scratch, "home"), ...deps });

test("sets up git on main with one first commit of every file (honouring .gitignore)", async () => {
  const dir = folder({
    "notes.md": "# notes\n",
    "todo/today.md": "- ship\n",
    ".gitignore": "secret.txt\n",
    "secret.txt": "hidden\n",
  });
  const out = await init(dir, { login: () => "lazyxgenius" });
  assert.equal(out.branch, "main");
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.equal(out.file_count, 3);
  assert.equal(sh(dir, "symbolic-ref", "--short", "HEAD"), "main");
  assert.equal(sh(dir, "log", "--format=%s"), "Start tracking with Tvashtr");
  assert.equal(sh(dir, "log", "--format=%an <%ae>"), "lazyxgenius <lazyxgenius@users.noreply.github.com>");
  assert.equal(sh(dir, "status", "--porcelain"), "");
  // Inspect now sees what the Project step shows: a git repo on main, no remote yet.
  const inspected = await createRepoService({
    git,
    api: /** @type {any} */ ({}),
    userDataDir: fs.mkdtempSync(path.join(scratch, "ud-")),
    home: scratch,
  }).inspect(dir);
  assert.equal(inspected.is_git, true);
  assert.equal(inspected.current_branch, "main");
  assert.equal(inspected.remote_url, null);
});

test("the user's own git identity wins over the fallback", async () => {
  const config = path.join(scratch, "gitconfig-ada");
  fs.writeFileSync(config, "[user]\n\tname = Ada\n\temail = ada@example.com\n");
  const own = createGit({ env: () => ({ ...BARE_ENV, GIT_CONFIG_GLOBAL: config }) });
  const dir = folder();
  await initGitRepo({ path: dir }, { git: own, home: path.join(scratch, "home"), login: () => "lazyxgenius" });
  assert.equal(sh(dir, "log", "--format=%an <%ae>"), "Ada <ada@example.com>");
});

test("fallback identity: GitHub login, email login, nobody", () => {
  assert.deepEqual(fallbackIdentity("octo"), { name: "octo", email: "octo@users.noreply.github.com" });
  assert.deepEqual(fallbackIdentity("ada@example.com"), { name: "ada", email: "ada@example.com" });
  assert.deepEqual(fallbackIdentity(null), { name: "Tvashtr Agent", email: "agent@tvashtr.local" });
});

test("refuses a folder that is already a repository, or inside one", async () => {
  const dir = folder({ "a.txt": "a\n", "sub/b.txt": "b\n" });
  sh(dir, "init", "-q");
  await rejectsWith(init(dir), "already_git", "This folder is already a git repository.");
  await rejectsWith(
    init(path.join(dir, "sub")),
    "inside_repo",
    `This folder is inside the git repository at ${dir}. Choose that folder instead.`,
  );
});

test("refuses the home folder and /", async () => {
  const home = folder();
  await rejectsWith(
    initGitRepo({ path: home }, { git, home }),
    "home_folder",
    "Choose a project folder, not your home folder.",
  );
  await rejectsWith(init("/"), "home_folder", "Choose a project folder, not your home folder.");
  assert.equal(fs.existsSync(path.join(home, ".git")), false);
});

test("refuses an empty folder and a folder with too many files", async () => {
  const empty = folder({});
  fs.mkdirSync(path.join(empty, "only-dirs"));
  await rejectsWith(
    init(empty),
    "empty_folder",
    "This folder is empty. Add your project's files, then set up git.",
  );
  const big = folder({ "1.txt": "1", "2.txt": "2", "d/3.txt": "3" });
  await rejectsWith(
    init(big, { maxFiles: 2 }),
    "too_many_files",
    "This folder has more than 20,000 files. Set up git in it yourself, then choose it again.",
  );
  assert.equal(fs.existsSync(path.join(big, ".git")), false);
});

test("a git failure after init reads 'Couldn't set up git here: …' and leaves no .git", async () => {
  const dir = folder();
  const failing = {
    ...git,
    run: async (cwd, args, opts) => {
      if (args.includes("commit")) {
        const err = /** @type {any} */ (new Error("Command failed"));
        err.stderr = "fatal: unable to write new index file\n";
        throw err;
      }
      return git.run(cwd, args, opts);
    },
  };
  await rejectsWith(
    initGitRepo({ path: dir }, { git: failing, home: path.join(scratch, "home") }),
    "git_failed",
    "Couldn't set up git here: unable to write new index file",
  );
  assert.equal(fs.existsSync(path.join(dir, ".git")), false);
});

test("git missing reuses the existing message", async () => {
  const missing = createGit({
    execFile: async () => {
      const err = /** @type {any} */ (new Error("spawn git ENOENT"));
      err.code = "ENOENT";
      throw err;
    },
  });
  await rejectsWith(
    initGitRepo({ path: folder() }, { git: missing, home: path.join(scratch, "home") }),
    "git_missing",
    "Git isn't installed on this computer, or Tvashtr can't find it.",
  );
});

test("bad input is refused like every repos.* call", async () => {
  await rejectsWith(init("relative/dir"), "invalid_path");
  await rejectsWith(initGitRepo(null, { git }), "invalid_path");
  await rejectsWith(init(path.join(scratch, "gone")), "invalid_path");
});

test("countFiles skips .git folders and stops past the limit", () => {
  const dir = folder({ "a": "a", "b/c": "c", ".git/HEAD": "x" });
  assert.equal(countFiles(dir, 100), 2);
  assert.equal(countFiles(dir, 0), 1);
});

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
