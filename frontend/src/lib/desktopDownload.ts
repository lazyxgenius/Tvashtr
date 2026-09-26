/**
 * Option 3 distribution: unsigned Mac .dmg published to GitHub Releases.
 * Artifact name is stable (`Tvashtr-mac.dmg`) so /latest/download stays valid across tags.
 */
export const DESKTOP_MAC_DMG_URL =
  "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg";

export const DESKTOP_RELEASES_URL = "https://github.com/lazyxgenius/Tvashtr/releases/latest";

/** True on a Mac (the only platform with a Tvashtr Desktop build for now, OQ-18). */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac/i.test(platform);
}
