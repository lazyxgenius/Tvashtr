#!/usr/bin/env node
/**
 * Test double for `grok --prompt-file … --output-format streaming-json` (Grok Build headless),
 * emitting the event shapes grok 1.0.40 really prints (text/thought chunks, tool_call,
 * tool_call_update, usage, end). Refuses to run (exit 3) if an API key or Claude Code session
 * variable leaked into its environment.
 */
const fs = require("fs");
const path = require("path");

const LEAKS = Object.keys(process.env).filter(
  (k) =>
    ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY", "CLAUDECODE"].includes(k) ||
    k.startsWith("CLAUDE_CODE_"),
);
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
if (LEAKS.length) {
  out({ type: "error", error: `leaked: ${LEAKS.join(",")}` });
  process.exit(3);
}
const argv = process.argv.slice(2);
const promptFile = argv[argv.indexOf("--prompt-file") + 1];
const cwd = argv.includes("--cwd") ? argv[argv.indexOf("--cwd") + 1] : process.cwd();
const prompt = fs.readFileSync(promptFile, "utf8");
out({ type: "available_commands", tools: ["read_file", "write"] });
for (const w of ["The", " user", " wants", " notes"]) out({ type: "thought", data: w });
for (const w of ["Reading", " the", " task. "]) out({ type: "text", data: w });
const target = path.join(cwd, "notes.md");
out({ type: "tool_call", toolCallId: "c1", title: "write", kind: "write", status: "pending", toolName: "write", rawInput: { file_path: target, content: "x" } });
fs.writeFileSync(target, `grok saw ${prompt.length} chars\n`);
out({ type: "tool_call_update", toolCallId: "c1", status: null, content: [{ type: "diff", path: target, oldText: "", newText: "x" }] });
out({ type: "tool_call_update", toolCallId: "c1", status: "completed", content: [{ type: "diff", path: target, oldText: "", newText: "x" }] });
for (const w of ["Done:", " wrote", " notes.md"]) out({ type: "text", data: w });
out({ type: "usage", usage: { input_tokens: 10, output_tokens: 5 } });
out({ type: "end", stopReason: "end_turn", usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 7 }, modelUsage: { "grok-4.7-build": {} } });
