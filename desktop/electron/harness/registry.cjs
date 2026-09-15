const { createClaudeHarness } = require("./claude.cjs");

function createRegistry(deps = {}) {
  const claude = createClaudeHarness(deps);
  return {
    get(provider) {
      if (provider === "claude") return claude;
      return null;
    },
    list() {
      return ["claude"];
    },
  };
}

module.exports = { createRegistry };
