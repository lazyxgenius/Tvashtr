// The website's download pages (website.md WEB-32..37), group G1: Web-Download (= WbF-Mac-2),
// Web-Download2 (= WbF-Mac-3), WbF-Mac-4 (the "Open Tvashtr?" dialog) and Web-DownloadWin
// (= WbF-Win-2). The WbF boards are the same screens with a coral ring on what you click; compare
// them against the same scenario json. Signed out, as the boards draw the header.
import { MAC_ARM, SIGNED_OUT, SITE, WINDOWS } from "./website-fixtures.mjs";

const routes = { ...SIGNED_OUT, ...SITE };

export default [
  { name: "web-download", path: "/#/download", init: MAC_ARM, routes },
  { name: "web-download2", path: "/#/download/started", init: MAC_ARM, routes },
  {
    name: "web-mac-4",
    path: "/#/download/started",
    init: MAC_ARM,
    routes,
    steps: async (page) => {
      await page.getByRole("button", { name: "I’ve installed it — open Tvashtr" }).click();
    },
  },
  { name: "web-download-win", path: "/#/download", init: WINDOWS, routes },
];
