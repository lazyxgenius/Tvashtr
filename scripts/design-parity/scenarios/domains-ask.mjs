// The Ask tab (group G6), website and Desktop:
//   ask-1   → DmF-Ask-1 (empty: the four suggestions, the first ringed)
//   ask-2   → DmF-Ask-2 (the question typed, Ask ringed)
//   ask-3   → DmF-Ask-3 (the answer with numbered sources, no card active)
//   ask     → Dm-Ask (source 1 active: Open file / Copy passage)
//   ask-4   → DmF-Ask-4 (chip 2 in the answer ringed, source 2 active)
//   model-1 → DmF-Model-1 (the answer model chip ringed)
//   model-2 → DmF-Model-2 (the answer model listbox open upward)
//   model-3 → DmF-Model-3 (OpenAI gpt-4o-mini picked: the chip and the toast with Undo)
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
];
