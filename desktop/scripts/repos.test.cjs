/**
 * `repos.*` bridge for local-folder runs (home-run.md §4, P10), against real temp git repos:
 * inspect, the recent-folders store, prepareRun (bundle of ONLY the base branch + upload) and
 * bringBackBranch (result bundle fetched in as tvashtr/<runId>, working tree untouched), with the
 * HTTP calls stubbed.
 *
 * Run: node --test desktop/scripts/repos.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createGit, RepoError, displayPath } = require("../electron/repos/common.cjs");
const { createRecentFolders, RECENT_FILENAME } = require("../electron/repos/recent.cjs");
const { createRepoService } = require("../electron/repos/service.cjs");
const { createRunnerApi } = require("../electron/runner/api.cjs");

const RUN_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const BRANCH = `tvashtr/${RUN_ID}`;

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tv-repos-"));
const emptyConfig = path.join(scratch, "gitconfig");
fs.writeFileSync(emptyConfig, "");
const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Ada",
  GIT_AUTHOR_EMAIL: "ada@example.com",
  GIT_COMMITTER_NAME: "Ada",
  GIT_COMMITTER_EMAIL: "ada@example.com",
};
const git = createGit({ env: () => GIT_ENV });

function sh(cwd, ...args) {
  return childProcess
    .execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" })
    .trim();
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(scratch, prefix));
}

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

/** main (3 dirs, 5 files) + an unrelated `secret-wip` branch that must never be uploaded. */
function makeRepo() {
  const repo = tempDir("repo-");
  sh(repo, "init", "-q", "-b", "main");
  write(repo, "README.md", "# demo\n");
  write(repo, "src/a.js", "a\n");
  write(repo, "src/lib/b.js", "b\n");
  write(repo, "docs/guide.md", "g\n");
  write(repo, "web/index.html", "<p>\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "base");
  sh(repo, "checkout", "-q", "-b", "secret-wip");
  write(repo, "secret.txt", "do not upload\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "wip");
  sh(repo, "checkout", "-q", "main");
  sh(repo, "remote", "add", "origin", "https://ada:ghp_token@github.com/ada/demo.git");
  return repo;
}

function service(api = {}, opts = {}) {
  return createRepoService({
    git,
    api: /** @type {any} */ (api),
    userDataDir: tempDir("ud-"),
    home: scratch,
    tmpRoot: scratch,
    ...opts,
  });
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.ok(e instanceof RepoError, `expected RepoError, got ${e && e.stack}`);
    assert.equal(e.code, code, e.message);
    return true;
  });
}

// ---------------------------------------------------------------------------------------- inspect

test("inspect reports branch, branches, tracked files, top-level scopes and a clean remote", async () => {
  const repo = makeRepo();
  const out = await service().inspect(repo);
  assert.deepEqual(out, {
    is_git: true,
    current_branch: "main",
    branches: ["main", "secret-wip"],
    tracked_file_count: 5,
    subpaths: [
      { path: "docs", file_count: 1 },
      { path: "src", file_count: 2 },
      { path: "web", file_count: 1 },
    ],
    remote_url: "https://github.com/ada/demo.git",
  });
});

test("inspect: detached HEAD, no remote", async () => {
  const repo = makeRepo();
  sh(repo, "remote", "remove", "origin");
  sh(repo, "checkout", "-q", "--detach");
  const out = await service().inspect(repo);
  assert.equal(out.is_git, true);
  assert.equal(out.current_branch, null);
  assert.equal(out.remote_url, null);
});

test("inspect: non-git, missing and nested folders are results, not throws", async () => {
  const plain = tempDir("plain-");
  assert.deepEqual(await service().inspect(plain), {
    is_git: false,
    error: "This folder isn't a git repository.",
  });
  assert.deepEqual(await service().inspect(path.join(plain, "gone")), {
    is_git: false,
    error: "That folder doesn't exist any more.",
  });
  const repo = makeRepo();
  const nested = await service().inspect(path.join(repo, "src"));
  assert.equal(nested.is_git, false);
  assert.match(nested.error, /inside the git repository at ~\/repo-.+Choose that folder instead\.$/);
});

test("inspect refuses relative paths", async () => {
  await rejectsWith(service().inspect("relative/dir"), "invalid_path");
  await rejectsWith(service().inspect(42), "invalid_path");
});

// ----------------------------------------------------------------------------------------- recent

