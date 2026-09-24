/**
 * Connect = open the user's Terminal running the vendor's OWN login (M-subs-desktop §3.0).
 *
 * Sign-in always completes inside the vendor's unmodified CLI (`claude auth login`, `grok login`):
 * Tvashtr never sees, reads, copies or stores the login. This module only writes a tiny launcher
 * script containing COMMANDS (no secret of any kind), opens it in Terminal, and returns at once —
 * the Electron main process is never blocked waiting on an interactive login. The harness re-probes
 * the CLI when the Tvashtr window regains focus (or on Refresh).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const childProcess = require("child_process");
const { STRIPPED_ENV_KEYS, STRIPPED_ENV_PREFIX } = require("./spawnEnv.cjs");

const defaultExecFile = promisify(childProcess.execFile);

const DISPLAY = { claude: "Claude Code", grok: "Grok", codex: "Codex" };

/** POSIX single-quote a value for /bin/sh. */
function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * The launcher script body: clean env (same rule as every other spawn), enriched PATH, then the
 * vendor's own login command. Pure — unit-tested.
 *
 * @param {{ provider: string, binaryPath: string, args: string[], pathValue: string }} opts
 */
function buildLoginScript({ provider, binaryPath, args, pathValue }) {
  const name = DISPLAY[provider] || provider;
  return [
    "#!/bin/sh",
    `# Opened by Tvashtr Desktop so you can sign in to ${name} with its OWN login.`,
    "# Tvashtr never sees or stores your login.",
    `unset ${STRIPPED_ENV_KEYS.join(" ")}`,
    `for v in $(env | sed -n 's/^\\(${STRIPPED_ENV_PREFIX}[A-Za-z0-9_]*\\)=.*/\\1/p'); do unset "$v"; done`,
    `PATH=${shQuote(pathValue)}; export PATH`,
    `clear`,
    `echo ${shQuote(`Signing in to ${name} — follow the prompts below.`)}`,
    [binaryPath, ...args].map(shQuote).join(" "),
    "echo",
    `echo ${shQuote("When you're done, switch back to Tvashtr — it re-checks automatically.")}`,
    "",
  ].join("\n");
}

/**
 * Open the vendor login in a Terminal window. Resolves as soon as the window is asked to open.
 *
 * @param {{ provider: string, binaryPath: string, args: string[], env: NodeJS.ProcessEnv,
 *   platform?: string, scriptDir?: string, execFile?: Function, spawn?: Function,
 *   writeFile?: (p: string, s: string, o: object) => void }} req
 */
async function openLoginInTerminal({
  provider,
  binaryPath,
  args,
  env,
  platform = process.platform,
  scriptDir = os.tmpdir(),
  execFile = defaultExecFile,
  spawn = childProcess.spawn,
  writeFile = fs.writeFileSync,
}) {
  if (platform === "darwin") {
    fs.mkdirSync(scriptDir, { recursive: true });
    const file = path.join(scriptDir, `tvashtr-${provider}-login.command`);
    const script = buildLoginScript({ provider, binaryPath, args, pathValue: env.PATH || "" });
    writeFile(file, script, { mode: 0o700 });
    await execFile("open", ["-a", "Terminal", file], { env, timeout: 10000 });
    return { opened: "terminal", script: file };
  }
  // Linux / Windows: best effort — a detached login in the platform's terminal.
  const child =
    platform === "win32"
      ? spawn("cmd.exe", ["/c", "start", "", binaryPath, ...args], {
          detached: true,
          stdio: "ignore",
          env,
        })
      : spawn("x-terminal-emulator", ["-e", binaryPath, ...args], {
          detached: true,
          stdio: "ignore",
          env,
        });
  if (child && typeof child.unref === "function") child.unref();
  if (child && typeof child.on === "function") child.on("error", () => {});
  return { opened: platform === "win32" ? "cmd" : "x-terminal-emulator" };
}

module.exports = { buildLoginScript, openLoginInTerminal, shQuote };
