/**
 * The clean child env (M-subs-desktop §3.0): strips API keys + inherited Claude Code session vars,
 * adds nothing secret, prepends the enriched PATH.
 *
 * Run: node --test desktop/scripts/spawn-env.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildChildEnv, isStrippedEnvKey, STRIPPED_ENV_KEYS } = require("../electron/harness/spawnEnv.cjs");

test("strips exactly the listed keys and every CLAUDE_CODE_* var", () => {
  const env = buildChildEnv(
    {
      PATH: "/usr/bin:/bin",
      HOME: "/Users/me",
      ANTHROPIC_API_KEY: "a",
      ANTHROPIC_AUTH_TOKEN: "b",
      CLAUDE_CODE_OAUTH_TOKEN: "c",
      XAI_API_KEY: "d",
      OPENAI_API_KEY: "e",
      CLAUDECODE: "1",
      CLAUDE_CODE_SESSION_ID: "f",
      CLAUDE_CODE_ENTRYPOINT: "g",
      LANG: "en_US.UTF-8",
      NOT_CLAUDE_CODE_X: "kept",
    },
    { pathDirs: ["/Users/me/.local/bin", "/Users/me/.grok/bin"], platform: "darwin" },
  );
  assert.deepEqual(Object.keys(env).sort(), ["HOME", "LANG", "NOT_CLAUDE_CODE_X", "PATH"]);
  assert.equal(env.PATH, "/Users/me/.local/bin:/Users/me/.grok/bin:/usr/bin:/bin");
  assert.deepEqual([...STRIPPED_ENV_KEYS].sort(), [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDECODE",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
  ]);
  assert.equal(isStrippedEnvKey("CLAUDE_CODE_ANYTHING_NEW"), true);
  assert.equal(isStrippedEnvKey("PATH"), false);
});

test("never mutates the parent env", () => {
  const parent = { PATH: "/bin", ANTHROPIC_API_KEY: "x" };
  buildChildEnv(parent, { pathDirs: ["/a"] });
  assert.deepEqual(parent, { PATH: "/bin", ANTHROPIC_API_KEY: "x" });
});
