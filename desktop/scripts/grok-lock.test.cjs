/**
 * M-desk-7 S4: the kernel sandbox profile Tvashtr writes for each Grok job — its deny list (from a
 * fake HOME), the profile file Grok reads, and the repo's own `.grok/` set aside and put back.
 * The deny semantics are Grok's documented ones (fixtures/grokSandbox.cjs); the live proof is the
 * real CLI refusing the probe set (STATE.md, M-desk-7 S4_GREEN).
 *
 * Run: node --test desktop/scripts/grok-lock.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  grokDenyList,
  profileName,
  profileToml,
  lockWorkspace,
  newJobName,
  GLOB_BUDGET,
} = require("../electron/runner/grokLock.cjs");
const { denies, readProfile } = require("./fixtures/grokSandbox.cjs");

const HOME = "/Users/alice";
const ROOT = "/private/var/folders/x1/abc/T/tvg-1a2b3c";
const JOB = "j0123ab";
const DIR = `${ROOT}/${JOB}`;
const USERS = ["/Users/Shared", "/Users/bob", "/Users/.localized"];
const deny = grokDenyList({ home: HOME, grokRoot: ROOT, jobName: JOB, userDirs: USERS });

test("a Grok job can't open anything outside its own copy: the probe set is denied", () => {
  for (const p of [
    `${HOME}/tvashtr-s4-canary/secret.txt`,
    `${HOME}/Desktop/Tvashtr/Makefile`,
    `${HOME}/Desktop/trade_mcp/README.md`,
    `${HOME}/Library/Application Support/Tvashtr/runner-jobs/claude-job/ws/a.py`,
    `${ROOT}/jdeadbeef/ws/OTHER.txt`,
    `${ROOT}/${JOB}.lockcheck`,
    `${ROOT}/${JOB}0`,
    `${ROOT}/j0123abc`,
    `${HOME}/.ssh/id_ed25519`,
    `${HOME}/.ssh`,
    "/Volumes/Backup/x",
    "/Users/Shared/notes.txt",
    "/Users/bob/Documents/x",
    `${HOME}/.grok/sessions/%2FUsers%2Falice%2Fcode%2Fws/01abc/messages.jsonl`,
    `${HOME}/.grok/sessions/session_search.sqlite`,
    `${HOME}/.grokrc`,
    `${HOME}/.gitconfig`,
    `${HOME}/.config/gh/hosts.yml`,
    "/private/tmp/claude-501/x",
    "/private/var/folders/x1/abc/T/other-app/cache",
    "/private/var/folders/x1/abc/T/tvg-999999/jffffff/ws/a",
    `${DIR}/ws/.grok/sandbox.toml`,
    `${DIR}/repo-grok/config.toml`,
    HOME,
    "/Users",
  ]) {
    assert.ok(denies(deny, p), `should be denied: ${p}`);
  }
});

test("…and what it needs stays open: its copy, its prompt, its temp, Grok's own install and sign-in", () => {
  for (const p of [
    `${DIR}/ws/core/indicators.py`,
    `${DIR}/ws`,
    `${DIR}/prompt.txt`,
    `${DIR}/tmp/x`,
    `${HOME}/.grok/auth.json`,
    `${HOME}/.grok/bin/grok-1.0.46`,
    `${HOME}/.grok/sessions`,
    `${HOME}/.grok/sessions/%2Fprivate%2Fvar%2Ffolders%2Fx1%2Fabc%2FT%2Ftvg-1a2b3c%2F${JOB}%2Fws/01abc/x`,
    "/usr/bin/git",
    "/System/Library/Frameworks/Security.framework/Security",
    "/private/etc/hosts",
    "/opt/homebrew/bin/rg",
    "/Applications/Xcode.app",
  ]) {
    assert.ok(!denies(deny, p), `should stay open: ${p}`);
  }
});

test("the profile is named for the job and reads back as written", () => {
  const name = profileName(JOB);
  assert.equal(name, "tvashtr-j0123ab");
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tv-ws-"));
  fs.mkdirSync(path.join(ws, ".grok"));
  fs.writeFileSync(path.join(ws, ".grok", "sandbox.toml"), profileToml(name, deny));
  assert.deepEqual(readProfile(ws, name), deny);
  assert.match(fs.readFileSync(path.join(ws, ".grok", "sandbox.toml"), "utf8"), /^extends = "workspace"$/m);
  assert.match(newJobName(), /^j[0-9a-f]{6}$/);
});

test("a path the profile can't express safely fails closed instead of guessing", () => {
  assert.throws(() => grokDenyList({ home: "/Users/a b", grokRoot: ROOT, jobName: JOB }));
  assert.throws(() => grokDenyList({ home: "/Users/a[1]", grokRoot: ROOT, jobName: JOB }));
  assert.throws(() => grokDenyList({ home: HOME, grokRoot: `${HOME}/tmp/tvashtr-grok`, jobName: JOB }));
});

test("a profile stays inside the glob budget Seatbelt can compile, and one over it is never written", () => {
  // grok 1.0.46 refused a 120-glob profile ("too many levels of backtracking"): names stay short.
  const globs = deny.filter((d) => /[*?[]/.test(d)).length;
  assert.ok(globs <= GLOB_BUDGET, `${globs} globs`);
  assert.equal(globs, 76);
  assert.throws(
    () => grokDenyList({ home: HOME, grokRoot: "/private/var/folders/x1/abc/T/tvashtr-grok-a-much-longer-name", jobName: "j0123abcdef" }),
    /budget/,
  );
});

function treeHash(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      h.update(`${path.relative(dir, p)}\0${st.mode}\0`);
      if (st.isSymbolicLink()) h.update(fs.readlinkSync(p));
      else if (st.isDirectory()) walk(p);
      else h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

test("the repo's own .grok/ is set aside for the run and comes back byte-identical", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-job-"));
  const ws = path.join(dir, "ws");
  const own = path.join(ws, ".grok");
  fs.mkdirSync(path.join(own, "hooks"), { recursive: true });
  fs.writeFileSync(path.join(own, "config.toml"), '[mcp_servers.x]\ncommand = "touch"\n');
  fs.writeFileSync(path.join(own, "sandbox.toml"), `[profiles.${profileName(JOB)}]\nextends = "off"\n`);
  fs.writeFileSync(path.join(own, "hooks", "a.json"), "{}", { mode: 0o755 });
  fs.symlinkSync("/etc/hosts", path.join(own, "link"));
  const before = treeHash(own);

  const restore = lockWorkspace({ dir, ws, name: profileName(JOB), deny });
  assert.deepEqual(fs.readdirSync(own), ["sandbox.toml"], "only the job's profile is there for the run");
  assert.deepEqual(readProfile(ws, profileName(JOB)), deny);
  fs.writeFileSync(path.join(own, "config.toml"), "written during the run");
  restore();
  restore();
  assert.equal(treeHash(own), before);
  assert.ok(!fs.existsSync(path.join(dir, "repo-grok")));
});

test("a repo whose .grok is a symlink: moved as it is, never followed, and put back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-job-"));
  const ws = path.join(dir, "ws");
  fs.mkdirSync(ws);
  fs.symlinkSync("/Users/someone/.grok", path.join(ws, ".grok")); // a user's Grok home, never opened
  const restore = lockWorkspace({ dir, ws, name: profileName(JOB), deny });
  assert.ok(fs.lstatSync(path.join(ws, ".grok")).isDirectory(), "the job's own folder, not the link");
  assert.ok(fs.lstatSync(path.join(dir, "repo-grok")).isSymbolicLink());
  restore();
  assert.equal(fs.readlinkSync(path.join(ws, ".grok")), "/Users/someone/.grok");
});

test("a repo with no .grok gets none back", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-job-"));
  const ws = path.join(dir, "ws");
  fs.mkdirSync(ws);
  const restore = lockWorkspace({ dir, ws, name: profileName(JOB), deny });
  restore();
  assert.deepEqual(fs.readdirSync(ws), []);
});
