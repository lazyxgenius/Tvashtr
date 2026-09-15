const { createClaudeHarness } = require("./claude.cjs");
const { createGrokHarness } = require("./grok.cjs");
const { createCodexHarness } = require("./codex.cjs");

function createRegistry(deps = {}) {
  const claude = createClaudeHarness(deps);
  const grok = createGrokHarness(deps);
  const codex = createCodexHarness(deps);
  return {
    get(provider) {
      if (provider === "claude") return claude;
      if (provider === "grok") return grok;
      if (provider === "codex") return codex;
      return null;
    },
    list() {
      return ["claude", "grok", "codex"];
    },
  };
}

module.exports = { createRegistry };