test("recent folders: max 8, most recent first, re-add moves to the top, remove", async () => {
  const userDataDir = tempDir("ud-");
  const branchOf = async (d) => (d.endsWith("0") ? "main" : null);
  const store = createRecentFolders({ userDataDir, branchOf, home: scratch });
  const dirs = [];
  for (let i = 0; i < 10; i += 1) {
    const d = path.join(tempDir("rf-"), `f${i}`);
    fs.mkdirSync(d);
    dirs.push(d);
    await store.add(d);
  }
  let list = await store.list();
  assert.equal(list.length, 8);
  assert.deepEqual(
    list.map((r) => r.path),
    dirs.slice(2).reverse(),
  );
  await store.add(dirs[5]);
  list = await store.list();
  assert.equal(list[0].path, dirs[5]);
  assert.equal(list.length, 8);
  assert.equal(list[0].displayPath, displayPath(dirs[5], scratch));
  assert.ok(list[0].displayPath.startsWith("~/"));

  await store.remove(dirs[5]);
  assert.ok(!(await store.list()).some((r) => r.path === dirs[5]));

  // Persisted: a new store over the same userData sees the same list.
  const again = createRecentFolders({ userDataDir, branchOf, home: scratch });
  assert.equal((await again.list()).length, 7);
});

test("recent folders re-check availability and branch; bad input is refused", async () => {
  const userDataDir = tempDir("ud-");
  const repo = makeRepo();
  const gone = tempDir("gone-");
  const svc = service({}, { userDataDir });
  await svc.recent.add(gone);
  await svc.recent.add(repo);
  fs.rmSync(gone, { recursive: true });
  const list = await svc.recent.list();
  assert.deepEqual(
    list.map((r) => [r.path, r.branch, r.available]),
    [
      [repo, "main", true],
      [gone, null, false],
    ],
  );
  await rejectsWith(svc.recent.add(gone), "invalid_path");
  await rejectsWith(svc.recent.add("not/absolute"), "invalid_path");
  await svc.recent.remove(gone); // removing a vanished folder works
  assert.equal((await svc.recent.list()).length, 1);

  fs.writeFileSync(path.join(userDataDir, RECENT_FILENAME), "{oops");
  assert.deepEqual(await svc.recent.list(), []);
});

// ------------------------------------------------------------------------ prepareRun / bringBack

/** Upload stub: keeps a copy of the bundle the way the server would receive it. */
function uploadStub() {
  const calls = [];
  return {
    calls,
    async uploadRepoSnapshot({ file, label, baseRef }) {
      const kept = path.join(tempDir("srv-"), "upload.bundle");
      fs.copyFileSync(file, kept);
      calls.push({ file: kept, label, baseRef });
      return { snapshot_id: "0b3c5d7e-1111-4222-8333-944455556666", size_bytes: fs.statSync(kept).size };
    },
  };
}

/** What the server does with a snapshot: clone it, commit on tvashtr/<run>, bundle the result. */
function serverRun(uploadBundle, { incremental = false } = {}) {
  const ws = tempDir("srv-ws-");
  sh(scratch, "clone", "-q", "--branch", "main", uploadBundle, ws);
  sh(ws, "checkout", "-q", "-b", BRANCH);
  write(ws, "src/a.js", "a — improved by the team\n");
  write(ws, "CHANGELOG.md", "- tvashtr run\n");
  sh(ws, "add", "-A");
  sh(ws, "commit", "-q", "-m", "tvashtr: result");
  const out = path.join(tempDir("srv-out-"), "result.bundle");
  const refs = incremental ? [`refs/heads/${BRANCH}`, "^origin/main"] : [`refs/heads/${BRANCH}`];
  sh(ws, "bundle", "create", "-q", out, ...refs);
  return { bundle: out, sha: sh(ws, "rev-parse", "HEAD") };
}

function downloadStub(bundleFile) {
  const calls = [];
  return {
    calls,
    async downloadShipBundle(runId, dest, { maxBytes }) {
      calls.push({ runId, maxBytes });
      fs.copyFileSync(bundleFile, dest);
      return { size_bytes: fs.statSync(dest).size };
    },
  };
}

