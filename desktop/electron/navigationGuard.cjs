/**
 * D1: a file dropped outside a drop zone makes Chromium navigate the window to
 * `file:///…/dropped.pdf`, which replaces the app. The window only ever shows the loopback SPA
 * and http(s) pages (GitHub sign-in), so any other scheme (file:, data:, javascript:, …) is
 * refused in `will-navigate`.
 *
 * Connectors D.1: `windowOpenAction` decides where a `window.open` goes (main.cjs only acts on
 * it), so the rule "only http(s) reaches the system browser" is tested without Electron.
 */

/**
 * @param {string} url
 * @returns {boolean} true when the window must not navigate to `url`
 */
function blocksNavigation(url) {
  try {
    const { protocol } = new URL(url);
    return protocol !== "http:" && protocol !== "https:";
  } catch {
    return true;
  }
}

/**
 * GitHub OAuth / App-install URLs that return to our callback must stay in-window.
 * Unrelated github.com pages (docs, issues) still open externally.
 * @param {string} url
 */
function isGithubAuthUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return false;
    const p = u.pathname;
    return (
      p.startsWith("/login/oauth/") ||
      p.includes("/installations/new") ||
      p.includes("/installations/select_permissions") ||
      /\/apps\/[^/]+\/installations/.test(p)
    );
  } catch {
    return false;
  }
}

/**
 * Where a `window.open` (or a `target=_blank` link) goes. It never becomes an Electron window.
 *
 * - Only http(s) is ever opened: the OS would hand `file:`, `smb:` or a custom scheme to whatever
 *   handler is registered for it, so anything else is denied and nothing opens.
 * - The frame name `tv-external` always means the system browser. A connector that signs in with
 *   GitHub would otherwise take over the app window, and its callback on the API host would be
 *   bounced home before it ran.
 * - The app's own GitHub sign-in / App install loads in the window (its callback sets the cookie).
 *
 * @param {string} url
 * @param {string} [frameName]
 * @returns {"external" | "in-window" | "deny"}
 */
function windowOpenAction(url, frameName) {
  if (blocksNavigation(url)) return "deny";
  if (frameName !== "tv-external" && isGithubAuthUrl(url)) return "in-window";
  return "external";
}

module.exports = { blocksNavigation, isGithubAuthUrl, windowOpenAction };
