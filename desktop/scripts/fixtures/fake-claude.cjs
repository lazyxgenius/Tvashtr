#!/usr/bin/env node
/**
 * Test double for the `claude` CLI in headless mode (`claude -p … --output-format stream-json`).
 * Reads the prompt from stdin, edits the working directory, and prints stream-json lines shaped
 * like Claude Code's own. It refuses to run (exit 3) if any API key or inherited Claude Code
 * session variable reached it — the runner's clean-env contract.
 */
const fs = require("fs");
const path = require("path");

const LEAKS = Object.keys(process.env).filter(
  (k) =>
    ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "XAI_API_KEY", "OPENAI_API_KEY", "CLAUDECODE"].includes(k) ||
    k.startsWith("CLAUDE_CODE_"),
);
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", () => {
  if (LEAKS.length) {
    out({ type: "system", subtype: "leak", keys: LEAKS });
    process.exit(3);
  }
  const argv = process.argv.slice(2);
  const model = argv[argv.indexOf("--model") + 1];
  out({ type: "system", subtype: "init", apiKeySource: "none", model, cwd: process.cwd(), argv });
  if (process.env.FAKE_CLI_SLEEP_MS) {
    setTimeout(() => finish(), Number(process.env.FAKE_CLI_SLEEP_MS));
  } else {
    finish();
  }
  function finish() {
    out({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: `Working on: ${prompt.trim().slice(0, 40)}` },
          { type: "tool_use", id: "tu_1", name: "Write", input: { file_path: "hello.txt" } },
        ],
      },
    });
    fs.writeFileSync(path.join(process.cwd(), "hello.txt"), "hello from the subscription\n");
    fs.writeFileSync(path.join(process.cwd(), "REPORT.md"), "# Report\nWrote hello.txt\n");
    out({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tu_1", content: "File created" }] },
    });
    out({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Wrote hello.txt",
      usage: { input_tokens: 12, output_tokens: 7 },
      total_cost_usd: 0.0012,
    });
  }
});