test("prepareRun bundles ONLY the base branch and uploads it with its label", async () => {
  const repo = makeRepo();
  const api = uploadStub();
  const out = await service(api).prepareRun({ path: repo, baseRef: "main", label: "~/code/demo" });
  assert.equal(out.snapshot_id, "0b3c5d7e-1111-4222-8333-944455556666");
  assert.ok(out.size_bytes > 0);
  assert.equal(api.calls.length, 1);
  assert.equal(api.calls[0].label, "~/code/demo");
  assert.equal(api.calls[0].baseRef, "main");
  const heads = sh(repo, "bundle", "list-heads", api.calls[0].file);
  assert.deepEqual(
    heads.split("\n").map((l) => l.split(" ")[1]),
    ["refs/heads/main"],
    "no HEAD, no other branches",
  );
  // The secret branch's commit is not in the bundle.
  const clone = tempDir("check-");
  sh(scratch, "clone", "-q", "--branch", "main", api.calls[0].file, clone);
  assert.equal(fs.existsSync(path.join(clone, "secret.txt")), false);
  assert.throws(() => sh(clone, "cat-file", "-e", sh(repo, "rev-parse", "secret-wip")));
  // The temp bundle is gone.
  assert.deepEqual(
    fs.readdirSync(scratch).filter((n) => n.startsWith("tvashtr-bundle-")),
    [],
  );
});

test("prepareRun defaults the label to the ~ path", async () => {
  const repo = makeRepo();
  const api = uploadStub();
  await service(api).prepareRun({ path: repo, baseRef: "secret-wip" });
  assert.equal(api.calls[0].label, displayPath(repo, scratch));
});

test("prepareRun errors are readable", async () => {
  const repo = makeRepo();
  const api = uploadStub();
  await rejectsWith(service(api).prepareRun({ path: "rel", baseRef: "main" }), "invalid_path");
  await rejectsWith(
    service(api).prepareRun({ path: tempDir("plain-"), baseRef: "main" }),
    "not_git",
  );
  for (const bad of ["nope", "-rf", "--upload-pack=touch x", "main..x", "", 7, "refs/heads/main"]) {
    await rejectsWith(service(api).prepareRun({ path: repo, baseRef: bad }), "branch_not_found");
  }
  await rejectsWith(
    service(api, { maxBundleBytes: 10 }).prepareRun({ path: repo, baseRef: "main" }),
    "too_large",
  );
  assert.equal(api.calls.length, 0, "nothing uploaded on any of these");

  const failing = (status, detail = null) => ({
    async uploadRepoSnapshot() {
      const e = new Error(`POST -> ${status}`);
      Object.assign(e, { status, detail });
      throw e;
    },
  });
  await rejectsWith(service(failing(401)).prepareRun({ path: repo, baseRef: "main" }), "not_signed_in");
  await rejectsWith(service(failing(413)).prepareRun({ path: repo, baseRef: "main" }), "too_large");
  await assert.rejects(
    service(failing(422, "Not a git bundle.")).prepareRun({ path: repo, baseRef: "main" }),
    /Tvashtr didn't accept the folder: Not a git bundle\./,
  );
  await rejectsWith(service(failing(502)).prepareRun({ path: repo, baseRef: "main" }), "upload_failed");
});

for (const incremental of [false, true]) {
  test(`bringBackBranch fetches tvashtr/<run> without touching the working tree (${
    incremental ? "incremental" : "full"
  } bundle)`, async () => {
    const repo = makeRepo();
    const up = uploadStub();
    await service(up).prepareRun({ path: repo, baseRef: "main" });
    const result = serverRun(up.calls[0].file, { incremental });

    // The user kept working meanwhile: an uncommitted edit and an untracked file.
    write(repo, "README.md", "# demo — local edit\n");
    write(repo, "scratch.txt", "untracked\n");
    const statusBefore = sh(repo, "status", "--porcelain");
    const headBefore = sh(repo, "rev-parse", "HEAD");

    const dl = downloadStub(result.bundle);
    const svc = service(dl);
    assert.deepEqual(await svc.bringBackBranch({ path: repo, runId: RUN_ID }), { branch: BRANCH });
    assert.equal(sh(repo, "rev-parse", `refs/heads/${BRANCH}`), result.sha);
    assert.equal(sh(repo, "symbolic-ref", "--short", "HEAD"), "main", "no checkout");
    assert.equal(sh(repo, "rev-parse", "HEAD"), headBefore);
    assert.equal(sh(repo, "status", "--porcelain"), statusBefore, "working tree untouched");
    assert.equal(fs.readFileSync(path.join(repo, "src/a.js"), "utf8"), "a\n");
    assert.equal(dl.calls[0].runId, RUN_ID);

    // Bringing it back again is a no-op, not an error.
    assert.deepEqual(await svc.bringBackBranch({ path: repo, runId: RUN_ID }), { branch: BRANCH });
  });
}

