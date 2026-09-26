// The Quality tab (group G7), website and Desktop:
//   quality → Dm-Quality (12 test questions, the latest run 2 hours ago, compared with Sep 24)
//   qual-1  → DmF-Qual-1 (no test questions: the card, Add test question ringed)
//   qual-2  → DmF-Qual-2 (the sheet over the empty card; the file picker open, webhooks.md picked)
//   qual-3  → DmF-Qual-3 (the sheet over 7 questions not run yet; the chip, key words, Add test ringed)
//   qual-4  → DmF-Qual-4 (8 questions running: the banner, Run all tests loading, cells "—")
//   qual-5  → DmF-Qual-5 (8 questions ran just now; the webhook miss opened, the table scrolled to it)
import {
  D,
  DOMAINS,
  ago,
  detailOf,
  detailRoutes,
  file,
  pair,
} from "./domains-fixtures.mjs";

const path = `/#/domains/${D.support}/quality`;
const detail = detailOf(DOMAINS[0]);
const YEAR = new Date().getFullYear();
const localIso = (month, day, h, m) =>
  new Date(YEAR, month - 1, day, h, m).toISOString();

// The picker's files: the four the frame lists first, then the rest (14, "Type to search 14 files").
export const FILES = [
  ["webhooks.md", 77],
  ["integrations.html", 288],
  ["api-limits.html", 73],
  ["troubleshooting.pdf", 201],
  ["refund-policy.md", 42],
  ["billing-faq.pdf", 86],
  ["sso-setup.md", 58],
  ["team-roles.md", 49],
  ["export-data.md", 61],
  ["release-notes-sep.md", 44],
  ["account-security.pdf", 128],
  ["pricing-2026.pdf", 64],
  ["getting-started.md", 51],
  ["contact-support.txt", 70],
].map(([name, pieces], i) =>
  file(name, { pieces, created_at: ago(60 * 24 * 10 - i) }),
);
const idOf = Object.fromEntries(FILES.map((f) => [f.filename, f.document_id]));

// [question, file, key words, found the file, found the key words]
export const CASES = [
  [
    "How long do customers have to ask for a refund?",
    "refund-policy.md",
    "30 days, refund",
    true,
    true,
  ],
  [
    "Can I get my money back on an annual plan?",
    "billing-faq.pdf",
    "prorated, annual",
    true,
    true,
  ],
  [
    "How do I turn on single sign-on?",
    "sso-setup.md",
    "SAML, admin",
    true,
    true,
  ],
  [
    "What is the API rate limit per minute?",
    "api-limits.html",
    "requests per minute",
    true,
    false,
  ],
  [
    "Which roles can invite teammates?",
    "team-roles.md",
    "admin, invite",
    true,
    true,
  ],
  [
    "How do I verify webhook signatures?",
    "webhooks.md",
    "signature, secret",
    false,
    false,
  ],
  ["How do I export all my data?", "export-data.md", "export, CSV", true, true],
  [
    "What changed in the September release?",
    "release-notes-sep.md",
    "September",
    true,
    true,
  ],
  [
    "How do I reset my password?",
    "account-security.pdf",
    "reset, email",
    true,
    true,
  ],
  [
    "Which plans include priority support?",
    "pricing-2026.pdf",
    "priority",
    true,
    false,
  ],
  ["How do I connect Slack?", "integrations.html", "Slack", false, true],
  ["Where do I find my invoices?", "billing-faq.pdf", "invoice", true, true],
].map(([question, name, words, hit, kw], i) => ({
  case_id: `c0000000-0000-4000-8000-0000000000${String(i + 10)}`,
  domain_id: D.support,
  question,
  expected_answer: null,
  expected_citation_doc_ids: [idOf[name]],
  expected_files: [{ document_id: idOf[name], filename: name, exists: true }],
  expected_keywords: words.split(", "),
  ordinal: i + 1,
  created_at: ago(60 * 24 * 4),
  hit,
  kw,
}));

const TOP = [
  [
    "integrations.html",
    "…signed payloads are sent to your endpoint with an X-Signature header…",
  ],
  ["api-limits.html", "…each API key may send up to 600 requests per minute…"],
  [
    "troubleshooting.pdf",
    "…if your webhook endpoint returns 5xx we retry 5 times…",
  ],
].map(([name, excerpt], i) => ({
  number: i + 1,
  document_id: idOf[name],
  filename: name,
  excerpt,
}));

export const CONFIG = {
  chunking: { strategy: "fixed", size: 600, overlap: 100 },
  embedding: { model: "text-embedding-3-small" },
  retrieval: { mode: "dense", top_k: 8 },
  generation: { model: null },
};

