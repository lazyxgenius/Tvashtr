/**
 * DB-6: the in-app updater — version compare, stage a downloaded DMG (fake hdiutil/ditto/plutil/
 * xattr), fall back to the manual download, and the restart order (guard → installing → release
 * jobs → swap helper → exit). The swap script itself runs on temp dirs with a fake `open`.
 *
 * Run: node --test desktop/scripts/updater.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createUpdater, isNewer, DMG_URL, SWAP_SCRIPT } = require("../electron/updater.cjs");

function harness(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-upd-"));
  const calls = [];
  const states = [];
  const plist = { CFBundleShortVersionString: "0.8.0", CFBundleIdentifier: "dev.tvashtr.desktop" };
  const deps = {
    currentVersion: "0.7.0",
    latestRelease: async () => ({ version: "0.8.0" }),
    bundleInfo: () => ({ bundlePath: "/Applications/Tvashtr.app", bundleWritable: true }),
    updatesDir: path.join(dir, "updates"),
    emit: (s) => states.push(s),
    confirmRestart: () => true,
    stopRunner: async () => calls.push("stopRunner"),
    exit: () => calls.push("exit"),
    openExternal: async (url) => calls.push(`open ${url}`),
    download: async (url, dest) => {
      calls.push(`download ${url}`);
      fs.writeFileSync(dest, "dmg");
    },
    run: async (cmd, args) => {
      calls.push(cmd);
      if (cmd === "ditto") fs.mkdirSync(args[1], { recursive: true });
      if (cmd === "plutil") return `${plist[args[1]]}\n`;
      return "";
    },
    spawnHelper: (args) => calls.push(`swap ${args.slice(1).join(" ")}`),
    pid: 4242,
    ...over,
  };
  return { updater: createUpdater(deps), calls, states, plist, dir };
}

test("isNewer compares numerically, not as text", () => {
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("v1.0.0", "0.99.0"), true);
  assert.equal(isNewer("0.7.0", "0.7.0"), false);
  assert.equal(isNewer("0.6.9", "0.7.0"), false);
});

test("a newer release is downloaded from the stable link, staged and ready", async () => {
  const { updater, calls, states } = harness();
  const out = await updater.check();
  assert.deepEqual(out, { state: "ready", version: "0.8.0" });
  assert.equal(calls[0], `download ${DMG_URL}`);
  assert.deepEqual(calls.slice(1), ["hdiutil", "ditto", "hdiutil", "plutil", "plutil", "xattr"]);
  assert.equal(states[0].state, "downloading");
  assert.deepEqual(updater.getState(), { state: "ready", version: "0.8.0" });
});

test("download progress reaches the page once per whole percent, not per chunk", async () => {
  const { updater, states } = harness({
    download: async (url, dest, onProgress) => {
      for (let seen = 1; seen <= 5000; seen += 1) onProgress(seen / 5000); // 5000 chunks
      fs.writeFileSync(dest, "dmg");
    },
  });
  await updater.check();
  const downloading = states.filter((s) => s.state === "downloading");
  assert.ok(downloading.length <= 102, `${downloading.length} progress messages`);
  assert.equal(downloading.at(-1).progress, 1);
});

test("same or older version: stays idle, nothing downloaded", async () => {
  const { updater, calls } = harness({ latestRelease: async () => ({ version: "0.7.0" }) });
  assert.deepEqual(await updater.check(), { state: "idle" });
  assert.deepEqual(calls, []);
});

test("an unknown release (GitHub unreachable → nulls) or a failed check stays idle", async () => {
  const a = harness({ latestRelease: async () => ({ version: null }) });
  assert.deepEqual(await a.updater.check(), { state: "idle" });
  const b = harness({
    latestRelease: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(await b.updater.check(), { state: "idle" });
});

test("a bundle that can't be replaced in place → manual not_writable", async () => {
  const { updater, calls } = harness({
    bundleInfo: () => ({ bundlePath: "/Volumes/Tvashtr/Tvashtr.app", bundleWritable: false }),
  });
  assert.deepEqual(await updater.check(), {
    state: "manual",
    version: "0.8.0",
    reason: "not_writable",
  });
  assert.deepEqual(calls, []);
});

test("a download or a staged app of the wrong version → manual download_failed", async () => {
  const a = harness({
    download: async () => {
      throw new Error("HTTP 404");
    },
  });
  assert.equal((await a.updater.check()).reason, "download_failed");
  const b = harness();
  b.plist.CFBundleShortVersionString = "0.7.5";
  assert.equal((await b.updater.check()).reason, "download_failed");
  assert.equal(fs.existsSync(path.join(b.dir, "updates")), false);
});

test("restart: guard, installing, release jobs, swap helper, exit — in that order", async () => {
  const { updater, calls, states } = harness();
  await updater.check();
  calls.length = 0;
  await updater.restartToUpdate();
  assert.deepEqual(states.at(-1), { state: "installing", version: "0.8.0" });
  assert.equal(calls[0], "stopRunner");
  assert.match(calls[1], /^swap \/Applications\/Tvashtr\.app .*updates\/Tvashtr\.app$/);
  assert.equal(calls[2], "exit");
});

test("restart: Keep editing cancels; a swap that can't start → manual swap_failed", async () => {
  const kept = harness({ confirmRestart: () => false });
  await kept.updater.check();
  await kept.updater.restartToUpdate();
  assert.deepEqual(kept.updater.getState(), { state: "ready", version: "0.8.0" });
  assert.equal(kept.calls.includes("exit"), false);

  const failed = harness({
    spawnHelper: () => {
      throw new Error("no sh");
    },
  });
  await failed.updater.check();
  await failed.updater.restartToUpdate();
  assert.equal(failed.updater.getState().reason, "swap_failed");
  assert.equal(failed.calls.includes("exit"), false);
});

test("openDownload opens the stable DMG link", async () => {
  const { updater, calls } = harness();
  await updater.openDownload();
  assert.deepEqual(calls, [`open ${DMG_URL}`]);
});

test("the swap script moves the staged app in and opens it once the old app exited", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-swap-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "open"), `#!/bin/sh\necho "$1" > "${dir}/opened"\n`, {
    mode: 0o755,
  });
  const app = path.join(dir, "Tvashtr.app");
  const staged = path.join(dir, "updates", "Tvashtr.app");
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, "v"), "old");
  fs.mkdirSync(staged, { recursive: true });
  fs.writeFileSync(path.join(staged, "v"), "new");
  const gone = childProcess.spawnSync(process.execPath, ["-e", "0"]).pid;
  childProcess.execFileSync("/bin/sh", ["-c", SWAP_SCRIPT, "t", String(gone), app, staged], {
    env: { PATH: `${bin}:/bin:/usr/bin` },
  });
  assert.equal(fs.readFileSync(path.join(app, "v"), "utf8"), "new");
  assert.equal(fs.existsSync(staged), false);
  assert.deepEqual(
    fs.readdirSync(dir).filter((f) => f.includes(".old-")),
    [],
  );
  assert.equal(fs.readFileSync(path.join(dir, "opened"), "utf8").trim(), app);
});
