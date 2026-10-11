// 1.4 Connectors: Linear. SAMPLE (brief F10: no Linear account in V1): Toolkit → Browse, Featured →
// Linear's Connect → "Connect Linear", read only → "Continue to Linear" → the Desktop waits for the
// browser sign-in → connected: the Connected tab with the Linear row and the toast.
// Fixtures: video/fixtures/connectors.mjs (stateful sign-in; nothing else connected).
export default {
  id: "1.4",
  title: "Connectors: Linear",
  mode: "sample",
  fixtures: "connectors",
  budget: 12,
  start: "#/home",
  // "Continue to Linear" opens the system browser (window.open → shell.openExternal): never for real.
  before: async (ctx) => {
    if (ctx.app)
      await ctx.app.evaluate(({ shell }) => {
        shell.openExternal = async () => {};
      });
    await ctx.page.evaluate(() => {
      window.open = () => ({ closed: false, close() {}, focus() {} });
    });
  },
  film: async ({ page, cam }) => {
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await cam.pause(600);
    // Nothing connected yet: Toolkit lands on Connectors › Browse.
    await cam.click(nav.getByRole("button", { name: /^Toolkit/ }), "Toolkit");
    await page.getByRole("heading", { name: "Featured", level: 2 }).waitFor();
    const card = page.getByRole("article", { name: "Linear", exact: true });
    await card.getByRole("button", { name: "Connect", exact: true }).waitFor();
    await cam.roi("featured", page.locator("section.cn-section").first());
    await cam.pause(800);
    await cam.hover(card, "the Linear card");
    await cam.pause(600);
    await cam.click(card.getByRole("button", { name: "Connect", exact: true }), "Connect Linear");
    const sheet = page.getByRole("dialog", { name: "Connect Linear" });
    await sheet.waitFor();
    await cam.roi("sheet", sheet);
    await cam.pause(800);
    await cam.click(sheet.getByRole("button", { name: "Read only", exact: true }), "Read only");
    await cam.pause(700);
    await cam.click(sheet.getByRole("button", { name: "Continue to Linear", exact: true }), "Continue to Linear");
    // The Desktop waits for the browser; the poll comes back connected after a few tries.
    await sheet.getByText("Finish signing in to Linear in your browser").waitFor();
    await cam.mark("waiting for the Linear sign-in");
    await page.getByRole("tab", { name: /^Connected/ }).and(page.locator("[aria-selected=true]")).waitFor({ timeout: 20000 });
    const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "Linear", exact: true }) });
    await row.waitFor();
    await cam.mark("Linear connected");
    await cam.roi("linear-row", row);
    await cam.roi("toast", page.getByText("Linear is connected.", { exact: false }).first());
    await cam.pause(1800);
  },
};
