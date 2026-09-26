// The New domain dialog and the no-key path (group G3), website and Desktop:
//   new-1    → Dm-NewDialog (step 1 over the list; an openai key is saved)
//   first-2  → DmF-First-2 (step 1 over the empty page, Next: add files ringed = focused)
//   first-3  → DmF-First-3 (step 2 with three picked files, Create and read 3 files focused)
//   nokey-1  → DmF-NoKey-1 (no openai key: the warn callout, Add openai key focused)
//   nokey-2  → DmF-NoKey-2 (the Add an API key sheet over the dialog, the API key field focused)
//   nokey-3  → DmF-NoKey-3 (the key saved: the key line, the toast, Next: add files focused)
//   nokey-4  → DmF-NoKey-4 (the warn callout, Use the free Hugging Face model focused)
import {
  D,
  DOMAINS,
  ago,
  domainsRoutes as baseRoutes,
  pair,
  typeAndBlur,
} from "./domains-fixtures.mjs";

const path = "/#/domains";

// The dialog boards draw the list in the design's order (Support docs first) while its footers say
// Support "2 hours ago" and Vendor "just now" — the app sorts by last activity (DM-8), so behind the
// dialog the two cards' last activity is swapped: same cards, same order as the frame, the two
// footer strings trade places (only moved). Otherwise the cards' template pills "Support"/"Legal"
// would pair with the dialog's radio-card names.
const DESIGN_ORDER = DOMAINS.map((d) =>
  d.domain_id === D.support
    ? { ...d, last_activity_at: ago(0.2) }
    : d.domain_id === D.vendor
      ? { ...d, last_activity_at: ago(120) }
      : d,
);
const domainsRoutes = (over = {}) =>
  baseRoutes({ domains: DESIGN_ORDER, ...over });
const OPENAI = [
  { provider: "openai", key_last4: "4f2a", created_at: "2026-09-20T10:00:00Z" },
];
const NAME = 'input[placeholder="e.g. Support docs"]';

/** Open New domain from the list (or the empty page's card) and type the name, unfocused. */
async function openDialog(page) {
  await page.getByRole("button", { name: "New domain" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New domain" });
  await dialog.waitFor();
  await typeAndBlur(page, NAME, "Support docs");
  return dialog;
}

/** Step 1 with no openai key: the callout shows once the providers load. */
async function noKeyDialog(page) {
  await page.locator("article").first().waitFor();
  const dialog = await openDialog(page);
  await dialog.getByRole("button", { name: "Add openai key" }).waitFor();
  return dialog;
}

/** Saving a key: `GET /api/providers` answers with it after the POST (DmF-NoKey-3). */
function savingRoutes() {
  let saved = false;
  return {
    ...domainsRoutes(),
    "GET /api/providers": () => ({
      status: 200,
      json: { providers: saved ? OPENAI : [] },
    }),
    "POST /api/providers": () => {
      saved = true;
      return { status: 200, json: { provider: "openai", key_last4: "4f2a" } };
    },
  };
}

const KB = 1024;
const PICKED = [
  {
    name: "refund-policy.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(18 * KB, "a"),
  },
  {
    name: "billing-faq.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(Math.round(1.2 * KB * KB), "b"),
  },
  {
    name: "getting-started.md",
    mimeType: "text/markdown",
    buffer: Buffer.alloc(24 * KB, "c"),
  },
];

export default [
  ...pair("new-1", {
    path,
    routes: domainsRoutes({ providers: OPENAI }),
    steps: async (page) => {
      await page.locator("article").first().waitFor();
      const dialog = await openDialog(page);
      await dialog.getByText("key saved").waitFor();
    },
  }),
  ...pair("first-2", {
    path,
    routes: domainsRoutes({ domains: [], providers: OPENAI }),
    steps: async (page) => {
      await page
        .getByRole("group", { name: "Or start from a template" })
        .waitFor();
      const dialog = await openDialog(page);
      await dialog.getByText("key saved").waitFor();
      await dialog.getByRole("button", { name: "Next: add files" }).focus();
    },
  }),
  ...pair("first-3", {
    path,
    routes: domainsRoutes({ domains: [], providers: OPENAI }),
    steps: async (page) => {
      await page
        .getByRole("group", { name: "Or start from a template" })
        .waitFor();
      const dialog = await openDialog(page);
      await dialog.getByText("key saved").waitFor();
      await dialog.getByRole("button", { name: "Next: add files" }).click();
      await page
        .locator('[data-testid="new-domain-files"]')
        .setInputFiles(PICKED);
      await dialog
        .getByRole("button", { name: "Create and read 3 files" })
        .focus();
    },
  }),
  ...pair("nokey-1", {
    path,
    routes: domainsRoutes(),
    steps: async (page) => {
      const dialog = await noKeyDialog(page);
      await dialog.getByRole("button", { name: "Add openai key" }).focus();
    },
  }),
  ...pair("nokey-2", {
    path,
    routes: domainsRoutes(),
    steps: async (page) => {
      const dialog = await noKeyDialog(page);
      await dialog.getByRole("button", { name: "Add openai key" }).click();
      const sheet = page.getByRole("dialog", { name: "Add an API key" });
      await sheet.waitFor();
      await sheet.getByLabel("API key").focus();
    },
  }),
  // Each render gets its own saving state.
  { ...pair("nokey-3", {})[0], path, routes: savingRoutes(), steps: saveKey },
  { ...pair("nokey-3", {})[1], path, routes: savingRoutes(), steps: saveKey },
  ...pair("nokey-4", {
    path,
    routes: domainsRoutes(),
    steps: async (page) => {
      const dialog = await noKeyDialog(page);
      await dialog
        .getByRole("button", { name: "Use the free Hugging Face model" })
        .focus();
    },
  }),
];

async function saveKey(page) {
  const dialog = await noKeyDialog(page);
  await dialog.getByRole("button", { name: "Add openai key" }).click();
  const sheet = page.getByRole("dialog", { name: "Add an API key" });
  await sheet.getByLabel("API key").fill("sk-proj-test-4f2a");
  await sheet.getByRole("button", { name: "Save key" }).click();
  await dialog.getByText("key saved").waitFor();
  await page
    .getByRole("status")
    .filter({ hasText: "openai key saved" })
    .waitFor();
}
