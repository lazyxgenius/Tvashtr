// The website's landing on a phone (website.md WEB-20..24), group G4: Web-Mobile (390×2300),
// WbF-Mob-1 (the 390×844 top; its ring on the menu button is annotation), WbF-Mob-2 (the menu
// open) and WbF-Mob-3 (Start building's "Best on a computer" sheet).
import { SIGNED_OUT, SITE } from "./website-fixtures.mjs";

const phone = {
  width: 390,
  height: 844,
  path: "/#/welcome",
  routes: { ...SIGNED_OUT, ...SITE },
};

export default [
  { ...phone, name: "web-mobile", height: 2300 },
  { ...phone, name: "web-mob-1" },
  {
    ...phone,
    name: "web-mob-2",
    steps: async (page) => {
      await page.getByRole("button", { name: "Open menu" }).click();
    },
  },
  {
    ...phone,
    name: "web-mob-3",
    steps: async (page) => {
      await page.getByRole("button", { name: "Start building" }).click();
    },
  },
];
