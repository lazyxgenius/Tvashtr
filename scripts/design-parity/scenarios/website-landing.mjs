// The website's landing at 1440 (website.md WEB-9..18), group G3: Web-Landing (full length),
// WbF-Start-1 / WbF-Mac-1 / WbF-Win-1 (the same 1440×900 top; their coral ring is annotation, so
// one shot is compared against all three) and WbF-Signed-1 (the top with the signed-in header).
import { SIGNED_IN, SIGNED_OUT, SITE } from "./website-fixtures.mjs";

export default [
  {
    name: "web-landing",
    path: "/#/welcome",
    height: 6640,
    routes: { ...SIGNED_OUT, ...SITE },
  },
  {
    name: "web-landing-top",
    path: "/#/welcome",
    routes: { ...SIGNED_OUT, ...SITE },
  },
  {
    name: "web-signed-1",
    path: "/#/welcome",
    routes: { ...SIGNED_IN, ...SITE },
  },
];
