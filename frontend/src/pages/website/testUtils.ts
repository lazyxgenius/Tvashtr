/** Test helpers for the website pages (fetch: pages/desktop/desktopTestUtils `stubFetch`). */
import { DESKTOP_MAC_DMG_URL } from "../../lib/desktopDownload";

/** Make the browser report `platform` (and `architecture`, when given) through UA-CH. */
export function setUaHints(platform: string, architecture?: string, mobile = false) {
  Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: {
      platform,
      mobile,
      getHighEntropyValues: () =>
        architecture === undefined
          ? Promise.reject(new Error("no hints"))
          : Promise.resolve({ architecture }),
    },
  });
}

export function clearUaHints() {
  Reflect.deleteProperty(navigator, "userAgentData");
}

export const SITE = {
  repo_url: "https://github.com/lazyxgenius/Tvashtr",
  stars: 128,
  desktop: { version: "0.7.0", dmg_url: DESKTOP_MAC_DMG_URL },
  checked_at: "2026-09-27T10:05:00Z",
};

/** WEB-37: every download link on the page is the stable latest-release DMG. */
export function downloadLinks(root: ParentNode = document): string[] {
  return [...root.querySelectorAll<HTMLAnchorElement>("a[href*='/download/']")].map(
    (a) => a.getAttribute("href") ?? "",
  );
}
