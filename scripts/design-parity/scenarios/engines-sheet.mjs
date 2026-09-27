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

/** One artboard, rendered on the website and in Desktop. A save lands in the render's own key
 *  list, so a refetch (window focus) still shows it. */
function both(artboard, { steps, over = {} } = {}) {
  const routes = () => {
    const keys = [...KEYS];
    return enginesRoutes({
      domains: [],
      over: {
        "GET /api/providers": () => ({ json: { providers: keys } }),
        "POST /api/providers": (req) => {
          const body = JSON.parse(req.postData() || "{}");
          const answer = saved(
            body.provider,
            String(body.api_key ?? "").slice(-4),
          );
          const at = keys.findIndex((k) => k.provider === answer.provider);
          const row = {
            provider: answer.provider,
            key_last4: answer.key_last4,
            created_at: answer.created_at,
            updated_at: answer.updated_at,
          };
          if (at >= 0) keys[at] = row;
          else keys.unshift(row);
          return { json: answer };
        },
        ...over,
      },
    });
  };
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

/** The suggested-keys banner's "+ provider" (the sheet opens with it picked). */
const fromBanner = (provider) => async (page) => {
  await page.waitForSelector('[data-testid="engines-key-provider"]');
  await page.click(`[role="note"] button:has-text("${provider}")`);
  await page.waitForSelector(SHEET);
  await page.mouse.move(700, 860);
};

/** The Domains embeddings section's Add key ("Add an embeddings key", huggingface picked). */
const fromEmbeddings = async (page) => {
  await page.waitForSelector('[data-testid="engines-key-provider"]');
  await page.click('#engines-embeddings button:has-text("Add key")');
  await page.waitForSelector(SHEET);
  await page.mouse.move(700, 860);
};

/** Paste a key, Save key, and wait for the sheet to go and the toast to show. */
const saveKey = (secret) => async (page) => {
  await page.fill(`${SHEET} input[type="password"]`, secret);
  await page.click(`${SHEET} button:has-text("Save key")`);
  await page.waitForSelector(SHEET, { state: "detached" });
  await page.waitForSelector('.ds-toast[role="status"]');
  // Off the table, the toast and every button (no hover tint).
  await page.mouse.move(1420, 760);
  await rest(page);
};

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
  // Other picked, "mistral" typed, a key pasted: the footer says what the key covers.
  ...both("EnF-OtherProvider-3", {
    steps: seq(openSheet, openList, async (p) => {
      await p.click(`${SHEET} button:has-text("Other: type the model prefix")`);
      await p.fill(`${SHEET} input:not([type="password"])`, "mistral");
      await p.fill(`${SHEET} input[type="password"]`, "sk-mistral-parity-wQ3f");
      await rest(p);
    }),
  }),
  // Save key with nothing filled in.
  ...both("EnF-SaveErrors-1", {
    steps: seq(openSheet, async (p) => {
      await p.click(`${SHEET} button:has-text("Save key")`);
      await p.waitForSelector(`${SHEET} [role="alert"]`);
      await p.mouse.move(700, 860);
      await rest(p);
    }),
  }),
  // The backend can't be reached: the form says so and keeps the values.
  ...both("EnF-SaveErrors-2", {
    over: {
      // A 5xx: the proxy reached the app (the header stays Connected, as drawn).
      "POST /api/providers": () => ({
        status: 500,
        json: { detail: "Internal Server Error" },
      }),
    },
    steps: seq(openSheet, openList, pickOption("anthropic"), async (p) => {
      await p.fill(`${SHEET} input[type="password"]`, "sk-ant-parity-e2e-wQ3f");
      await p.click(`${SHEET} button:has-text("Save key")`);
      await p.waitForSelector(`${SHEET} [role="alert"]`);
      await p.mouse.move(700, 860);
      await rest(p);
    }),
  }),
  // Saved from the header's Add key: a "Just now" anthropic row, the banner down to xai, and the
  // toast naming the key the team still needs (Add xai).
  ...both("Eng-Flow-Key-1", {
    steps: seq(
      openSheet,
      openList,
      pickOption("anthropic"),
      saveKey("sk-ant-parity-e2e-wQ3f"),
    ),
  }),
  // The banner's "+ xai": the sheet opens with xai picked.
  ...both("EnF-Suggest-1", { steps: seq(fromBanner("xai"), rest) }),
  // Saved: an xai row, the banner down to anthropic, "Add anthropic too, so …" (banner origin).
  ...both("EnF-Suggest-2", {
    steps: seq(fromBanner("xai"), saveKey("xai-parity-e2e-9Kx2")),
  }),
  // The embeddings section's Add key: "Add an embeddings key" with huggingface picked.
  ...both("EnF-Embeddings-1", { steps: seq(fromEmbeddings, rest) }),
  // Saved: a huggingface row used by Domains ingest, the section shows the key (no button) and the
  // toast offers Open Domains.
  ...both("EnF-Embeddings-2", {
    steps: seq(fromEmbeddings, saveKey("hf_parity_e2e_f0Tk")),
  }),
];