test("bringBackBranch refuses to move an existing tvashtr/<run> with different commits", async () => {
  const repo = makeRepo();
  const up = uploadStub();
  await service(up).prepareRun({ path: repo, baseRef: "main" });
  const result = serverRun(up.calls[0].file);
  sh(repo, "branch", BRANCH, "main"); // an ancestor: a plain fetch would fast-forward it
  const before = sh(repo, "rev-parse", BRANCH);
  await assert.rejects(
    service(downloadStub(result.bundle)).bringBackBranch({ path: repo, runId: RUN_ID }),
    (e) => {
      assert.equal(e.code, "branch_exists");
      assert.match(e.message, /already exists in this folder with different commits/);
      return true;
    },
  );
  assert.equal(sh(repo, "rev-parse", BRANCH), before, "branch not moved");
});

test("bringBackBranch errors are readable", async () => {
  const repo = makeRepo();
  const dl = downloadStub(path.join(scratch, "never-used"));
  await rejectsWith(service(dl).bringBackBranch({ path: repo, runId: "../../etc" }), "invalid_run");
  await rejectsWith(service(dl).bringBackBranch({ path: "rel", runId: RUN_ID }), "invalid_path");
  await rejectsWith(
    service(dl).bringBackBranch({ path: tempDir("plain-"), runId: RUN_ID }),
    "not_git",
  );
  assert.equal(dl.calls.length, 0, "validated before downloading");

  const status404 = {
    async downloadShipBundle() {
      throw Object.assign(new Error("GET -> 404"), { status: 404 });
    },
  };
  await rejectsWith(service(status404).bringBackBranch({ path: repo, runId: RUN_ID }), "not_found");

  // A bundle for some other branch.
  const other = path.join(tempDir("b-"), "other.bundle");
  sh(repo, "bundle", "create", "-q", other, "refs/heads/main");
  await rejectsWith(
    service(downloadStub(other)).bringBackBranch({ path: repo, runId: RUN_ID }),
    "bundle_invalid",
  );
});

// --------------------------------------------------------------------------------- HTTP client

test("the API client uploads multipart with the session cookie and caps downloads", async () => {
  const seen = [];
  const bundle = path.join(tempDir("api-"), "x.bundle");
  fs.writeFileSync(bundle, "BUNDLE");
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    if (init.method === "POST") {
      return new Response(JSON.stringify({ snapshot_id: "s1", size_bytes: 6 }), { status: 201 });
    }
    return new Response("x".repeat(1000), { status: 200 });
  };
  const api = createRunnerApi({
    baseUrl: () => "http://127.0.0.1:5178/",
    cookieHeader: async () => "tv_session=abc",
    fetchImpl: /** @type {any} */ (fetchImpl),
  });
  assert.deepEqual(await api.uploadRepoSnapshot({ file: bundle, label: "~/x", baseRef: "main" }), {
    snapshot_id: "s1",
    size_bytes: 6,
  });
  const post = seen[0];
  assert.equal(post.url, "http://127.0.0.1:5178/api/desktop/repo-snapshots");
  assert.equal(post.init.headers.cookie, "tv_session=abc");
  assert.equal(post.init.body.get("label"), "~/x");
  assert.equal(post.init.body.get("base_ref"), "main");
  assert.equal(await post.init.body.get("bundle").text(), "BUNDLE");

  const dest = path.join(tempDir("api-"), "r.bundle");
  assert.deepEqual(await api.downloadShipBundle(RUN_ID, dest, { maxBytes: 5000 }), { size_bytes: 1000 });
  assert.equal(seen[1].url, `http://127.0.0.1:5178/api/runs/${RUN_ID}/ship-bundle`);
  await assert.rejects(api.downloadShipBundle(RUN_ID, dest, { maxBytes: 10 }), (e) => e.code === "too_large");

  const failing = createRunnerApi({
    baseUrl: () => "http://127.0.0.1:5178",
    cookieHeader: async () => null,
    fetchImpl: /** @type {any} */ (
      async () => new Response(JSON.stringify({ detail: "Bundle is over 200 MB." }), { status: 413 })
    ),
  });
  await assert.rejects(
    failing.uploadRepoSnapshot({ file: bundle, label: "l", baseRef: "main" }),
    (e) => e.status === 413 && e.detail === "Bundle is over 200 MB.",
  );
});

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
