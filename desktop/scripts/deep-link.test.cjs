/**
 * `tvashtr://` deep links: only allow-listed places, mapped onto the app's hash addresses
 * (frontend/src/lib/nav.ts); `?connect=` only highlights; anything else is ignored.
 *
 * Run: node --test desktop/scripts/deep-link.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDeepLink,
  findDeepLinkArg,
  createNavigationQueue,
} = require("../electron/deepLink.cjs");

const TEAM = "3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b";

test("allow-listed places map onto the app's hash addresses", () => {
  const cases = [
    ["tvashtr://home", { path: "/home" }],
    ["tvashtr://engines/overview", { path: "/engines" }],
    ["tvashtr://engines/subscriptions", { path: "/engines/subscriptions" }],
    ["tvashtr://engines/keys", { path: "/engines/keys" }],
    ["tvashtr://toolkit/tools", { path: "/toolkit/tools" }],
    ["tvashtr://toolkit/skills", { path: "/toolkit/skills" }],
    ["tvashtr://toolkit/memory", { path: "/toolkit/memory/inbox" }],
    ["tvashtr://toolkit/secrets", { path: "/toolkit/secrets" }],
    [`tvashtr://teams/${TEAM}`, { path: `/teams/${TEAM}` }],
  ];
  for (const [link, want] of cases) assert.deepEqual(parseDeepLink(link), want, link);
});

test("?connect= carries claude or grok only, and only on Engines", () => {
  assert.deepEqual(parseDeepLink("tvashtr://engines/subscriptions?connect=claude"), {
    path: "/engines/subscriptions",
    params: { connect: "claude" },
  });
  assert.deepEqual(parseDeepLink("tvashtr://engines/overview?connect=grok"), {
    path: "/engines",
    params: { connect: "grok" },
  });
  // Unknown provider / extra params are dropped; the page still opens.
  assert.deepEqual(parseDeepLink("tvashtr://engines/subscriptions?connect=codex&run=1"), {
    path: "/engines/subscriptions",
  });
  assert.deepEqual(parseDeepLink("tvashtr://home?connect=claude"), { path: "/home" });
});

test("tolerates slash variants, a trailing slash and upper case", () => {
  assert.deepEqual(parseDeepLink("tvashtr:///engines/keys"), { path: "/engines/keys" });
  assert.deepEqual(parseDeepLink("tvashtr:engines/keys"), { path: "/engines/keys" });
  assert.deepEqual(parseDeepLink("tvashtr://engines/keys/"), { path: "/engines/keys" });
  assert.deepEqual(parseDeepLink("TVASHTR://Engines/Keys"), { path: "/engines/keys" });
  assert.deepEqual(parseDeepLink(`tvashtr://teams/${TEAM.toUpperCase()}`), {
    path: `/teams/${TEAM}`,
  });
});

test("everything else is ignored", () => {
  const rejected = [
    undefined,
    null,
    42,
    "",
    "tvashtr://",
    "tvashtr://engines",
    "tvashtr://engines/connect",
    "tvashtr://toolkit",
    "tvashtr://toolkit/tools/browse",
    "tvashtr://toolkit/memory/archive",
    "tvashtr://teams",
    "tvashtr://teams/not-a-uuid",
    `tvashtr://teams/${TEAM}/runs/${TEAM}`,
    "tvashtr://teams/%2e%2e",
    "tvashtr://home/../engines",
    "tvashtr://settings",
    "tvashtr://user:pw@home",
    "tvashtr://home:8080",
    "https://tvashtr.fly.dev/#/engines",
    "javascript:alert(1)",
    "file:///etc/passwd",
    `tvashtr://home?${"x".repeat(3000)}`,
  ];
  for (const link of rejected) assert.equal(parseDeepLink(link), null, String(link));
});

test("finds the link on a Windows/Linux command line", () => {
  assert.equal(
    findDeepLinkArg(["/opt/Tvashtr/tvashtr", "--no-sandbox", "tvashtr://engines/keys"]),
    "tvashtr://engines/keys",
  );
  assert.equal(findDeepLinkArg(["C:\\Tvashtr.exe", "TVASHTR://home"]), "TVASHTR://home");
  assert.equal(findDeepLinkArg(["/opt/Tvashtr/tvashtr", "."]), null);
  assert.equal(findDeepLinkArg(undefined), null);
});

test("a link nobody acknowledged waits for consumePending, and is handed over once", () => {
  const sent = [];
  const q = createNavigationQueue({ send: (m) => sent.push(m) });
  q.deliver({ path: "/engines/keys" }); // cold start: the push reaches no listener
  assert.equal(sent.length, 1);
  assert.deepEqual(q.consumePending(), { id: sent[0].id, target: { path: "/engines/keys" } });
  assert.equal(q.consumePending(), null, "consumed only once");
});

test("an acknowledged link is not replayed; a newer link replaces an unseen one", () => {
  const sent = [];
  const q = createNavigationQueue({ send: (m) => sent.push(m) });
  q.deliver({ path: "/home" });
  q.ack(sent[0].id);
  assert.equal(q.consumePending(), null, "the listening page already navigated");

  q.deliver({ path: "/home" });
  q.deliver({ path: "/engines/subscriptions", params: { connect: "grok" } });
  q.ack(sent[1].id); // a late ack for the older link doesn't drop the newer one
  assert.deepEqual(q.consumePending()?.target, {
    path: "/engines/subscriptions",
    params: { connect: "grok" },
  });
  assert.notEqual(sent[1].id, sent[2].id);
});
