import { type Page, expect, test } from "@playwright/test";

import { DESKTOP_MAC_DMG_URL } from "../src/lib/desktopDownload";
import { siteSignIn } from "./_site";

// Live FE proof for the public website (website.md §5): the pages in a real browser, signed out.
// UA detection is faked the way Chromium reports it (a user agent + `navigator.userAgentData`),
// as the parity scenarios do. NO agent run; no model key; hosted or self-hosted backend alike.

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** Make the page report `platform` / `architecture` through User-Agent Client Hints. */
function hints(page: Page, platform: string, architecture: string) {
  return page.addInitScript(
    ([p, a]) => {
      Object.defineProperty(navigator, "userAgentData", {
        configurable: true,
        value: {
          platform: p,
          mobile: false,
          brands: [],
          getHighEntropyValues: () => Promise.resolve({ architecture: a }),
        },
      });
    },
    [platform, architecture],
  );
}

async function noSidewaysScroll(page: Page) {
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll, "the page scrolls sideways").toBeLessThanOrEqual(client);
}

test.describe("the public website", () => {
  test.describe.configure({ timeout: 60_000 });

  test("signed out: the landing, then its Sign in opens the sign-in page", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { level: 1, name: /Compose your own team of AI agents/ }),
    ).toBeVisible({ timeout: 30_000 });
    await siteSignIn(page).click();
    await expect(page).toHaveURL(/#\/signin$/);
    await expect(page.getByRole("heading", { name: "Sign in to Tvashtr" })).toBeVisible();
  });

  test.describe("on a Mac with Apple silicon", () => {
    test.use({ userAgent: MAC_UA });

    test("the download page detects it and every download is the stable DMG", async ({ page }) => {
      await hints(page, "macOS", "arm");
      await page.goto("/#/download");
      await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText("We detected a Mac with Apple silicon")).toBeVisible();
      const download = page.getByRole("link", { name: "Download for Mac · Apple silicon" });
      await expect(download).toHaveAttribute("href", DESKTOP_MAC_DMG_URL);
    });

    test("a Download low on the landing opens the download page at its top", async ({ page }) => {
      await hints(page, "macOS", "arm");
      await page.setViewportSize({ width: 1440, height: 790 });
      await page.goto("/#/welcome");
      const closing = page.getByRole("heading", { name: "Start weaving." });
      await closing.scrollIntoViewIfNeeded();
      await page.locator(".web-close").getByRole("link", { name: "Download for Mac" }).click();
      await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toBeInViewport();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });

  test.describe("on Windows", () => {
    test.use({ userAgent: WINDOWS_UA });

    test("the download page says Mac-only, and offers the Mac download", async ({ page }) => {
      await hints(page, "Windows", "x86");
      await page.goto("/#/download");
      await expect(
        page.getByRole("heading", { name: "The desktop app is Mac-only for now." }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("We detected Windows")).toBeVisible();
      await page.getByRole("link", { name: "I’m on a Mac — show the Mac download" }).click();
      await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toBeVisible();
      await expect(page.getByText(/^We detected/)).toHaveCount(0); // picked, not detected
    });
  });

  test("a ?s=faq link lands on the questions, and one answer is open at a time", async ({
    page,
  }) => {
    await page.goto("/#/welcome?s=faq");
    const first = page.getByRole("button", { name: "Do I need an API key?" });
    const second = page.getByRole("button", {
      name: "Does Tvashtr see my code or my Claude login?",
    });
    await expect(first).toBeInViewport({ timeout: 30_000 });
    await expect(page).toHaveURL(/#\/welcome$/);
    await expect(first).toHaveAttribute("aria-expanded", "true");
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await second.click();
    await expect(second).toHaveAttribute("aria-expanded", "false");
  });

  test.describe("on a phone", () => {
    test.use({ userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, hasTouch: true });

    test("the menu's Desktop for Mac page fits the screen", async ({ page }) => {
      await page.goto("/#/welcome");
      await page.getByRole("button", { name: "Open menu" }).click();
      await page
        .getByRole("dialog", { name: "Menu" })
        .getByRole("link", { name: "Desktop for Mac" })
        .click();
      await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByRole("link", { name: /Download for Mac/ })).toHaveCount(0);
      await noSidewaysScroll(page);
      await page.goto("/#/download/started");
      await expect(page.getByRole("heading", { name: "Three steps and you’re in." })).toBeVisible();
      await noSidewaysScroll(page);
    });
  });

  test("an iPad-width download page fits the screen", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/#/download?os=mac");
    await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toBeVisible({
      timeout: 30_000,
    });
    await noSidewaysScroll(page);
  });

  test("inside Tvashtr Desktop, a public address shows the Desktop welcome", async ({ page }) => {
    // What the Electron preload exposes; main.tsx marks <html> from it.
    await page.addInitScript(() => {
      Object.defineProperty(window, "tvashtrDesktop", { value: {} });
    });
    await page.goto("/#/download");
    await expect(page.getByRole("heading", { name: "Welcome to Tvashtr" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("heading", { name: "Tvashtr for Mac" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  });
});
