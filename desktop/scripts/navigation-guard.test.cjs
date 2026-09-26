/**
 * D1: in-window navigation is refused for anything but http(s) (a dropped file must not replace
 * the app).
 *
 * Run: node --test desktop/scripts/navigation-guard.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const { blocksNavigation } = require("../electron/navigationGuard.cjs");

test("a dropped file's file: URL is blocked", () => {
  assert.equal(
    blocksNavigation("file:///Users/me/Downloads/video-guide.pdf"),
    true,
  );
});

test("other non-http(s) schemes and junk are blocked", () => {
  for (const url of [
    "data:text/html,hi",
    "javascript:alert(1)",
    "ftp://x.test/a",
    "not a url",
  ]) {
    assert.equal(blocksNavigation(url), true, url);
  }
});

test("the loopback app and GitHub sign-in still navigate", () => {
  for (const url of [
    "http://127.0.0.1:5178/#/domains",
    "http://localhost:5173/",
    "https://github.com/login/oauth/authorize?client_id=x",
  ]) {
    assert.equal(blocksNavigation(url), false, url);
  }
});
