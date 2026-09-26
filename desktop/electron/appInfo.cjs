/**
 * Bridge v6 `app.getInfo()` (DB-3): the running app's version (desktop/package.json via
 * `app.getVersion()`), the API it talks to, and whether its bundle could be swapped in place by an
 * updater (a writable `Tvashtr.app` that isn't on a mounted DMG or translocated by Gatekeeper).
 */
const fs = require("fs");
const path = require("path");

/**
 * The `.app` bundle holding `exePath` (…/Tvashtr.app/Contents/MacOS/Tvashtr), or null.
 * @param {string} exePath
 */
function bundlePathFor(exePath) {
  const macos = path.dirname(exePath);
  const contents = path.dirname(macos);
  const bundle = path.dirname(contents);
  if (path.basename(macos) !== "MacOS" || path.basename(contents) !== "Contents") return null;
  return bundle.endsWith(".app") ? bundle : null;
}

/**
 * @param {{ version: string, apiOrigin: string, platform: string, exePath: string,
 *   isPackaged: boolean, access?: (p: string, mode: number) => void }} deps
 */
function appInfo({ version, apiOrigin, platform, exePath, isPackaged, access = fs.accessSync }) {
  let apiHost = "";
  try {
    apiHost = new URL(apiOrigin).host;
  } catch {
    /* keep empty */
  }
  const bundlePath = isPackaged && platform === "darwin" ? bundlePathFor(exePath) : null;
  let bundleWritable = false;
  if (bundlePath && !bundlePath.startsWith("/Volumes/") && !bundlePath.includes("/AppTranslocation/")) {
    try {
      access(bundlePath, fs.constants.W_OK);
      access(path.dirname(bundlePath), fs.constants.W_OK);
      bundleWritable = true;
    } catch {
      bundleWritable = false;
    }
  }
  return { version, apiOrigin, apiHost, platform, bundlePath, bundleWritable };
}

module.exports = { appInfo, bundlePathFor };
