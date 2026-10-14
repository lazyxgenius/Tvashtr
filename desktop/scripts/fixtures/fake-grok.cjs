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

// M-desk-7: a `--sandbox <name>` that isn't built in is a custom profile, applied as Grok documents
// it (./grokSandbox.cjs) — or refused before anything runs. FAKE_GROK_IGNORES_PROFILES=1 plays a
// Grok that runs without it; FAKE_GROK_PROBES (JSON paths) reports what the job could open.
const { denies, readProfile } = require("./grokSandbox.cjs");
const sandbox = argv.includes("--sandbox") ? argv[argv.indexOf("--sandbox") + 1] : "off";
let deny = [];
if (!["off", "workspace", "devbox", "read-only", "strict"].includes(sandbox) && process.env.FAKE_GROK_IGNORES_PROFILES !== "1") {
  deny = readProfile(cwd, sandbox);
  if (deny === null) {
    process.stderr.write(
      `warning: sandbox could not be applied: Custom sandbox profile '${sandbox}' not found.\n` +
        `error: could not apply the '${sandbox}' sandbox profile; see the warning above for the cause. Refusing to start.\n`,
    );
    process.exit(1);
  }
}
const opens = (p) => !denies(deny, path.resolve(cwd, p));
if (!opens(promptFile)) {
  process.stderr.write(`Error: Failed to read '${promptFile}': Operation not permitted (os error 1)\n`);
  process.exit(1);
}
const prompt = fs.readFileSync(promptFile, "utf8");
const model = argv[argv.indexOf("-m") + 1];
if (model === "tvashtr-lock-check") {
  process.stderr.write(`Error: Couldn't set model '${model}': Invalid params: "unknown model id".\n`);
  process.exit(1);
}
out({ type: "available_commands", tools: ["read_file", "write"] });
for (const p of JSON.parse(process.env.FAKE_GROK_PROBES || "[]")) {
  out({ type: "text", data: `probe ${p}: ${opens(p) ? "OPENED" : "REFUSED"}\n` });
}
if (fs.existsSync(path.join(cwd, ".grok", "config.toml"))) out({ type: "text", data: "the repo's .grok/config.toml is here\n" });
const seen = Object.fromEntries(Object.entries(process.env).filter(([k]) => k === "TMPDIR" || k.startsWith("GROK_")));
out({ type: "text", data: `env ${JSON.stringify(seen)}\n` });
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
