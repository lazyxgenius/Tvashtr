// Engines › Add key sheet (slice F2, groups G3/G4) — website and Desktop renders of each artboard.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-engines scripts/design-parity/scenarios/engines-sheet.mjs
// Names are `<Artboard>-web` / `<Artboard>-desktop`. The sheet opens over the API keys page, drawn
// on the website: on Desktop the page behind it sits 30px lower ("only moved"); the sheet itself is
// fixed to the window's top, like the design's.
// No domain exists in these fixtures (the page's embeddings section then suggests Hugging Face /
// Gemini, as drawn); Claude is connected, so anthropic's sheet shows the subscription note.
import { KEYS, desktopInit, enginesRoutes } from "./engines-fixtures.mjs";

const PATH = "/#/engines/keys";
const SHEET = 'aside[role="dialog"][aria-label]';

/** A POST /api/providers answer (a replace keeps created_at). */
function saved(provider, last4) {
  const old = KEYS.find((k) => k.provider === provider);
  const now = new Date().toISOString();
  return {
    provider,
    key_last4: last4,
    created_at: old?.created_at ?? now,
    updated_at: now,
    replaced: Boolean(old),
  };
}

/** One artboard, rendered on the website and in Desktop. */
function both(artboard, { steps, over = {} } = {}) {
  const routes = () =>
    enginesRoutes({
      domains: [],
      over: {
        "POST /api/providers": (req) => {
          const body = JSON.parse(req.postData() || "{}");
          return {
            json: saved(body.provider, String(body.api_key ?? "").slice(-4)),
          };
        },
        ...over,
      },
    });
  return [
    { name: `${artboard}-web`, path: PATH, routes: routes(), steps },
    {
      name: `${artboard}-desktop`,
      path: PATH,
      routes: routes(),
      steps,
      desktop: true,
      init: desktopInit(),
    },
  ];
}

const seq =
  (...fns) =>
  async (page) => {
    for (const f of fns) await f(page);
  };

/** The page's own "Add key" (the header's, first on the page) opens the empty sheet. */
const openSheet = async (page) => {
  await page.waitForSelector('[data-testid="engines-key-provider"]');
  await page.locator('button:has-text("Add key")').first().click();
  await page.waitForSelector(SHEET);
  // The design draws the pointer off the sheet (no hover tint).
  await page.mouse.move(700, 860);
};

const openList = async (page) => {
  await page.click(`${SHEET} button[aria-haspopup="listbox"]`);
  await page.waitForSelector(`${SHEET} [role="listbox"]`);
  await page.mouse.move(700, 860);
};

const pickOption = (provider) => async (page) => {
  await page.click(`${SHEET} [role="option"]:has-text("${provider}")`);
  await page.waitForSelector(`${SHEET} [role="listbox"]`, {
    state: "detached",
  });
};

/** Take focus off the field the flow left it in (the design draws the sheet at rest). */
const rest = (page) => page.evaluate(() => document.activeElement?.blur());

export default [
  // anthropic picked, the list open again over it.
  ...both("Eng-AddKeyPick", {
    steps: seq(openSheet, openList, pickOption("anthropic"), rest, openList),
  }),
  // anthropic picked and a key pasted.
  ...both("Eng-AddKey", {
    steps: seq(openSheet, openList, pickOption("anthropic"), async (p) => {
      await p.fill(`${SHEET} input[type="password"]`, "sk-ant-parity-e2e-wQ3f");
      await rest(p);
    }),
  }),
  // Nothing picked yet.
  ...both("EnF-PickProvider-1", { steps: openSheet }),
  // The list open.
  ...both("EnF-PickProvider-2", { steps: seq(openSheet, openList) }),
  // "hug" typed in the search.
  ...both("EnF-PickProvider-3", {
    steps: seq(openSheet, openList, (p) =>
      p.fill(`${SHEET} input[placeholder="Search providers"]`, "hug"),
    ),
  }),
  // huggingface picked.
  ...both("EnF-PickProvider-4", {
    steps: seq(openSheet, openList, pickOption("huggingface"), rest),
  }),
  // The pointer on "Other: type the model prefix".
  ...both("EnF-OtherProvider-1", {
    steps: seq(openSheet, openList, (p) =>
      p.hover(`${SHEET} button:has-text("Other: type the model prefix")`),
    ),
  }),
  // Other picked, "mistral/" typed (the slash error), a key pasted.
  ...both("EnF-OtherProvider-2", {
    steps: seq(openSheet, openList, async (p) => {
      await p.click(`${SHEET} button:has-text("Other: type the model prefix")`);
      await p.fill(`${SHEET} input:not([type="password"])`, "mistral/");
      await p.fill(`${SHEET} input[type="password"]`, "sk-mistral-parity-wQ3f");
      await rest(p);
    }),
  }),
];
