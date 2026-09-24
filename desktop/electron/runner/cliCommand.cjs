/**
 * The exact headless command each vendor CLI is run with (M-subs-desktop §3.3). Only flags the
 * installed CLIs document in `--help` are used, and none of them touches authentication — the CLI
 * signs in however the user signed it in (the clean env guarantees no API key is in reach).
 *
 * Claude Code (`claude --help`, 2.1.x):
 *   -p                          headless print mode; the prompt arrives on stdin
 *   --output-format stream-json --verbose   one JSON event per line (init / assistant / user / result)
 *   --model <model>             the node's model without its `anthropic/` prefix
 *   --permission-mode acceptEdits           file edits auto-accepted…
 *   --permission-prompts none   …anything that would prompt (shell, web) is denied, never asked
 *   --restricted                no command-running tools; file tools confined to the job dir;
 *                               ignores user/project settings files (auth is unaffected)
 *   --safe-mode                 no CLAUDE.md, hooks, plugins or MCP servers from this machine
 *   --no-session-persistence    the throwaway job is not saved to the user's session list
 * Grok Build (`grok --help`, 1.0.x; docs.x.ai/build/cli/headless-scripting, …/features/permissions,
 * …/features/sandbox):
 *   --prompt-file <file>        single-turn headless prompt (same as -p, without argv limits)
 *   --output-format streaming-json          one JSON event per line (text / thought / tool_call /
 *                               tool_call_update / usage / end)
 *   -m <model>                  the node's model without its `xai/` / `grok/` prefix
 *   --cwd <dir>                 the job's own temp copy of the repo
 *   --tools read_file,search_replace,write,list_dir,grep,todo_write   file tools only (no
 *                               terminal, no web)
 *   --allow Edit --allow Read --allow Grep  headless approvals follow allow rules; anything not
 *                               allowed (terminal, MCP servers, tool discovery) is blocked. (Verified:
 *                               `--permission-mode acceptEdits` alone cancels `write` headless.)
 *   --sandbox workspace         the CLI's own sandbox: writes confined to the job dir
 */
const path = require("path");

const DISPLAY = { claude: "Claude Code", grok: "Grok Build" };
const RUNNABLE_PROVIDERS = Object.freeze(["claude", "grok"]);
const GROK_FILE_TOOLS = Object.freeze([
  "read_file",
  "search_replace",
  "write",
  "list_dir",
  "grep",
  "todo_write",
]);

/** `anthropic/claude-sonnet-5` → `claude-sonnet-5`; `xai/grok-4.7` → `grok-4.7`. */
function modelForCli(provider, slug) {
  const s = String(slug || "").trim();
  const prefixes = provider === "claude" ? ["anthropic/"] : ["xai/", "grok/"];
  for (const p of prefixes) {
    if (s.toLowerCase().startsWith(p)) return s.slice(p.length);
  }
  return s;
}

/**
 * @param {{ provider: string, model: string, binaryPath: string, workspace: string,
 *   promptFile: string, prompt: string }} opts
 * @returns {{ cmd: string, args: string[], stdin: string|null, display: string }}
 */
function buildCliInvocation({ provider, model, binaryPath, workspace, promptFile, prompt }) {
  const m = modelForCli(provider, model);
  if (provider === "claude") {
    const args = [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      m,
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--restricted",
      "--safe-mode",
      "--no-session-persistence",
    ];
    return {
      cmd: binaryPath,
      args,
      stdin: prompt,
      display: `${path.basename(binaryPath)} ${args.join(" ")} (prompt on stdin)`,
    };
  }
  if (provider === "grok") {
    const args = [
      "--prompt-file",
      promptFile,
      "--output-format",
      "streaming-json",
      "-m",
      m,
      "--cwd",
      workspace,
      "--tools",
      GROK_FILE_TOOLS.join(","),
      "--allow",
      "Edit",
      "--allow",
      "Read",
      "--allow",
      "Grep",
      "--sandbox",
      "workspace",
    ];
    return {
      cmd: binaryPath,
      args,
      stdin: null,
      display: `${path.basename(binaryPath)} ${args.join(" ")}`,
    };
  }
  throw new Error(`no headless runner for provider ${provider}`);
}

module.exports = { buildCliInvocation, modelForCli, RUNNABLE_PROVIDERS, DISPLAY, GROK_FILE_TOOLS };
