/**
 * M-desk-7 S4: a Grok Build job is locked to its own copy of the repo by Grok's own kernel sandbox
 * (Seatbelt on macOS), through a profile Tvashtr writes for each job. `--sandbox workspace` alone
 * confines writes, not reads; `--sandbox strict` refuses to start on a Mac with Docker Desktop (its
 * socket is a symlink). What Grok documents (docs.x.ai build/features/sandbox, and the CLI's own
 * `18-sandbox.md`, 1.0.46):
 *   - a project `.grok/sandbox.toml` in the working dir defines `[profiles.<name>]`, picked with
 *     `--sandbox <name>`; a requested custom profile that can't be applied makes Grok refuse to
 *     start; a user profile of the same name wins, so each job's name is its own;
 *   - `deny` is kernel-enforced for read and write/rename; an entry with `*`, `?` or `[` is a glob
 *     (`[!x]` negates) that macOS checks at runtime, so it covers files created later too. A glob
 *     that matches a folder denies the folder itself; its contents need the `/**` twin.
 *
 * So, per job: its folder lives outside the home folder (`<tmp>/tvashtr-grok-…/<job>/`), and the
 * profile `extends = "workspace"` and denies everything in the home folder but `~/.grok` (Grok's own
 * install and sign-in), the user's other Grok conversations (every `~/.grok/sessions` folder but
 * this job's — Grok creates this job's there), other users' folders, `/Volumes`, `/tmp`, every
 * other temp entry and every other job's folder, and the copy's own `.grok/`. The repo's own
 * `.grok/` (its config, MCP servers, hooks, profiles) is set aside for the run and put back as it
 * was before the patch is taken. Before the CLI runs, Tvashtr proves the lock: under the profile,
 * Grok must refuse to read a file beside the job's folder (a model id Grok doesn't know stops it
 * before any model call either way). Anything short of that fails the job closed. The user's own
 * `~/.grok` files are never opened, written or changed here.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const GROK_LOCK_FAILED =
  "Grok Build couldn't lock itself to this job's copy of the repo on this Mac, so Tvashtr didn't " +
  "start it. Nothing on your Mac was opened, and nothing was used from your Grok plan. Update Grok " +
  "Build, or switch this step to Claude.";
const LOCKED_LINE = Object.freeze({
  grok: "Grok Build is locked to this job's copy of the repo — it can't open your other files.",
  claude: "Claude Code is locked to this job's copy of the repo — it can't open your other files.",
});

/** Documented switches that keep Claude's and Cursor's MCP servers and hooks out of a Grok job. */
const GROK_JOB_ENV = Object.freeze({
  GROK_CLAUDE_MCPS_ENABLED: "0",
  GROK_CURSOR_MCPS_ENABLED: "0",
  GROK_CLAUDE_HOOKS_ENABLED: "0",
  GROK_CURSOR_HOOKS_ENABLED: "0",
});

