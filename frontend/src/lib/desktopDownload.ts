/**
 * Option 3 distribution: unsigned Mac .dmg published to GitHub Releases.
 * Artifact name is stable (`Tvashtr-mac.dmg`) so /latest/download stays valid across tags.
 */
export const DESKTOP_MAC_DMG_URL =
  "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg";

export const DESKTOP_RELEASES_URL = "https://github.com/lazyxgenius/Tvashtr/releases/latest";

export const GITHUB_REPO_URL = "https://github.com/lazyxgenius/Tvashtr";
/** Every release (the footer's Changelog, "Watch for releases on GitHub"). */
export const GITHUB_RELEASES_PAGE_URL = `${GITHUB_REPO_URL}/releases`;
/** The docs are the repo's README for now (website.md OQ-14). */
export const DOCS_URL = `${GITHUB_REPO_URL}#readme`;
/** Electron 35's floor (website.md OQ-8). */
export const DESKTOP_MIN_MACOS_LABEL = "macOS 11 or later";

/** The app isn't signed or notarized yet: macOS may call it "damaged" until this is run once. */
export const QUARANTINE_FIX = "xattr -dr com.apple.quarantine /Applications/Tvashtr.app";

/** True on a Mac (the only platform with a Tvashtr Desktop build for now, OQ-18). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac/i.test(platform);
}
