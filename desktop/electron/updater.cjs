/**
 * Bridge v6 `update` (DB-6, desktop-app.md §4): compare the running version with the latest
 * `desktop-v*` release (`GET /api/desktop/release`), download the stable `Tvashtr-mac.dmg`, stage
 * `Tvashtr.app` under userData/updates, and on "Restart to update" swap the bundle and relaunch.
 *
 * States: idle → downloading → ready → installing, or `manual` (the bundle can't be replaced in
 * place, or the download / swap failed) — the page then offers "Download update" (the same stable
 * link, opened in the browser) plus the `xattr` line. The app is unsigned, so the staged copy's
 * quarantine flag is cleared here (a Node download sets none; the DMG's contents may carry one).
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const childProcess = require("child_process");

/** Mirrors frontend/src/lib/desktopDownload.ts — never one pinned version. */
const DMG_URL = "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg";
const APP_ID = "dev.tvashtr.desktop";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Numeric semver compare (major.minor.patch): true when `a` is newer than `b`. */
function isNewer(a, b) {
  const parts = (v) =>
    String(v)
      .replace(/^v/, "")
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/** GET `url` into `dest`, following GitHub's redirects; `onProgress(0..1)` when the size is known. */
function downloadFile(url, dest, onProgress = () => {}, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 30_000 }, (res) => {
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        resolve(downloadFile(next, dest, onProgress, redirects - 1));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`download failed: HTTP ${code}`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let seen = 0;
      res.on("data", (chunk) => {
        seen += chunk.length;
        if (total) onProgress(Math.min(1, seen / total));
      });
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("download timed out")));
    req.on("error", reject);
  });
}

/** Run a macOS tool; resolves with its stdout. */
function runTool(cmd, args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, { timeout: 120_000 }, (err, stdout) =>
      err ? reject(err) : resolve(String(stdout)),
    );
  });
}

/** Waits for the old app to exit, swaps the bundles (rolling back on failure) and opens the app. */
const SWAP_SCRIPT = `pid="$1"; app="$2"; staged="$3"; old="$app.old-$$"
while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done
if mv "$app" "$old"; then
  if mv "$staged" "$app"; then rm -rf "$old"; else mv "$old" "$app"; fi
fi
open "$app"`;

function spawnSwapHelper(args) {
  const child = childProcess.spawn("/bin/sh", ["-c", SWAP_SCRIPT, "tvashtr-swap", ...args], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * @param {{
 *   currentVersion: string,
 *   latestRelease: () => Promise<{ version?: unknown } | null>,
 *   bundleInfo: () => { bundlePath: string | null, bundleWritable: boolean },
 *   updatesDir: string,
 *   emit: (state: object) => void,
 *   confirmRestart: () => boolean,
 *   stopRunner: () => Promise<void>,
 *   exit: () => void,
 *   openExternal: (url: string) => Promise<void> | void,
 *   download?: typeof downloadFile,
 *   run?: typeof runTool,
 *   spawnHelper?: typeof spawnSwapHelper,
 *   pid?: number,
 * }} deps
 */
function createUpdater({
  currentVersion,
  latestRelease,
  bundleInfo,
  updatesDir,
  emit,
  confirmRestart,
  stopRunner,
  exit,
  openExternal,
  download = downloadFile,
  run = runTool,
  spawnHelper = spawnSwapHelper,
  pid = process.pid,
}) {
  /** @type {any} */
  let state = { state: "idle" };
  /** @type {Promise<any> | null} */
  let checking = null;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const staged = path.join(updatesDir, "Tvashtr.app");

  const set = (next) => {
    state = next;
    emit(next);
    return next;
  };

  async function stage(version) {
    fs.rmSync(updatesDir, { recursive: true, force: true });
    fs.mkdirSync(updatesDir, { recursive: true });
    const dmg = path.join(updatesDir, "Tvashtr-mac.dmg");
    const mount = path.join(updatesDir, "mnt");
    // Tell the page once per whole percent, not per HTTP chunk (each message re-renders the app).
    let percent = -1;
    await download(DMG_URL, dmg, (progress) => {
      if (Math.floor(progress * 100) === percent) return;
      percent = Math.floor(progress * 100);
      set({ state: "downloading", version, progress });
    });
    fs.mkdirSync(mount);
    await run("hdiutil", ["attach", dmg, "-nobrowse", "-readonly", "-mountpoint", mount]);
    try {
      await run("ditto", [path.join(mount, "Tvashtr.app"), staged]);
    } finally {
      await run("hdiutil", ["detach", mount, "-force"]).catch(() => {});
    }
    const plist = path.join(staged, "Contents", "Info.plist");
    const read = async (key) => (await run("plutil", ["-extract", key, "raw", plist])).trim();
    if ((await read("CFBundleShortVersionString")) !== version) {
      throw new Error("the downloaded app isn't the expected version");
    }
    if ((await read("CFBundleIdentifier")) !== APP_ID) throw new Error("not Tvashtr");
    await run("xattr", ["-dr", "com.apple.quarantine", staged]);
    fs.rmSync(dmg, { force: true });
  }

  /** Ask for the latest release; download and stage it when it's newer. Never rejects. */
  function check() {
    if (checking) return checking;
    if (state.state !== "idle" && state.state !== "manual") return Promise.resolve(state);
    checking = (async () => {
      let version = null;
      try {
        const rel = await latestRelease();
        if (rel && typeof rel.version === "string") version = rel.version;
      } catch {
        return state; // offline: try again at the next check
      }
      if (!version || !isNewer(version, currentVersion)) return state;
      const info = bundleInfo();
      if (!info.bundlePath || !info.bundleWritable) {
        return set({ state: "manual", version, reason: "not_writable" });
      }
      try {
        set({ state: "downloading", version, progress: 0 });
        await stage(version);
        return set({ state: "ready", version });
      } catch {
        fs.rmSync(updatesDir, { recursive: true, force: true });
        return set({ state: "manual", version, reason: "download_failed" });
      }
    })().finally(() => {
      checking = null;
    });
    return checking;
  }

  /**
   * "Restart to update" (DT-45): the unsaved-changes guard first ("Keep editing" cancels), then
   * installing (the page shows DtF-Upd-2), hand running jobs back, swap after exit, relaunch.
   */
  async function restartToUpdate() {
    if (state.state !== "ready") return;
    const { version } = state;
    if (!confirmRestart()) return;
    set({ state: "installing", version });
    try {
      await stopRunner();
    } catch {
      /* best effort: the server re-queues a stale job anyway */
    }
    const { bundlePath } = bundleInfo();
    try {
      if (!bundlePath) throw new Error("no bundle");
      spawnHelper([String(pid), bundlePath, staged]);
    } catch {
      set({ state: "manual", version, reason: "swap_failed" });
      return;
    }
    exit();
  }

  return {
    getState: () => state,
    check,
    restartToUpdate,
    openDownload: async () => {
      await openExternal(DMG_URL);
    },
    /** Check after launch, then every 6 hours. */
    start(firstDelayMs = 15_000) {
      if (timer) return;
      const first = setTimeout(() => void check(), firstDelayMs);
      first.unref?.();
      timer = setInterval(() => void check(), CHECK_EVERY_MS);
      timer.unref?.();
    },
  };
}

module.exports = { createUpdater, isNewer, DMG_URL, SWAP_SCRIPT };