const UNSAFE = /[*?[\]{}\\!^\s]/;
function plain(s, what) {
  if (!s || UNSAFE.test(s)) throw new Error(`can't write a sandbox rule for this ${what}: ${s}`);
  return s;
}
const isGlob = (p) => /[*?[]/.test(p);
const withContents = (list) => list.flatMap((p) => (isGlob(p) ? [p, `${p}/**`] : [p]));

/** Every entry of `parent` except `keep`, and everything inside them. */
function everythingBut(parent, keep) {
  plain(parent, "folder");
  plain(keep, "name");
  const out = [];
  for (let i = 0; i < keep.length; i += 1) {
    const pre = keep.slice(0, i);
    out.push(`${parent}/${pre}[!${keep[i]}]*`);
    if (i > 0) out.push(`${parent}/${pre}`);
  }
  out.push(`${parent}/${keep}?*`);
  return withContents(out);
}

/** Every entry of `parent` whose name doesn't end with `suffix`, and everything inside them. */
function everythingNotEndingIn(parent, suffix) {
  plain(parent, "folder");
  plain(suffix, "name");
  const out = [];
  const n = suffix.length;
  for (let k = 0; k < n; k += 1) {
    out.push(`${parent}/*[!${suffix[n - 1 - k]}]${suffix.slice(n - k)}`);
    if (k > 0) out.push(`${parent}/${suffix.slice(n - k)}`);
  }
  return withContents(out);
}

/** A folder's own listing, not what is inside it: a glob that matches only the folder. */
function listingOf(p) {
  plain(p, "folder");
  return `${p.slice(0, -1)}[${p.slice(-1)}]`;
}

const inside = (child, parent) => child === parent || child.startsWith(`${parent}/`);

/**
 * The deny list for one job. `home` and `grokRoot` are real paths (no symlinks); `grokRoot` sits
 * directly in the temp folder, the job's folder is `<grokRoot>/<jobName>` and its copy of the repo
 * `<grokRoot>/<jobName>/ws`.
 */
function grokDenyList({ home, grokRoot, jobName }) {
  const tmp = path.dirname(grokRoot);
  if (inside(grokRoot, home)) throw new Error("the job folder is inside the home folder");
  const dir = `${grokRoot}/${jobName}`;
  const deny = [
    listingOf(home),
    ...everythingBut(home, ".grok"),
    ...everythingNotEndingIn(`${home}/.grok/sessions`, `${jobName}%2Fws`),
  ];
  if (path.dirname(home) === "/Users") {
    deny.push(listingOf("/Users"), ...everythingBut("/Users", path.basename(home)));
  }
  deny.push("/Volumes");
  if (!inside(tmp, "/private/tmp")) deny.push("/private/tmp");
  deny.push(...everythingBut(tmp, path.basename(grokRoot)));
  deny.push(...everythingBut(grokRoot, jobName));
  deny.push(`${dir}/ws/.grok`, `${dir}/repo-grok`);
  return deny;
}

const profileName = (jobName) => `tvashtr-${jobName}`;
const newJobName = () => `j${crypto.randomBytes(4).toString("hex")}`;

function profileToml(name, deny) {
  return [
    "# Written by Tvashtr Desktop for one job: Grok Build may open this job's copy of the repo only.",
    `[profiles.${name}]`,
    'extends = "workspace"',
    "deny = [",
    ...deny.map((d) => `  ${JSON.stringify(d)},`),
    "]",
    "",
  ].join("\n");
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Set the repo's own `.grok` aside (a folder, a file or a symlink, moved as it is) and write the
 * job's profile in its place. `restore()` removes the profile and puts the repo's `.grok` back.
 */
function lockWorkspace({ dir, ws, name, deny }) {
  const own = path.join(ws, ".grok");
  const aside = path.join(dir, "repo-grok");
  const hadOwn = exists(own);
  if (hadOwn) fs.renameSync(own, aside);
  fs.mkdirSync(own);
  fs.writeFileSync(path.join(own, "sandbox.toml"), profileToml(name, deny), { mode: 0o600 });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    fs.rmSync(own, { recursive: true, force: true });
    if (hadOwn) fs.renameSync(aside, own);
  };
}

/**
 * The lock, proven: under the job's profile Grok must refuse to read a file beside the job's
 * folder. The model id is one Grok doesn't know, so it stops before any model call either way.
 */
function checkLock({ spawn, binaryPath, ws, name, sentinel, env, timeoutMs }) {
  fs.writeFileSync(sentinel, "Tvashtr lock check\n", { mode: 0o600 });
  return new Promise((resolve) => {
    let out = "";
    let timer = null;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.rmSync(sentinel, { force: true });
      resolve(ok);
    };
    let child;
    try {
      child = spawn(
        binaryPath,
        [
          "--prompt-file", sentinel, "--output-format", "streaming-json", "-m", "tvashtr-lock-check",
          "--max-turns", "1", "--cwd", ws, "--tools", "read_file", "--allow", "Read",
          "--sandbox", name,
        ],
        { cwd: ws, env, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      finish(false);
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      finish(false);
    }, timeoutMs);
    const take = (b) => {
      if (out.length < 20000) out += String(b);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", () => finish(false));
    child.on("close", () =>
      finish(out.includes(`Failed to read '${sentinel}'`) && out.includes("Operation not permitted")),
    );
  });
}

/**
 * Lock one Grok job before its CLI runs. Returns the profile to pass as `--sandbox`, the env to run
 * it with, and `restore()` (call it before the patch is taken). Throws an Error whose message is
 * GROK_LOCK_FAILED (its `cause` says why) when the lock can't be applied and proven.
 */
async function lockGrokJob({ dir, ws, jobName, grokRoot, home, binaryPath, env, spawn, platform, timeoutMs }) {
  let restore = null;
  try {
    if (platform !== "darwin") throw new Error(`no kernel sandbox profile for ${platform}`);
    const name = profileName(jobName);
    const deny = grokDenyList({ home: fs.realpathSync(home), grokRoot, jobName });
    const tmp = path.join(dir, "tmp");
    fs.mkdirSync(tmp, { recursive: true });
    const jobEnv = { ...env, ...GROK_JOB_ENV, TMPDIR: `${tmp}/` };
    restore = lockWorkspace({ dir, ws, name, deny });
    const sentinel = `${dir}.lockcheck`;
    if (!(await checkLock({ spawn, binaryPath, ws, name, sentinel, env: jobEnv, timeoutMs }))) {
      throw new Error("Grok read a file its profile denies, or didn't start under the profile");
    }
    return { profile: name, env: jobEnv, restore };
  } catch (cause) {
    if (restore) restore();
    const err = new Error(GROK_LOCK_FAILED);
    err.cause = cause;
    throw err;
  }
}

/** Grok's own words when a requested profile can't be applied (it then refuses to start). */
const REFUSED_PROFILE = /could not apply the '[^']*' sandbox profile|Refusing to start/;

module.exports = {
  GROK_LOCK_FAILED,
  LOCKED_LINE,
  GROK_JOB_ENV,
  REFUSED_PROFILE,
  everythingBut,
  everythingNotEndingIn,
  grokDenyList,
  profileName,
  newJobName,
  profileToml,
  lockWorkspace,
  lockGrokJob,
};
