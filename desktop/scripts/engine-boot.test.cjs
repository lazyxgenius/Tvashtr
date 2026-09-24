/**
 * M-subs-desktop (A3): the Electron main process pushes each engine's status to the secret-free
 * mirror (PUT /api/engines/subscriptions/{provider}) at app LAUNCH — not only when the user
 * clicks a card — so the server preflight knows what is live. Disconnect clears the mirror.
 *
 * Run: node --test desktop/scripts/engine-boot.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { bootEngines } = require("../electron/runner/engineBoot.cjs");
const { createStatusSync } = require("../electron/runner/statusSync.cjs");

function status(provider, connected, state = connected ? "connected" : "needs_login") {
  return {
    provider,
    connected,
    state,
    account_hint: connected ? "Claude Pro" : null,
    source: "harness",
    checked_at: "2026-09-24T00:00:00.000Z",
  };
}

function fakeApi() {
  const puts = [];
  const deletes = [];
  return {
    puts,
    deletes,
    async putStatus(provider, body) {
      puts.push({ provider, body });
      return { ok: true };
    },
    async deleteStatus(provider) {
      deletes.push(provider);
      return { ok: true };
    },
  };
}

test("app launch probes every engine once and pushes each status to the mirror", async () => {
  const api = fakeApi();
  const probes = [];
  const registry = {
    get(provider) {
      return {
        async toStatus() {
          probes.push(provider);
          return status(provider, provider !== "codex");
        },
      };
    },
  };
  const written = {};
  const store = { write: (p, s) => (written[p] = s) };
  const out = await bootEngines({
    providers: ["claude", "grok", "codex"],
    registry,
    store,
    statusSync: createStatusSync({ api }),
  });
  assert.deepEqual(probes, ["claude", "grok", "codex"], "one probe per engine, no timer");
  assert.deepEqual(
    api.puts.map((p) => [p.provider, p.body.connected]),
    [
      ["claude", true],
      ["grok", true],
      ["codex", false],
    ],
  );
  assert.equal(out.length, 3);
  assert.ok(written.claude && written.grok && written.codex, "statuses cached locally");
});

test("the pushed body is status-only — no secret-looking keys ever leave the app", async () => {
  const api = fakeApi();
  const sync = createStatusSync({ api });
  await sync.push({ ...status("claude", true), token: "x", api_key: "y", cookies: "z" });
  assert.equal(api.puts.length, 1);
  assert.deepEqual(Object.keys(api.puts[0].body).sort(), [
    "account_hint",
    "connected",
    "source",
    "state",
  ]);
});

test("disconnect clears the mirror row", async () => {
  const api = fakeApi();
  const sync = createStatusSync({ api });
  await sync.clear("grok");
  assert.deepEqual(api.deletes, ["grok"]);
});

test("a failed push (e.g. not signed in yet) is remembered and replayed later", async () => {
  let fail = true;
  const puts = [];
  const api = {
    async putStatus(provider, body) {
      if (fail) {
        const e = new Error("401");
        e.status = 401;
        throw e;
      }
      puts.push({ provider, body });
    },
    async deleteStatus() {},
  };
  const sync = createStatusSync({ api });
  await sync.pushAll([status("claude", true), status("grok", false)]);
  assert.equal(puts.length, 0);
  fail = false;
  await sync.replayPending();
  assert.deepEqual(
    puts.map((p) => p.provider),
    ["claude", "grok"],
  );
});
