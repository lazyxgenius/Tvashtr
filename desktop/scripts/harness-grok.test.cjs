/**
 * Run: node desktop/scripts/harness-grok.test.cjs
 */
const assert = require("assert");
const { createGrokHarness } = require("../electron/harness/grok.cjs");
const { createRegistry } = require("../electron/harness/registry.cjs");

async function run() {
  const execFile = async (cmd, args) => {
    const key = `${cmd} ${args.join(" ")}`;
    if (key === "which grok") return { stdout: "/usr/local/bin/grok\n", code: 0 };
    if (args[0] === "auth" && args[1] === "status") {
      return { stdout: "Logged in as ada@example.com\n", code: 0 };
    }
    const err = new Error("unexpected " + key);
    err.code = 1;
    throw err;
  };

  const h = createGrokHarness({ execFile });
  const det = await h.detect();
  assert.strictEqual(det.installed, true);
  const st = await h.toStatus();
  assert.strictEqual(st.provider, "grok");
  assert.strictEqual(st.connected, true);
  assert.strictEqual(st.state, "connected");
  assert.strictEqual(st.account_hint, "ada@example.com");
  assert.strictEqual(st.source, "harness");

  const execMissing = async (cmd, args) => {
    if (cmd === "which" && args[0] === "grok") {
      const e = new Error("not found");
      e.code = 1;
      throw e;
    }
    throw new Error("no");
  };
  const st2 = await createGrokHarness({ execFile: execMissing }).toStatus();
  assert.strictEqual(st2.state, "needs_install");
  assert.strictEqual(st2.connected, false);

  const reg = createRegistry({ execFile });
  assert.ok(reg.get("grok"));
  assert.strictEqual(reg.get("grok").id, "grok");
  assert.deepStrictEqual(reg.list(), ["claude", "grok", "codex"]);

  console.log("harness-grok.test.cjs OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
