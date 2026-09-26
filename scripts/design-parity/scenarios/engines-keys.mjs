// Engines › API keys (slice F2, group G2) — website and Desktop renders of each artboard.
//   node scripts/design-parity/shoot-app.mjs /tmp/parity-engines scripts/design-parity/scenarios/engines-keys.mjs
// Names are `<Artboard>-web` / `<Artboard>-desktop`. Every artboard here is drawn on the website
// (no title strip), so the Desktop renders sit 30px lower ("only moved").
// No domain exists in these fixtures: the Domains embeddings section then suggests Hugging Face /
// Gemini (OQ-7), which is what the design draws.
import { KEYS, desktopInit, enginesRoutes, key } from "./engines-fixtures.mjs";

const PATH = "/#/engines/keys";

/** anthropic saved moments ago (Eng-Flow-Key-2..4 draw it at the top, "Just now"). */
const withAnthropic = () => [
  key("anthropic", "wQ3f", new Date().toISOString()),
  ...KEYS,
];

const tableReady = (page) =>
  page.waitForSelector('[data-testid="engines-key-provider"]');

const openMenu = (provider) => async (page) => {
  await tableReady(page);
  await page.click(`button[aria-label="More actions for ${provider}"]`);
  await page.waitForSelector('[role="menu"]');
  // The design draws the trigger at rest: take the pointer off it (no hover tint).
  await page.mouse.move(700, 860);
};

const pick = (item) => async (page) => {
  await page.click(`[role="menu"] [role="menuitem"]:has-text("${item}")`);
};

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
function both(artboard, { keys, steps = tableReady, over = {} } = {}) {
  const routes = () =>
    enginesRoutes({
      domains: [],
      over: {
        ...(keys
          ? { "GET /api/providers": () => ({ json: { providers: keys() } }) }
          : {}),
        "POST /api/providers": (req) => {
          const body = JSON.parse(req.postData() || "{}");
          const secret = String(body.api_key ?? "");
          return { json: saved(body.provider, secret.slice(-4)) };
        },
        "DELETE /api/providers/:provider": () => ({ status: 204, json: null }),
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

export default [
  ...both("Eng-Keys"),
  // anthropic just saved; the ⋯ menu on deepseek.
  ...both("Eng-Flow-Key-2", {
    keys: withAnthropic,
    steps: openMenu("deepseek"),
  }),
  ...both("Eng-Flow-Key-3", {
    keys: withAnthropic,
    steps: seq(openMenu("deepseek"), pick("Remove key"), (p) =>
      p.waitForSelector('[role="alertdialog"]'),
    ),
  }),
  ...both("Eng-Flow-Key-4", {
    keys: withAnthropic,
    steps: seq(openMenu("deepseek"), pick("Replace key"), async (p) => {
      await p.waitForSelector('[role="alertdialog"]');
      // The dialog focuses "New key"; the design draws the field at rest.
      await p.evaluate(() => document.activeElement?.blur());
    }),
  }),
  ...both("EnF-KeyUsed-1", { steps: openMenu("deepseek") }),
  ...both("EnF-KeyUsed-2", {
    steps: seq(openMenu("deepseek"), pick("See where it’s used"), (p) =>
      p.waitForSelector(
        '[role="dialog"][aria-label="Where the deepseek key is used"]',
      ),
    ),
  }),
  ...both("EnF-KeyUsed-3", {
    steps: seq(openMenu("deepseek"), pick("Replace key"), async (p) => {
      await p.waitForSelector('[role="alertdialog"]');
      // The design draws the pasted key masked, ending in Qm81.
      await p.fill('[role="alertdialog"] input', "••••••••••••••••••••Qm81");
    }),
  }),
  ...both("EnF-KeyUsed-4", {
    steps: seq(openMenu("deepseek"), pick("Replace key"), async (p) => {
      await p.waitForSelector('[role="alertdialog"]');
      await p.fill('[role="alertdialog"] input', "sk-deepseek-e2e-Qm81");
      await p.click('[role="alertdialog"] button:has-text("Replace key")');
      await p.waitForSelector('[role="status"].ds-toast');
    }),
  }),
];
