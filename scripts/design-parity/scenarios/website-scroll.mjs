// The website's section scroll and FAQ flows at 1440 (website.md WEB-7, WEB-17), group G4. Each
// board is the header with one section scrolled under it by `#/welcome?s=<section>`.
// web-two = WbF-Two-1 and WbF-Two-2 (the same screen; the ring is annotation). WbF-Faq-1 shows all
// five questions closed, so its scenario first closes item 1 (open on load, OQ-28); WbF-Faq-2
// opens item 2, which closes item 1 (single-open).
import { SIGNED_OUT, SITE } from "./website-fixtures.mjs";

const routes = { ...SIGNED_OUT, ...SITE };
// Wait out the smooth scroll before the shot, and before a click (Playwright's click would stop
// it half way).
const settle = 1500;
const scrolled = (page) => page.waitForTimeout(settle);

export default [
  { name: "web-two", path: "/#/welcome?s=two-ways", routes, settle },
  {
    name: "web-faq-1",
    path: "/#/welcome?s=faq",
    routes,
    settle,
    steps: async (page) => {
      await scrolled(page);
      await page.getByRole("button", { name: "Do I need an API key?" }).click();
    },
  },
  {
    name: "web-faq-2",
    path: "/#/welcome?s=faq",
    routes,
    settle,
    steps: async (page) => {
      await scrolled(page);
      await page
        .getByRole("button", {
          name: "Does Tvashtr see my code or my Claude login?",
        })
        .click();
    },
  },
];
