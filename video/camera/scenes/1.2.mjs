// 1.2 Engines: Claude and Grok connected with your own sign-in; one API key, masked.
// The Terminal sign-in itself is a MAC shot (video/SCENES.md); a backup model is per agent (2.5).
import { keepOnlyKey } from "../film.mjs";

export default {
  id: "1.2",
  title: "Engines: Claude and Grok on your own sign-in; one API key, masked",
  mode: "live",
  budget: 20,
  setup: async (ctx) => {
    await keepOnlyKey(ctx.api, ctx.story.api_key.provider);
  },
  // Off camera: the account menu proves who is signed in (F1 evidence).
  before: async ({ page, shot }) => {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menu", { name: "Account" }).waitFor();
    await shot("account-menu");
    await page.keyboard.press("Escape");
  },
  film: async ({ page, cam }) => {
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await cam.pause(800);
    await cam.click(nav.getByRole("button", { name: /^Engines/ }), "Engines");
    await page.getByRole("heading", { name: "Engines", level: 1 }).waitFor();
    await cam.pause(1600);
    await cam.click(nav.getByRole("button", { name: /^Subscriptions/ }), "Subscriptions");
    const subs = page.locator("section[aria-labelledby='tv-engines-subs']");
    await subs.waitFor();
    for (const s of ["claude", "grok"])
      await page
        .locator(`article.eng-sub[data-sub="${s}"] .eng-sub__badges`, { hasText: "Connected" })
        .waitFor({ timeout: 30000 });
    await cam.roi("subscriptions", subs);
    await cam.hover(page.locator('article.eng-sub[data-sub="claude"]'), "Claude card");
    await cam.pause(900);
    await cam.hover(page.locator('article.eng-sub[data-sub="grok"]'), "Grok card");
    await cam.pause(1200);
    await cam.click(nav.getByRole("button", { name: /^API keys/ }), "API keys");
    const keys = page.locator("section[aria-labelledby='tv-engines-keys']");
    await keys.waitFor();
    const row = keys.locator("tr", { has: page.locator('[data-testid="engines-key-provider"]') }).first();
    await cam.roi("api-key", row);
    await cam.hover(row.locator(".eng-key__last4"), "the masked key");
    await cam.pause(1800);
  },
};
