/**
 * The job's OWN temporary copy of the repo (M-subs-desktop §3.0 "give every job its own temporary
 * copy"). The snapshot tarball is unpacked into a fresh dir, committed as a throwaway base, and
 * after the CLI finishes the change comes back as `git diff --binary` against that base.
 *
 * Sidecar files the control plane harvests (REPORT.md, REVIEW_VERDICT.json, …) are gitignored in
 * greenfield workspaces so they never ship — they are force-added on BOTH sides of the diff so the
 * patch carries exactly what the CLI changed about them.
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

function createWorkspaceOps({ execFile = defaultExecFile } = {}) {
  async function git(ws, env, args, opts = {}) {
    const { stdout } = await execFile("git", [...GIT_ISOLATION, ...args], {
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

  async function stage(ws, env, sidecars) {
    await git(ws, env, ["add", "-A"]);
    const present = existingSidecars(ws, sidecars);
    if (present.length) await git(ws, env, ["add", "-f", "--", ...present]);
  }

  /** Unpack the snapshot into ``ws`` and commit it as the base. Returns the base sha. */
  async function materialize({ tarball, dir, ws, env, sidecars }) {
    fs.mkdirSync(ws, { recursive: true });
    const tgz = path.join(dir, "snapshot.tgz");
    fs.writeFileSync(tgz, tarball);
    await execFile("tar", ["-xzf", tgz, "-C", ws], { env, maxBuffer: 64 * 1024 * 1024 });
    fs.rmSync(tgz, { force: true });
    await git(ws, env, ["init", "-q"]);
    await stage(ws, env, sidecars);
    await git(ws, env, ["commit", "-q", "--allow-empty", "--no-verify", "-m", "tvashtr job base"]);
    return (await git(ws, env, ["rev-parse", "HEAD"])).trim();
  }

  /** Everything the CLI changed, as a binary-safe patch against ``base``. */
  async function diff({ ws, env, base, sidecars }) {
    await stage(ws, env, sidecars);
    return git(ws, env, ["diff", "--cached", "--binary", "--no-color", "--no-ext-diff", base]);
  }

  return { materialize, diff };
}

module.exports = { createWorkspaceOps };
