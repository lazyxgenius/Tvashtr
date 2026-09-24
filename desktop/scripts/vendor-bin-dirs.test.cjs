/**
 * M-subs-desktop (A1): a Dock-launched app sees launchd's thin PATH, so a CLI installed by its
 * vendor's own installer (`~/.grok/bin/grok`, `~/.claude/local/claude`, `~/.local/bin/claude`)
 * must still be found. Only the executable path is ever touched under ~/.grok and ~/.claude.
 *
 * Run: node --test desktop/scripts/vendor-bin-dirs.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectCliBinary, listCandidateDirs } = require("../electron/harness/pathDetect.cjs");

// launchd's default PATH for a GUI app opened from the Dock / Finder.
const DOCK_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

function fakeHomeWith(relBin) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tv-home-"));
  const bin = path.join(home, relBin);
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "#!/bin/sh\necho fake\n", { mode: 0o755 });
  return { home, bin };
}

test("Dock-style PATH finds grok installed by the xAI installer in ~/.grok/bin", async () => {
  const { home, bin } = fakeHomeWith(".grok/bin/grok");
  const det = await detectCliBinary("grok", {
    env: { PATH: DOCK_PATH, HOME: home },
    homedir: () => home,
    platform: "darwin",
    npmGlobalBin: null,
  });
  assert.equal(det.installed, true, "grok in ~/.grok/bin must not read as needs_install");
  assert.equal(det.binaryPath, bin);
});

test("Dock-style PATH finds claude installed by the Anthropic installer in ~/.claude/local", async () => {
  const { home, bin } = fakeHomeWith(".claude/local/claude");
  const det = await detectCliBinary("claude", {
    env: { PATH: DOCK_PATH, HOME: home },
    homedir: () => home,
    platform: "darwin",
    npmGlobalBin: null,
  });
  assert.equal(det.installed, true);
  assert.equal(det.binaryPath, bin);
});

test("Dock-style PATH finds the native claude in ~/.local/bin", async () => {
  const { home, bin } = fakeHomeWith(".local/bin/claude");
  const det = await detectCliBinary("claude", {
    env: { PATH: DOCK_PATH, HOME: home },
    homedir: () => home,
    platform: "darwin",
    npmGlobalBin: null,
  });
  assert.equal(det.installed, true);
  assert.equal(det.binaryPath, bin);
});

test("vendor dirs under ~/.grok and ~/.claude are exactly the bin dirs (nothing else there)", async () => {
  const home = "/Users/someone";
  const dirs = await listCandidateDirs({
    homedir: () => home,
    env: {},
    platform: "darwin",
    npmGlobalBin: null,
    listDir: async () => [],
  });
  const vendorScoped = dirs.filter(
    (d) => d.startsWith(path.join(home, ".grok")) || d.startsWith(path.join(home, ".claude")),
  );
  assert.deepEqual(vendorScoped.sort(), [
    path.join(home, ".claude", "local"),
    path.join(home, ".grok", "bin"),
  ]);
  assert.ok(dirs.includes(path.join(home, ".local", "bin")));
});
