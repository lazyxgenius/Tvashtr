/**
 * Bridge v6 `setup` (desktop-app.md DB-4, DT-17): this Mac's first-run setup, per account.
 *
 * Run: node --test desktop/scripts/setup-store.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSetupStore, SetupError, SETUP_FILENAME } = require("../electron/setupStore.cjs");

const A = "7b0c2a52-0000-4000-8000-000000000001";
const B = "7b0c2a52-0000-4000-8000-000000000002";

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tv-setup-"));
  return { dir, store: createSetupStore({ userDataDir: dir }) };
}

const EMPTY = { version: 1, step: null, finishedAt: null, planConsentAt: null, workspace: null };

test("a new account on this Mac starts with nothing set up", () => {
  const { store } = tempStore();
  assert.deepEqual(store.get(A), EMPTY);
});

test("update merges, persists across instances and keeps accounts apart", () => {
  const { dir, store } = tempStore();
  const out = store.update(A, { step: "project", planConsentAt: "2026-09-26T10:00:00.000Z" });
  assert.deepEqual(out, { ...EMPTY, step: "project", planConsentAt: "2026-09-26T10:00:00.000Z" });

  const again = createSetupStore({ userDataDir: dir });
  assert.equal(again.get(A).step, "project");
  assert.equal(again.get(A).planConsentAt, "2026-09-26T10:00:00.000Z");
  assert.deepEqual(again.get(B), EMPTY);

  again.update(A, { planConsentAt: null, finishedAt: "2026-09-26T10:05:00Z" });
  assert.deepEqual(store.get(A), {
    ...EMPTY,
    step: "project",
    finishedAt: "2026-09-26T10:05:00.000Z",
  });
});

test("the file is private to the user", { skip: process.platform === "win32" }, () => {
  const { dir, store } = tempStore();
  store.update(A, { step: "engines" });
  const mode = fs.statSync(path.join(dir, SETUP_FILENAME)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("workspace choices are validated like repos.* paths", () => {
  const { store } = tempStore();
  assert.deepEqual(
    store.update(A, { workspace: { kind: "folder", path: "/Users/ada/code/x", displayPath: "~/code/x" } })
      .workspace,
    { kind: "folder", path: "/Users/ada/code/x", displayPath: "~/code/x" },
  );
  assert.deepEqual(store.update(A, { workspace: { kind: "github", repo: "lazyxgenius/trade_mcp" } }).workspace, {
    kind: "github",
    repo: "lazyxgenius/trade_mcp",
  });
  assert.deepEqual(store.update(A, { workspace: { kind: "ask" } }).workspace, { kind: "ask" });
  assert.equal(store.update(A, { workspace: null }).workspace, null);

  for (const bad of [
    { kind: "folder", path: "relative/x", displayPath: "x" },
    { kind: "folder", path: "/a\0b", displayPath: "x" },
    { kind: "folder", path: "/a", displayPath: "" },
    { kind: "github", repo: "not a repo" },
    { kind: "somewhere" },
    "folder",
  ]) {
    assert.throws(() => store.update(A, { workspace: bad }), SetupError);
  }
  // A rejected patch changes nothing.
  assert.equal(store.get(A).workspace, null);
});

test("unknown keys, bad steps, bad times and bad account ids are refused with readable copy", () => {
  const { store } = tempStore();
  const refused = (fn) =>
    assert.throws(fn, (e) => e instanceof SetupError && e.message === "Couldn't save this Mac's setup. Try again.");
  refused(() => store.update(A, { step: "done" }));
  refused(() => store.update(A, { finishedAt: "yesterday" }));
  refused(() => store.update(A, { planConsentAt: 12 }));
  refused(() => store.update(A, { token: "x" }));
  refused(() => store.update(A, null));
  refused(() => store.update("../../etc", { step: "engines" }));
  refused(() => store.get(""));
  assert.deepEqual(store.get(A), EMPTY);
});

test("a corrupt or hand-edited file falls back to nothing set up", () => {
  const { dir, store } = tempStore();
  fs.writeFileSync(path.join(dir, SETUP_FILENAME), "{not json");
  assert.deepEqual(store.get(A), EMPTY);
  fs.writeFileSync(
    path.join(dir, SETUP_FILENAME),
    JSON.stringify({ accounts: { [A]: { step: "nowhere", finishedAt: "bad", secret: "x" } } }),
  );
  assert.deepEqual(store.get(A), EMPTY);
  // Writing again drops the stray keys.
  store.update(A, { step: "team" });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, SETUP_FILENAME), "utf8"));
  assert.deepEqual(raw.accounts[A], { ...EMPTY, step: "team" });
});
