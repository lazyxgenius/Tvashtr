/**
 * The exact headless argv for each vendor CLI (M-subs-desktop §3.3, verified live with --help and a
 * real run on this Mac — see STATE.md E2). No flag touches authentication.
 *
 * Run: node --test desktop/scripts/cli-command.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCliInvocation, modelForCli } = require("../electron/runner/cliCommand.cjs");
const { createGrokStreamParser, createClaudeStreamParser } = require("../electron/runner/streamEvents.cjs");

test("claude: -p stream-json, acceptEdits, prompts denied, restricted + safe mode, prompt on stdin", () => {
  const inv = buildCliInvocation({
    provider: "claude",
    model: "anthropic/claude-sonnet-5",
    binaryPath: "/Users/me/.local/bin/claude",
    workspace: "/tmp/ws",
    promptFile: "/tmp/p.txt",
    prompt: "do it",
  });
  assert.equal(inv.cmd, "/Users/me/.local/bin/claude");
  assert.deepEqual(inv.args, [
    "-p", "--output-format", "stream-json", "--verbose", "--model", "claude-sonnet-5",
    "--permission-mode", "acceptEdits", "--permission-prompts", "none",
    "--restricted", "--safe-mode", "--no-session-persistence",
  ]);
  assert.equal(inv.stdin, "do it");
  for (const forbidden of ["--bare", "--dangerously-skip-permissions", "setup-token", "--settings"]) {
    assert.ok(!inv.args.includes(forbidden), `${forbidden} must never be passed`);
  }
});

test("grok: prompt file, streaming-json, file tools only, allow rules, workspace sandbox", () => {
  const inv = buildCliInvocation({
    provider: "grok",
    model: "xai/grok-4.7",
    binaryPath: "/Users/me/.grok/bin/grok",
    workspace: "/tmp/ws",
    promptFile: "/tmp/p.txt",
    prompt: "ignored",
  });
  assert.deepEqual(inv.args, [
    "--prompt-file", "/tmp/p.txt", "--output-format", "streaming-json", "-m", "grok-4.7",
    "--cwd", "/tmp/ws", "--tools", "read_file,search_replace,write,list_dir,grep,todo_write",
    "--allow", "Edit", "--allow", "Read", "--allow", "Grep", "--sandbox", "workspace",
  ]);
  assert.equal(inv.stdin, null);
  assert.ok(!inv.args.includes("--always-approve"), "never blanket-approve (MCP / terminal)");
  assert.ok(!inv.args.includes("--no-auto-update"), "A2: not passed");
});

test("modelForCli strips only the provider prefix", () => {
  assert.equal(modelForCli("claude", "anthropic/claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(modelForCli("grok", "grok/grok-4.7"), "grok-4.7");
  assert.equal(modelForCli("grok", "xai/grok-4.7-build-fast"), "grok-4.7-build-fast");
});

test("grok stream: chunks coalesce; tool calls map to action/observation; end carries usage", () => {
  const p = createGrokStreamParser();
  const evs = [];
  for (const line of [
    { type: "thought", data: "hm" },
    { type: "text", data: "Hello" },
    { type: "text", data: " world" },
    { type: "tool_call", toolCallId: "t", toolName: "write", title: "write", rawInput: { file_path: "a" } },
    { type: "tool_call_update", toolCallId: "t", status: "completed", content: [{ type: "diff", path: "a" }] },
    { type: "end", stopReason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 }, modelUsage: { "grok-4.7-build": {} } },
  ]) evs.push(...p.feed(line));
  evs.push(...p.finish());
  assert.deepEqual(evs.map((e) => e.kind), ["message", "message", "action", "observation", "message"]);
  assert.equal(evs[1].payload.text, "Hello world");
  assert.equal(p.state.finalText, "Hello world");
  assert.deepEqual(p.state.usage, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
  assert.match(evs[4].payload.text, /grok-4\.7-build/);
});

test("grok stream: a cancelled stop is an error", () => {
  const p = createGrokStreamParser();
  p.feed({ type: "end", stopReason: "cancelled" });
  assert.equal(p.state.isError, true);
});

test("claude stream: init reports the auth source; the plan's usage window is logged", () => {
  const p = createClaudeStreamParser();
  const init = p.feed({ type: "system", subtype: "init", apiKeySource: "none", model: "claude-sonnet-5" });
  assert.match(init[0].payload.text, /apiKeySource: none · signed in with your Claude subscription/);
  const rl = p.feed({ type: "rate_limit_event", rate_limit_info: { status: "allowed", rateLimitType: "five_hour" } });
  assert.equal(rl[0].payload.text, "Claude plan usage window (five_hour): allowed");
  const apiKey = createClaudeStreamParser().feed({ type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY" });
  assert.match(apiKey[0].payload.text, /WARNING/);
});