/** A finished run over `cases`: scores from their results, the webhook miss with its top 3. */
export function run(number, cases, at, over = {}) {
  const hits = cases.filter((c) => c.hit).length;
  const kws = cases.filter((c) => c.kw).length;
  const per_case = cases.map((c) => ({
    case_id: c.case_id,
    question: c.question,
    hit: c.hit,
    keyword_hit: c.kw,
    citation_doc_ids: [],
    latency_ms: 200,
    error: null,
    top: c.hit ? [] : TOP,
  }));
  return {
    run_id: `a0000000-0000-4000-8000-0000000000${number}0`,
    domain_id: D.support,
    number,
    status: "completed",
    created_at: at,
    completed_at: at,
    hit_at_k: hits / cases.length,
    keyword_hit: kws / cases.length,
    retrieval_mode: "dense",
    top_k: 8,
    config: CONFIG,
    progress: { done: cases.length, total: cases.length },
    error_message: null,
    scores: { cases_total: cases.length, per_case },
    ...over,
  };
}

/** Routes for one board: the cases, the runs (newest first) and each run by id. */
export function routes(cases, runs, d = detail) {
  const byId = Object.fromEntries(
    runs.map((r) => [`GET /api/domains/${D.support}/eval/runs/${r.run_id}`, r]),
  );
  return detailRoutes({
    detail: d,
    files: FILES,
    extra: {
      [`GET /api/domains/${D.support}/eval/cases`]: {
        cases: cases.map(({ hit, kw, ...c }) => c),
      },
      [`GET /api/domains/${D.support}/eval/runs`]: {
        runs: runs.map(({ scores, ...r }) => r),
      },
      ...byId,
    },
  });
}

const TWELVE = CASES;
const EIGHT = CASES.slice(0, 8);
const SEVEN = CASES.slice(0, 7);
export const earlier = (cases) => [
  run(4, cases, localIso(9, 24, 10, 2)),
  run(3, cases, localIso(9, 22, 9, 40)),
  run(2, cases, localIso(9, 20, 16, 5), {
    config: {
      ...CONFIG,
      chunking: { strategy: "fixed", size: 500, overlap: 80 },
    },
  }),
];

const openSheet = async (page) => {
  await page.getByRole("button", { name: "Add test question" }).click();
  await page.getByRole("dialog", { name: "Add a test question" }).waitFor();
  await page
    .getByRole("textbox", { name: "Question" })
    .fill("How do I verify webhook signatures?");
};

export default [
  ...pair("quality", {
    path,
    routes: routes(TWELVE, [run(5, TWELVE, ago(120)), ...earlier(TWELVE)]),
    steps: async (page) => {
      await page.getByText("How do I export all my data?").waitFor();
    },
  }),
  ...pair("qual-1", {
    path,
    routes: routes([], []),
    steps: async (page) => {
      await page.getByRole("button", { name: "Add test question" }).focus();
    },
  }),
  ...pair("qual-2", {
    path,
    routes: routes([], []),
    steps: async (page) => {
      await openSheet(page);
      await page.getByRole("button", { name: "Files it should find" }).click();
      await page.getByRole("option", { name: /^webhooks\.md/ }).click();
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("qual-3", {
    path,
    routes: routes(SEVEN, []),
    steps: async (page) => {
      await page.getByText("Which roles can invite teammates?").waitFor();
      await openSheet(page);
      await page.getByRole("button", { name: "Files it should find" }).click();
      await page.getByRole("option", { name: /^webhooks\.md/ }).click();
      await page.keyboard.press("Escape");
      await page
        .getByRole("textbox", { name: "Key words" })
        .fill("signature, secret");
      await page.getByRole("button", { name: "Cancel" }).focus();
      await page.keyboard.press("Tab");
      await page.mouse.move(0, 0);
    },
  }),
  ...pair("qual-4", {
    path,
    routes: routes(EIGHT, [
      {
        ...run(1, EIGHT, ago(0.05)),
        status: "running",
        completed_at: null,
        hit_at_k: null,
        keyword_hit: null,
        progress: { done: 0, total: 8 },
        scores: { cases_total: 8, per_case: [] },
      },
    ]),
    steps: async (page) => {
      await page.getByText("How do I export all my data?").waitFor();
    },
  }),
  ...pair("qual-5", {
    path,
    routes: routes(EIGHT, [run(5, EIGHT, ago(0.2)), ...earlier(EIGHT)]),
    steps: async (page) => {
      await page
        .getByRole("button", {
          name: "How do I verify webhook signatures?",
          exact: true,
        })
        .click();
      await page.getByText("What search found (top 3 of 8)").waitFor();
      await page.locator(".dm-qtable").evaluate((el) => {
        const rows = el.querySelectorAll("tbody tr");
        el.scrollTop = rows[3].offsetTop - rows[0].offsetTop;
      });
      await page.mouse.move(0, 0);
    },
  }),
];
