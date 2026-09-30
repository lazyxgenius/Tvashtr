/**
 * D1: in-window navigation is refused for anything but http(s) (a dropped file must not replace
 * the app).
 *
 * Connectors D.1: where a `window.open` goes. Only http(s) ever reaches the system browser, and
 * the frame name `tv-external` always means the system browser.
 *
 * Run: node --test desktop/scripts/navigation-guard.test.cjs
 */
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  blocksNavigation,
  isGithubAuthUrl,
  windowOpenAction,
} = require("../electron/navigationGuard.cjs");

const GITHUB_SIGN_IN = "https://github.com/login/oauth/authorize?client_id=x";

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

test("GitHub sign-in and App-install addresses are recognised, other GitHub pages are not", () => {
  for (const url of [
    GITHUB_SIGN_IN,
    "https://www.github.com/login/oauth/authorize",
    "https://github.com/apps/tvashtr/installations/new",
    "https://github.com/apps/tvashtr/installations/select_permissions",
  ]) {
    assert.equal(isGithubAuthUrl(url), true, url);
  }
  for (const url of [
    "https://github.com/anthropics/claude-code/issues",
    "https://github.com.evil.test/login/oauth/authorize",
    "https://docs.github.com/login/oauth/authorize",
    "not a url",
  ]) {
    assert.equal(isGithubAuthUrl(url), false, url);
  }
});

test("the app's own GitHub sign-in popup still takes over the window", () => {
  assert.equal(windowOpenAction(GITHUB_SIGN_IN, ""), "in-window");
  assert.equal(windowOpenAction(GITHUB_SIGN_IN, undefined), "in-window");
  assert.equal(windowOpenAction(GITHUB_SIGN_IN, "_blank"), "in-window");
});

test("a tv-external popup goes to the system browser even for a GitHub sign-in address", () => {
  // A connector that signs in with GitHub: in-window its callback would be bounced home.
  assert.equal(windowOpenAction(GITHUB_SIGN_IN, "tv-external"), "external");
  assert.equal(
    windowOpenAction("https://mcp.supabase.com/authorize?client_id=x", "tv-external"),
    "external",
  );
});

test("an https docs link opens in the system browser, as before", () => {
  assert.equal(windowOpenAction("https://docs.tvashtr.dev/connectors", "_blank"), "external");
  assert.equal(windowOpenAction("http://example.test/a", ""), "external");
  assert.equal(windowOpenAction("https://github.com/anthropics/claude-code", ""), "external");
});

test("anything but http(s) is denied and nothing opens, whatever the frame name", () => {
  for (const url of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ms-msdt:/id PCWDiagnostic /skip force",
    "smb://attacker.test/share",
    "data:text/html,hi",
    "about:blank",
    "tvashtr://home",
    "",
    "not a url",
    undefined,
  ]) {
    for (const frameName of ["", "_blank", "tv-external"]) {
      assert.equal(windowOpenAction(url, frameName), "deny", `${url} in ${frameName}`);
    }
  }
});
