// A domain's page and its Sources tab (group G2), website and Desktop:
//   sources   → Dm-Sources, DmF-Preview-1 (Preview-1 rings the first file name: focused here)
//   first-4   → DmF-First-4 (the first read: setup strip, a file reading 64%, one waiting)
//   first-5   → DmF-First-5 (all read: the ready toast)
//   filter-1  → DmF-Filter-1 ("refund" matches a name and a file's text)
//   filter-2  → DmF-Filter-2 (the Show listbox open, with counts)
//   filter-3  → DmF-Filter-3 (Show: Needs attention)
//   preview-2 → DmF-Preview-2 (refund-policy.md's pieces in the sheet)
import {
  D,
  DOMAINS,
  SUPPORT_FILES,
  SUPPORT_FILES_ATTENTION,
  ago,
  detailOf,
  detailRoutes,
  domain,
  file,
  pair,
  typeAndBlur,
} from "./domains-fixtures.mjs";

const path = `/#/domains/${D.support}`;
const SUPPORT = DOMAINS[0];
const detail = detailOf(SUPPORT);
const routes = detailRoutes({ detail, files: SUPPORT_FILES });

const attention = detailOf({
  ...SUPPORT,
  status: "error",
  files: { ...SUPPORT.files, ready: 13, needs_attention: 1 },
  state: "needs_attention",
});
const attentionRoutes = detailRoutes({ detail: attention, files: SUPPORT_FILES_ATTENTION });

const table = async (page) => page.locator("table tbody tr").first().waitFor();

// ---- The first read (First-4 → First-5): one new domain, three files ----
const justNow = ago(0.3);
const newDomain = (over) =>
  domain(D.support, "Support docs", "support", {
    created_at: justNow,
    updated_at: justNow,
    last_activity_at: justNow,
    ...over,
  });
const reading = newDomain({
  status: "indexing",
  doc_count: 3,
  files: { total: 3, ready: 1, reading: 1, waiting: 1, waiting_for_key: 0, needs_attention: 0 },
  pieces: 42,
  state: "reading",
});
const read = newDomain({
  status: "ready",
  doc_count: 3,
  files: { total: 3, ready: 3, reading: 0, waiting: 0, waiting_for_key: 0, needs_attention: 0 },
  pieces: 179,
  state: "ready",
});
const firstSetup = { key: true, files_read: false, tested: false, used: false };
const readingDetail = detailOf(reading, { setup: firstSetup, last_question_at: null });
const readDetail = detailOf(read, { setup: { ...firstSetup, files_read: true }, last_question_at: null });
const FIRST_FILES = [
  file("refund-policy.md", { byte_size: 18 * 1024, pieces: 42, created_at: justNow }),
  file("billing-faq.pdf", { byte_size: 1.2 * 1024 * 1024, pieces: 86, created_at: justNow, phase: "reading", progress: 0.64 }),
  file("getting-started.md", { byte_size: 24 * 1024, pieces: 51, created_at: justNow, phase: "waiting" }),
];
const FIRST_READ = [
  FIRST_FILES[0],
  file("billing-faq.pdf", { byte_size: 1.2 * 1024 * 1024, pieces: 86, created_at: justNow }),
  file("getting-started.md", { byte_size: 24 * 1024, pieces: 51, created_at: justNow }),
];

/** Answers the reading state first, then the finished one (the page polls every 3 s). */
function firstReadRoutes() {
  let loads = 0;
  const done = () => loads > 1;
  return detailRoutes({
    domains: [reading],
    detail: readingDetail,
    files: FIRST_FILES,
    extra: {
      "GET /api/domains": () => ({ json: { domains: [done() ? read : reading] } }),
      [`GET /api/domains/${D.support}`]: () => {
        loads += 1;
        return { json: done() ? readDetail : readingDetail };
      },
      [`GET /api/domains/${D.support}/documents`]: (req) => {
        const files = done() ? FIRST_READ : FIRST_FILES;
        return {
          json: {
            documents: files,
            counts: { all: 3, ready: files.filter((f) => f.phase === "ready").length, reading: 0, needs_attention: 0 },
            total_pieces: files.reduce((n, f) => n + (f.pieces ?? 0), 0),
          },
        };
      },
    },
  });
}

// ---- The preview sheet: the design's four pieces of refund-policy.md ----
// Each piece's text starts with the design's visible words; the long tail makes the card's excerpt
// stop exactly where the design's "…" is.
const TAIL = ` ${"x".repeat(400)}`;
const PIECES = [
  [1, 598, "# Refund policy. This page explains when and how customers can get their money back for Acme Cloud plans"],
  [2, 600, "Refunds apply to the subscription price only. Usage-based charges, like extra seats added mid-cycle, are billed separately"],
  [3, 596, "Customers may request a full refund within 30 days of their original purchase date. Requests are made from Billing → Refunds"],
  [4, 601, "After 30 days, monthly plans are not refunded. You can cancel at any time and keep access until the end of the paid month"],
].map(([number, chars, text]) => ({ ordinal: number - 1, number, chars, page: null, text: text + TAIL }));
const refund = SUPPORT_FILES[0];
const piecesRoute = {
  [`GET /api/domains/${D.support}/documents/${refund.document_id}/pieces`]: {
    document: refund,
    pieces: PIECES,
    total: PIECES.length,
    query: "",
    used_in_answers: { count: 6, of: 20 },
  },
};

export default [
  ...pair("sources", {
    path,
    routes,
    steps: async (page) => {
      await table(page);
      await page.getByRole("button", { name: "refund-policy.md", exact: true }).focus();
    },
  }),
  ...pair("first-4", { path, routes: detailRoutes({ domains: [reading], detail: readingDetail, files: FIRST_FILES }), steps: table }),
  // Each render needs its own counter: web's loads must not make Desktop start finished.
  ...["web", "desktop"].map((surface) => ({
    ...pair("first-5", {
      path,
      routes: firstReadRoutes(),
      settle: 600,
      steps: async (page) => {
        await page.getByText("Support docs is ready. Ask it a question.").waitFor({ timeout: 10_000 });
        await page.getByText("179 pieces", { exact: false }).first().waitFor();
      },
    }).find((s) => s.name.endsWith(surface)),
  })),
  ...pair("filter-1", {
    path,
    routes,
    steps: async (page) => {
      await table(page);
      await typeAndBlur(page, 'input[placeholder="Search files"]', "refund");
      await page.getByText("2 of 14 files match “refund”").waitFor();
    },
  }),
  ...pair("filter-2", {
    path,
    routes: attentionRoutes,
    steps: async (page) => {
      await table(page);
      await page.getByRole("button", { name: "Show" }).click();
      await page.getByRole("listbox", { name: "Show" }).waitFor();
    },
  }),
  ...pair("filter-3", {
    path,
    routes: attentionRoutes,
    steps: async (page) => {
      await table(page);
      await page.getByRole("button", { name: "Show" }).click();
      await page.getByRole("option", { name: /Needs attention/ }).click();
      await page.getByText("1 file needs attention ·").waitFor();
    },
  }),
  ...pair("preview-2", {
    path,
    routes: { ...routes, ...piecesRoute },
    steps: async (page) => {
      await table(page);
      await page.getByRole("button", { name: "refund-policy.md", exact: true }).click();
      await page.getByRole("dialog", { name: "refund-policy.md" }).getByText("Piece 4 of 42").waitFor();
    },
  }),
];
