// The Ask tab (group G6), website and Desktop:
//   ask-1   → DmF-Ask-1 (empty: the four suggestions, the first ringed)
//   ask-2   → DmF-Ask-2 (the question typed, Ask ringed)
//   ask-3   → DmF-Ask-3 (the answer with numbered sources, no card active)
//   ask     → Dm-Ask (source 1 active: Open file / Copy passage)
//   ask-4   → DmF-Ask-4 (chip 2 in the answer ringed, source 2 active)
//   model-1 → DmF-Model-1 (the answer model chip ringed)
//   model-2 → DmF-Model-2 (the answer model listbox open upward)
//   model-3 → DmF-Model-3 (OpenAI gpt-4o-mini picked: the chip and the toast with Undo)
// G8 (answer states + save as test):
//   noans-1    → DmF-NoAns-1 (a question the files don't cover typed, Ask ringed)
//   noans-2    → DmF-NoAns-2 (the amber not-covered answer; the closest passages by page)
//   follow-1   → DmF-Follow-1 (a follow-up typed, Ask ringed)
//   follow-2   → DmF-Follow-2 (the follow-up's answer, "Used your earlier question for context")
//   savetest-1 → DmF-SaveTest-1 (Save as test question ringed)
//   savetest-2 → DmF-SaveTest-2 (the sheet: files + suggested key words, Save test ringed)
//   savetest-3 → DmF-SaveTest-3 (the toast "Saved as test question 13" + View in Quality)
import {
  D,
  DOMAINS,
  SUPPORT_FILES,
  detailOf,
  detailRoutes,
  pair,
} from "./domains-fixtures.mjs";

const path = `/#/domains/${D.support}/ask`;
const SUPPORT = DOMAINS[0];
const detail = detailOf(SUPPORT);
const byName = Object.fromEntries(SUPPORT_FILES.map((f) => [f.filename, f]));

// The design's keys: openai and openrouter saved, no groq key.
const PROVIDERS = ["openai", "openrouter"].map((provider) => ({
  provider,
  key_last4: "3f9a",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
}));

const passage = (name, number, piece, pieces, page, excerpt) => ({
  number,
  document_id: byName[name].document_id,
  filename: name,
  chunk_id: `c-${name}-${piece}`,
  ordinal: piece - 1,
  piece_number: piece,
  pieces_in_file: pieces,
  page,
  excerpt,
});
const REFUND = passage(
  "refund-policy.md",
  1,
  3,
  42,
  null,
  "Customers may request a full refund within 30 days of their original purchase date. Requests are made from Billing → Refunds or by writing to support",
);
const BILLING = passage(
  "billing-faq.pdf",
  2,
  17,
  86,
  4,
  "For annual subscriptions cancelled after the first 30 days, we refund the unused whole months on a prorated basis. Refunds are issued to the original payment method and usually arrive within 5–10 business days",
);
const QUESTION = "How long do customers have to ask for a refund?";
const ANSWER = {
  message_id: "m-answer",
  domain_id: D.support,
  role: "assistant",
  content:
    "Customers can ask for a full refund within **30 days** of purchase [1]. …",
  citations: [],
  latency_ms: 1800,
  cost_usd: 0.0004,
  created_at: "2026-09-26T10:00:01Z",
  covered: true,
  answer_text:
    "Customers can ask for a full refund within **30 days** of purchase[1]. After 30 days, monthly plans aren’t refunded, but annual plans get a prorated refund for the unused months[2]. Refunds go back to the original payment method within 5–10 business days[2].",
  sources: [REFUND, BILLING],
  searched: [REFUND, BILLING],
  used_history: false,
  model: "openai/gpt-4o-mini",
  model_label: "OpenAI gpt-4o-mini",
};
const CHAT = [
  {
    message_id: "m-q",
    domain_id: D.support,
    role: "user",
    content: QUESTION,
    citations: null,
    created_at: "2026-09-26T10:00:00Z",
  },
  ANSWER,
];

// G8: the question the files don't cover, and its closest passages (DM-62).
const NONPROFIT = "Do you offer a discount for non-profits?";
const PRICING_2 = passage(
  "pricing-2026.pdf",
  1,
  5,
  64,
  2,
  "annual plans are billed at 10 months’ price. Verified schools and universities get 40% off",
);
const BILLING_7 = passage(
  "billing-faq.pdf",
  2,
  30,
  86,
  7,
  "discounts can’t be combined, and apply from the next billing cycle",
);
const NOT_COVERED = {
  ...ANSWER,
  message_id: "m-nonprofit",
  content: "NOT_FOUND: The closest passages talk about …",
  latency_ms: 1500,
  covered: false,
  answer_text:
    "The closest passages talk about annual plan pricing and education discounts, not non-profits.",
  sources: [PRICING_2, BILLING_7],
  searched: [PRICING_2, BILLING_7],
};
const NOT_COVERED_CHAT = [
  { ...CHAT[0], message_id: "m-q-nonprofit", content: NONPROFIT },
  NOT_COVERED,
];
// G8: a follow-up; each answer numbers its own sources (OQ-6).
const FOLLOW_UP = "What about annual plans after 6 months?";
const FOLLOW_ANSWER = {
  ...ANSWER,
  message_id: "m-follow",
  latency_ms: 2100,
  used_history: true,
  answer_text:
    "For an annual plan cancelled after 6 months, you get back the 6 unused whole months, prorated[1]. It goes to the original payment method within 5–10 business days[1].",
  sources: [{ ...BILLING, number: 1 }],
  searched: [BILLING, REFUND],
};
const FOLLOW_CHAT = [
  ...CHAT,
  { ...CHAT[0], message_id: "m-q-follow", content: FOLLOW_UP },
  FOLLOW_ANSWER,
];
const SAVED_CASE = {
  case_id: "case-13",
  question: QUESTION,
  expected_citation_doc_ids: [REFUND.document_id, BILLING.document_id],
  expected_keywords: ["30 days", "refund"],
  expected_files: [REFUND, BILLING].map((p) => ({
    document_id: p.document_id,
    filename: p.filename,
    exists: true,
  })),
  ordinal: 12,
};

