/**
 * Opening a provider's sign-in page (the same path on the web and on Tvashtr Desktop: the app
 * opens the page, then polls the connection until the sign-in finishes).
 *
 * - Web: a popup. A browser only allows one opened in the click itself, so `prepareSignInWindow`
 *   opens it blank before the first `await`, and `openSignIn` points it at the address once the
 *   server has answered.
 * - Desktop: no blank popup. A window named `tv-external` is sent to the system browser by
 *   Electron.
 *
 * Only an `http(s)` address is ever opened. The blank popup is same-origin with Tvashtr, so a
 * `javascript:` address assigned to it would run as Tvashtr.
 */
import { isDesktopApp } from "../../lib/desktopRepos";

const POPUP_NAME = "tv-connect";
const POPUP_FEATURES = "popup,width=520,height=720";

export type OpenResult = "opened" | "blocked" | "refused";

function isHttp(address: string): boolean {
  try {
    const { protocol } = new URL(address);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** Call in the click, before any `await`. The popup to pass to `openSignIn`; null on Desktop, or
 *  when the browser blocked it. */
export function prepareSignInWindow(): Window | null {
  return isDesktopApp() ? null : window.open("", POPUP_NAME, POPUP_FEATURES);
}

/** Send the sign-in window to `address`. Without a `prepared` popup it opens one (call it in a
 *  click: "Open the window again"). */
export function openSignIn(address: string, prepared: Window | null): OpenResult {
  if (!isHttp(address)) {
    prepared?.close();
    return "refused";
  }
  if (isDesktopApp()) {
    window.open(address, "tv-external", "noopener");
    return "opened";
  }
  const popup = prepared ?? window.open("", POPUP_NAME, POPUP_FEATURES);
  if (!popup) return "blocked";
  try {
    popup.opener = null;
  } catch {
    // The window already shows the provider's page (another origin): nothing left to cut.
  }
  popup.location.href = address;
  return "opened";
}
