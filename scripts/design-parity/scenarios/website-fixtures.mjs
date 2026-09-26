// The public website (website.md): shared fixtures for the website-*.mjs scenarios. Every page is
// website-only (website.md §1), so no scenario is `desktop: true`; WEB-3's Desktop routing is a
// vitest (pages/website/desktopRouting.test.tsx).

/** Signed out: `/api/auth/me` answers 401. */
export const SIGNED_OUT = {
  "GET /api/auth/me": () => ({ status: 401, json: { detail: "Not authenticated" } }),
};

/** WbF-Signed-1's visitor. */
export const SIGNED_IN = {
  "GET /api/auth/me": {
    id: "00000000-0000-4000-8000-000000000001",
    email: "lazyxgenius@users.noreply.github.com",
    github_login: "lazyxgenius",
    display_name: "Lazyx",
  },
};

/** `GET /api/public/site` (website.md B-4). */
export const SITE = {
  "GET /api/public/site": {
    repo_url: "https://github.com/lazyxgenius/Tvashtr",
    stars: 128,
    desktop: {
      version: "0.7.0",
      tag: "desktop-v0.7.0",
      published_at: "2026-09-27T10:00:00Z",
      dmg_url: "https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg",
      release_url: "https://github.com/lazyxgenius/Tvashtr/releases/tag/desktop-v0.7.0",
      checked_at: "2026-09-27T10:05:00Z",
    },
    checked_at: "2026-09-27T10:05:00Z",
  },
};

/**
 * An init script that makes the browser report a platform through User-Agent Client Hints, the
 * way Chromium does (website.md WEB-32).
 * @param {string} platform "macOS" | "Windows" | "Linux"
 * @param {string} architecture "arm" | "x86"
 */
export function uaPlatform(platform, architecture) {
  return `Object.defineProperty(navigator, "userAgentData", {
    configurable: true,
    value: {
      platform: ${JSON.stringify(platform)},
      mobile: false,
      brands: [],
      getHighEntropyValues: async () => ({ architecture: ${JSON.stringify(architecture)} }),
    },
  });`;
}

export const MAC_ARM = uaPlatform("macOS", "arm");
export const WINDOWS = uaPlatform("Windows", "x86");
