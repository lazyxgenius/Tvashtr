/**
 * Run: node desktop/scripts/engines-ipc.contract.test.cjs
 */
const assert = require("assert");

const ALLOWED_STATUS_KEYS = new Set([
  "provider",
  "connected",
  "state",
  "account_hint",
  "source",
  "checked_at",
]);
const FORBIDDEN = ["api_key", "token", "cookies", "secret", "authorization"];

function assertStatusShape(row) {
  assert.ok(row && typeof row === "object");
  for (const k of Object.keys(row)) assert.ok(ALLOWED_STATUS_KEYS.has(k), `unexpected key ${k}`);
  for (const f of FORBIDDEN) assert.ok(!(f in row));
  assert.ok(["claude", "grok", "codex"].includes(row.provider));
}

assertStatusShape({
  provider: "claude",
  connected: false,
  state: "disconnected",
  account_hint: null,
  source: null,
  checked_at: null,
});
console.log("engines-ipc.contract.test.cjs OK");
