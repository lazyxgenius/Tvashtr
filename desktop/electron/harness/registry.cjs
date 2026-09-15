const { createClaudeHarness } = require("./claude.cjs");
const { createGrokHarness } = require("./grok.cjs");

function createRegistry(deps = {}) {
  const claude = createClaudeHarness(deps);
  const grok = createGrokHarness(deps);
  return {
    get(provider) {
      if (provider === "claude") return claude;
      if (provider === "grok") return grok;
      return null;
    },
    list() {
      return ["claude", "grok"];
    },
  };
}

module.exports = { createRegistry };
