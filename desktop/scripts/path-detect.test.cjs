/**
 * Run: node desktop/scripts/path-detect.test.cjs
 *
 * TDD for Desktop harness PATH enrichment + absolute binary probe
 * (Dock-launched Electron PATH ≠ Terminal).
 */
const assert = require("assert");
const path = require("path");
const {
  FIXED_UNIX_DIRS,
  listCandidateDirs,
  listBinaryCandidates,
  enrichPathString,
  resolveNpmGlobalBin,
  detectCliBinary,
} = require("../electron/harness/pathDetect.cjs");

async function run() {
  // --- candidate dirs include Homebrew / npm-global / local / nvm / fnm ---
  const dirs = await listCandidateDirs({
    homedir: () => "/Users/ada",
    env: { FNM_MULTISHELL_PATH: "/tmp/fnm-multi/bin" },
    platform: "darwin",
    npmGlobalBin: "/Users/ada/.nvm/versions/node/v22.0.0/lib/../bin-global",
    listDir: async (dir) => {
      if (dir.endsWith(path.join(".nvm", "versions", "node"))) {
        return ["v20.11.0", "v22.0.0"];
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  for (const required of [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/Users/ada/.local/bin",
    "/Users/ada/.npm-global/bin",
    "/Users/ada/.nvm/versions/node/v20.11.0/bin",
    "/Users/ada/.nvm/versions/node/v22.0.0/bin",
    "/tmp/fnm-multi/bin",
    "/Users/ada/.local/share/fnm/aliases/default/bin",
  ]) {
    assert.ok(dirs.includes(required), `missing candidate dir ${required}; got ${dirs.join(",")}`);
  }
  assert.ok(dirs.includes("/Users/ada/.nvm/versions/node/v22.0.0/lib/../bin-global"));
  assert.deepStrictEqual(FIXED_UNIX_DIRS, ["/usr/local/bin", "/opt/homebrew/bin"]);

  // --- binary candidates ---
  const bins = listBinaryCandidates("grok", ["/opt/homebrew/bin", "/Users/ada/.npm-global/bin"], "darwin");
  assert.deepStrictEqual(bins, [
    "/opt/homebrew/bin/grok",
    "/Users/ada/.npm-global/bin/grok",
  ]);
  const winBins = listBinaryCandidates("claude", ["C:\\\\Users\\\\ada\\\\AppData\\\\Roaming\\\\npm"], "win32");
  assert.ok(winBins.some((p) => p.endsWith("claude.cmd")));
  assert.ok(winBins.some((p) => p.endsWith("claude.exe")));

  // --- enrich PATH prepends dirs, preserves existing, dedupes ---
  const enriched = enrichPathString("/usr/bin:/bin", ["/opt/homebrew/bin", "/usr/bin"], "darwin");
  assert.strictEqual(enriched, "/opt/homebrew/bin:/usr/bin:/bin");

  // --- resolveNpmGlobalBin: prefix -g → …/bin ---
  const npmBin = await resolveNpmGlobalBin({
    platform: "darwin",
    env: { PATH: "/usr/bin" },
    execFile: async (cmd, args) => {
      assert.strictEqual(cmd, "npm");
      if (args.join(" ") === "prefix -g") return { stdout: "/usr/local\n" };
      throw new Error("unexpected " + args.join(" "));
    },
  });
  assert.strictEqual(npmBin, path.join("/usr/local", "bin"));

  // --- resolveNpmGlobalBin: falls back to bin -g; never throws ---
  const npmBin2 = await resolveNpmGlobalBin({
    platform: "darwin",
    env: {},
    execFile: async (_cmd, args) => {
      if (args[0] === "prefix") {
        const e = new Error("fail");
        e.code = 1;
        throw e;
      }
      if (args.join(" ") === "bin -g") return { stdout: "/home/ada/.npm-global/bin\n" };
      throw new Error("no");
    },
  });
  assert.strictEqual(npmBin2, "/home/ada/.npm-global/bin");

  const npmGone = await resolveNpmGlobalBin({
    execFile: async () => {
      throw new Error("npm missing");
    },
  });
  assert.strictEqual(npmGone, null);

  // --- detect: which with enriched PATH succeeds ---
  const whichCalls = [];
  const detWhich = await detectCliBinary("grok", {
    platform: "darwin",
    homedir: () => "/Users/ada",
    env: { PATH: "/usr/bin" },
    npmGlobalBin: null, // skip npm spawn
    listDir: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    pathExists: async () => false,
    execFile: async (cmd, args, opts) => {
      whichCalls.push({ cmd, args, path: opts && opts.env && opts.env.PATH });
      if (cmd === "which" && args[0] === "grok") {
        assert.ok(
          String(opts.env.PATH).includes("/opt/homebrew/bin"),
          "which must see enriched PATH",
        );
        return { stdout: "/opt/homebrew/bin/grok\n" };
      }
      throw new Error("unexpected " + cmd);
    },
  });
  assert.strictEqual(detWhich.installed, true);
  assert.strictEqual(detWhich.binaryPath, "/opt/homebrew/bin/grok");
  assert.strictEqual(whichCalls.length, 1);

  // --- detect: which fails → absolute candidate via pathExists ---
  const detAbs = await detectCliBinary("claude", {
    platform: "darwin",
    homedir: () => "/Users/ada",
    env: { PATH: "/usr/bin" },
    npmGlobalBin: null,
    listDir: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    pathExists: async (p) => p === "/Users/ada/.npm-global/bin/claude",
    execFile: async (cmd, args) => {
      if (cmd === "which") {
        const e = new Error("not found");
        e.code = 1;
        throw e;
      }
      throw new Error("unexpected " + cmd + " " + args.join(" "));
    },
  });
  assert.strictEqual(detAbs.installed, true);
  assert.strictEqual(detAbs.binaryPath, "/Users/ada/.npm-global/bin/claude");

  // --- detect: which fails → npm prefix enrich → which succeeds ---
  const detNpm = await detectCliBinary("codex", {
    platform: "linux",
    homedir: () => "/home/ada",
    env: { PATH: "/usr/bin" },
    // npmGlobalBin undefined → will call npm after first which miss
    listDir: async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
    pathExists: async () => false,
    execFile: async (cmd, args, opts) => {
      if (cmd === "which" && args[0] === "codex") {
        if (opts.env.PATH.includes("/home/ada/.npm-global/bin")) {
          return { stdout: "/home/ada/.npm-global/bin/codex\n" };
        }
        const e = new Error("not found");
        e.code = 1;
        throw e;
      }
      if (cmd === "npm" && args.join(" ") === "prefix -g") {
        return { stdout: "/home/ada/.npm-global\n" };
      }
      throw new Error("unexpected " + cmd + " " + args.join(" "));
    },
  });
  assert.strictEqual(detNpm.installed, true);
  assert.strictEqual(detNpm.binaryPath, "/home/ada/.npm-global/bin/codex");

  // --- detect: still missing ---
  const detMiss = await detectCliBinary("grok", {
    platform: "linux",
    homedir: () => "/home/ada",
    env: { PATH: "/usr/bin" },
    npmGlobalBin: null,
    listDir: async () => [],
    pathExists: async () => false,
    execFile: async (cmd) => {
      if (cmd === "which") {
        const e = new Error("not found");
        e.code = 1;
        throw e;
      }
      throw new Error("no npm");
    },
  });
  assert.strictEqual(detMiss.installed, false);
  assert.strictEqual(detMiss.binaryPath, null);

  console.log("path-detect.test.cjs OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
