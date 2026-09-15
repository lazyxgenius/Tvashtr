const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createStatusStore } = require("../electron/harness/statusStore.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-eng-"));
const store = createStatusStore({
  userDataDir: dir,
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => Buffer.from(b).toString("utf8").replace(/^enc:/, ""),
  },
});

const row = {
  provider: "claude",
  connected: true,
  state: "connected",
  account_hint: "ada@example.com",
  source: "harness",
  checked_at: "2026-09-15T00:00:00.000Z",
};
store.write("claude", row);
assert.deepStrictEqual(store.read("claude"), row);
store.clear("claude");
assert.strictEqual(store.read("claude"), null);
console.log("status-store.test.cjs OK");