const base = (messages, over = {}) =>
  detailRoutes({
    detail,
    files: SUPPORT_FILES,
    extra: {
      "GET /api/providers": { providers: PROVIDERS },
      [`GET /api/domains/${D.support}/messages`]: { messages },
      ...over,
    },
  });

const composer = (page) => page.getByPlaceholder("Ask Support docs a question");
const answered = (page) =>
  page.getByRole("article", { name: "Answer" }).waitFor();
const chip = (page) => page.getByRole("button", { name: /^Answer model:/ });
const saveAsTest = (page) =>
  page
    .getByRole("article", { name: "Answer" })
    .getByRole("button", { name: "Save as test question" });
/** Type a question and ring **Ask** (keyboard focus draws the design's ring). */
const typed = (text) => async (page) => {
  await answered(page);
  await composer(page).fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).focus();
};

/** Model-3: the PATCH saves OpenAI gpt-4o-mini, later reads answer with it. */
function pickedRoutes() {
  let picked = false;
  const after = detailOf(SUPPORT, {
    config: { ...SUPPORT.config, generation: { model: "openai/gpt-4o-mini" } },
    answer_model: { ...detail.answer_model, configured: "openai/gpt-4o-mini" },
  });
  return base(CHAT, {
    [`GET /api/domains/${D.support}`]: () => ({
      json: picked ? after : detail,
    }),
    [`PATCH /api/domains/${D.support}`]: () => {
      picked = true;
      return { json: after };
    },
  });
}

const perSurface = (name, spec) =>
  ["web", "desktop"].map((surface) =>
    pair(name, spec()).find((s) => s.name.endsWith(surface)),
  );

export default [
  ...pair("ask-1", {
    path,
    routes: base([]),
    steps: async (page) => {
      await page
        .getByRole("button", { name: "What is the refund window?" })
        .focus();
    },
  }),
  ...pair("ask-2", {
    path,
    routes: base([]),
    steps: async (page) => {
      await page
        .getByRole("button", { name: "How do I set up SSO?" })
        .waitFor();
      await composer(page).fill(QUESTION);
      await page.getByRole("button", { name: "Ask", exact: true }).focus();
    },
  }),
  ...pair("ask-3", { path, routes: base(CHAT), steps: answered }),
  ...pair("ask", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      await page.locator(".dm-passage").first().click();
      await page.mouse.move(0, 0);
      await page.getByRole("button", { name: "Copy passage" }).waitFor();
    },
  }),
  ...pair("ask-4", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      const answer = page.getByRole("article", { name: "Answer" });
      await answer
        .getByRole("button", { name: "Source 1: refund-policy.md" })
        .first()
        .focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Copy passage" }).waitFor();
    },
  }),
  ...pair("model-1", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      await chip(page).focus();
    },
  }),
  ...pair("model-2", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      await chip(page).click();
      await page.getByRole("listbox", { name: "Answer model" }).waitFor();
      await page.getByText("No groq key").waitFor();
      await page.mouse.move(0, 0);
    },
  }),
  ...perSurface("model-3", () => ({
    path,
    routes: pickedRoutes(),
    steps: async (page) => {
      await answered(page);
      await chip(page).click();
      await page.getByRole("option", { name: /^OpenAI gpt-4o-mini/ }).click();
      await page
        .getByText("Answer model set to OpenAI gpt-4o-mini for this domain")
        .waitFor();
      await chip(page).filter({ hasText: "OpenAI gpt-4o-mini" }).waitFor();
      await page.mouse.move(0, 0);
    },
  })),
  ...pair("noans-1", { path, routes: base(CHAT), steps: typed(NONPROFIT) }),
  ...pair("noans-2", {
    path,
    routes: base(NOT_COVERED_CHAT),
    steps: async (page) => {
      await answered(page);
      await page.getByText("page 7").waitFor();
    },
  }),
  ...pair("follow-1", { path, routes: base(CHAT), steps: typed(FOLLOW_UP) }),
  ...pair("follow-2", {
    path,
    routes: base(FOLLOW_CHAT),
    steps: async (page) => {
      await page.getByText("Used your earlier question for context").waitFor();
    },
  }),
  ...pair("savetest-1", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      await saveAsTest(page).focus();
    },
  }),
  ...pair("savetest-2", {
    path,
    routes: base(CHAT),
    steps: async (page) => {
      await answered(page);
      await saveAsTest(page).click();
      const sheet = page.getByRole("dialog", {
        name: "Save as a test question",
      });
      await sheet
        .getByRole("button", { name: "Remove refund", exact: true })
        .waitFor();
      // The ring is keyboard focus: Tab from Cancel.
      await sheet.getByRole("button", { name: "Cancel" }).focus();
      await page.keyboard.press("Tab");
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("savetest-3", {
    path,
    routes: base(CHAT, {
      [`POST /api/domains/${D.support}/eval/cases`]: SAVED_CASE,
    }),
    steps: async (page) => {
      await answered(page);
      await saveAsTest(page).click();
      await page
        .getByRole("dialog", { name: "Save as a test question" })
        .getByRole("button", { name: "Save test" })
        .click();
      await page.getByText("Saved as test question 13").waitFor();
      await page
        .getByRole("dialog", { name: "Save as a test question" })
        .waitFor({ state: "detached" });
      await page.mouse.move(0, 0);
    },
  }),
];
