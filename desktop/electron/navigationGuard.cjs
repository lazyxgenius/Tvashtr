/**
 * D1: a file dropped outside a drop zone makes Chromium navigate the window to
 * `file:///…/dropped.pdf`, which replaces the app. The window only ever shows the loopback SPA
 * and http(s) pages (GitHub sign-in), so any other scheme (file:, data:, javascript:, …) is
 * refused in `will-navigate`.
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

module.exports = { blocksNavigation };
