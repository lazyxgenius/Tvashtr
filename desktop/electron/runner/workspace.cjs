/**
 * The job's OWN temporary copy of the repo (M-subs-desktop §3.0 "give every job its own temporary
 * copy"). The snapshot tarball is unpacked into a fresh dir, committed as a throwaway base, and
 * after the CLI finishes the change comes back as `git diff --binary` against that base.
 *
 * Sidecar files the control plane harvests (REPORT.md, REVIEW_VERDICT.json, …) are gitignored in
 * greenfield workspaces so they never ship — they are force-added on BOTH sides of the diff so the
 * patch carries exactly what the CLI changed about them.
 *
 * M-desk-7 S4: git's own folder lives beside the copy (`<dir>/git`), never in it, and every `.git`
 * in the copy (a nested repo the repo ships, or one the CLI wrote) is removed before git looks:
 * git runs here outside any sandbox, and config it found in the copy (`core.fsmonitor`, a nested
 * repo's own config) would run commands as the user.
 */
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const childProcess = require("child_process");

const defaultExecFile = promisify(childProcess.execFile);

const GIT_ISOLATION = [
  "-c",
  "user.name=Tvashtr Desktop",
  "-c",
  "user.email=desktop-runner@tvashtr.local",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.autocrlf=false",
];

/** Remove every `.git` under ``root`` (folders, files, links; symlinked folders aren't followed). */
function dropGitFolders(root) {
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.name === ".git") fs.rmSync(p, { recursive: true, force: true });
    else if (ent.isDirectory()) dropGitFolders(p);
  }
}

function createWorkspaceOps({ execFile = defaultExecFile } = {}) {
  async function git(dir, ws, env, args, opts = {}) {
    const where = [`--git-dir=${path.join(dir, "git")}`, `--work-tree=${ws}`];
    const { stdout } = await execFile("git", [...GIT_ISOLATION, ...where, ...args], {
      cwd: ws,
      env: { ...env, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      ...opts,
    });
    return String(stdout || "");
  }

  function existingSidecars(ws, sidecars) {
    return (sidecars || []).filter(
      (s) => !s.includes("..") && !path.isAbsolute(s) && fs.existsSync(path.join(ws, s)),
    );
  }

  async function stage(dir, ws, env, sidecars) {
    dropGitFolders(ws);
    await git(dir, ws, env, ["add", "-A"]);
    const present = existingSidecars(ws, sidecars);
    if (present.length) await git(dir, ws, env, ["add", "-f", "--", ...present]);
  }

  /** Unpack the snapshot into ``ws`` and commit it as the base. Returns the base sha. */
  async function materialize({ tarball, dir, ws, env, sidecars }) {
    fs.mkdirSync(ws, { recursive: true });
    const tgz = path.join(dir, "snapshot.tgz");
    fs.writeFileSync(tgz, tarball);
    await execFile("tar", ["-xzf", tgz, "-C", ws], { env, maxBuffer: 64 * 1024 * 1024 });
    fs.rmSync(tgz, { force: true });
    await git(dir, ws, env, ["init", "-q"]);
    await stage(dir, ws, env, sidecars);
    await git(dir, ws, env, ["commit", "-q", "--allow-empty", "--no-verify", "-m", "tvashtr job base"]);
    return (await git(dir, ws, env, ["rev-parse", "HEAD"])).trim();
  }

  /** Everything the CLI changed, as a binary-safe patch against ``base``. */
  async function diff({ dir, ws, env, base, sidecars }) {
    await stage(dir, ws, env, sidecars);
    return git(dir, ws, env, ["diff", "--cached", "--binary", "--no-color", "--no-ext-diff", base]);
  }

  return { materialize, diff };
}

module.exports = { createWorkspaceOps };
