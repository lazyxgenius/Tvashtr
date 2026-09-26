// Shared Domains fixtures for the parity scenarios (domains-*.mjs). Not a scenario file itself.
// The data mirrors the design's sample: Support docs (14 files, 1,212 pieces, 83%, used 3 times in
// 2 teams), Vendor contracts (reading 4 of 6), Research papers (1 needs attention, 60%, 1 team) and
// Q3 filings (empty, created Sep 23).
export const now = Date.now();
export const ago = (min) => new Date(now - min * 60_000).toISOString();
const YEAR = new Date(now).getFullYear();

const files = (total, part = {}) => ({
  total,
  ready: 0,
  reading: 0,
  waiting: 0,
  waiting_for_key: 0,
  needs_attention: 0,
  ...part,
});
const quality = (over = {}) => ({
  cases: 0,
  last_run_at: null,
  hit_at_k: null,
  keyword_hit: null,
  retrieval_mode: null,
  top_k: null,
  ...over,
});
const READING_MODEL = {
  slug: "openai/text-embedding-3-small",
  label: "OpenAI text-embedding-3-small",
  provider: "openai",
  dim: 1536,
  key_saved: true,
};

export const domain = (id, name, template, over = {}) => ({
  domain_id: id,
  name,
  template,
  config: {
    chunking: { strategy: "fixed", size: 600, overlap: 100 },
    embedding: { model: "text-embedding-3-small" },
    retrieval: { top_k: 8, mode: "hybrid", rerank: { enabled: false, model: null, top_n: 20 }, graph: { enabled: false } },
    generation: { model: null },
  },
  status: "ready",
  doc_count: 0,
  created_at: ago(60 * 24 * 5),
  updated_at: ago(120),
  files: files(0),
  pieces: 0,
  state: "empty",
  quality: quality(),
  usage: { uses: 0, teams: 0, steps: 0, agents: 0 },
  last_activity_at: ago(120),
  reading_model: READING_MODEL,
  ...over,
});

export const D = {
  support: "7f3a2c1e-0b4d-4c55-9a51-2f7d8e6b1a90",
  vendor: "1c9e4a77-5d21-4f0e-8b3c-6a2f9d0e4b12",
  research: "a4b8c2d6-3e5f-4a7b-9c1d-0e2f4a6b8c01",
  q3: "c3d5e7f9-1a2b-4c3d-8e4f-5a6b7c8d9e02",
};

// Creation order (the nav's order): Support docs, Vendor contracts, Research papers, Q3 filings.
export const DOMAINS = [
  domain(D.support, "Support docs", "support", {
    doc_count: 14,
    files: files(14, { ready: 14 }),
    pieces: 1212,
    state: "ready",
    quality: quality({ cases: 12, last_run_at: ago(60 * 26), hit_at_k: 0.83, keyword_hit: 0.75, retrieval_mode: "hybrid", top_k: 8 }),
    usage: { uses: 3, teams: 2, steps: 1, agents: 2 },
    last_activity_at: ago(120),
  }),
  domain(D.vendor, "Vendor contracts", "legal", {
    status: "indexing",
    doc_count: 6,
    files: files(6, { ready: 4, reading: 1, waiting: 1 }),
    pieces: 318,
    state: "reading",
    last_activity_at: ago(0.2),
  }),
  domain(D.research, "Research papers", "scientific", {
    status: "error",
    doc_count: 9,
    files: files(9, { ready: 8, needs_attention: 1 }),
    pieces: 704,
    state: "needs_attention",
    quality: quality({ cases: 5, last_run_at: ago(60 * 30), hit_at_k: 0.6, retrieval_mode: "dense", top_k: 8 }),
    usage: { uses: 1, teams: 1, steps: 1, agents: 0 },
    last_activity_at: ago(60 * 27),
  }),
  domain(D.q3, "Q3 filings", "financial", {
    status: "empty",
    created_at: `${YEAR}-09-23T09:00:00Z`,
    updated_at: `${YEAR}-09-23T09:00:00Z`,
    last_activity_at: `${YEAR}-09-23T09:00:00Z`,
  }),
];

export const TEMPLATES = [
  { template: "support", name: "Support", description: "Help center and product docs", short: "Help center and product docs", piece_size: 600, overlap: 100 },
  { template: "legal", name: "Legal", description: "Contracts and policies · precise sources", short: "Contracts and policies", piece_size: 500, overlap: 80 },
  { template: "financial", name: "Financial", description: "Filings, metrics, investor docs", short: "Filings and investor docs", piece_size: 700, overlap: 100 },
  { template: "scientific", name: "Scientific", description: "Papers and methods · more context", short: "Papers and methods", piece_size: 1000, overlap: 150 },
  { template: "blank", name: "Blank", description: "Start from defaults and tune it yourself", short: "Start from defaults", piece_size: 800, overlap: 100 },
];

/** The API every Domains page reads; `domains` and `providers` vary per board. */
export function domainsRoutes({ domains = DOMAINS, providers = [], howtoHidden = false } = {}) {
  return {
    "GET /api/teams": { teams: [] },
    "GET /api/inbox": { items: [], count: 0 },
    "GET /api/account/preferences": { get_started_hidden: true, domains_howto_hidden: howtoHidden },
    "GET /api/domains": { domains },
    "GET /api/domain-templates": { templates: TEMPLATES },
    "GET /api/providers": { providers },
  };
}

// Desktop renders: the disclosure banner was seen already (the design never draws it).
const DESKTOP_INIT = () => window.sessionStorage.setItem("tvashtr.desktopDisclosureSeen", "1");

/** `<name>-web` and `<name>-desktop` for one board state. */
export function pair(name, spec) {
  return [
    { name: `${name}-web`, ...spec },
    { name: `${name}-desktop`, desktop: true, init: DESKTOP_INIT, ...spec },
  ];
}

/** Type into a field, then blur it (the boards draw fields unfocused). */
export async function typeAndBlur(page, selector, text) {
  await page.locator(selector).fill(text);
  await page.locator(selector).blur();
}

// ---- A domain's page (G2: Dm-Sources, DmF-First-4/5, DmF-Filter-*, DmF-Preview-*) ----

/** `GET /api/domains/{id}`: a list item plus the detail keys. */
export const detailOf = (item, over = {}) => ({
  ...item,
  setup: { key: true, files_read: true, tested: item.quality.cases > 0, used: item.usage.uses > 0 },
  answer_model: {
    configured: null,
    resolved: "openai/gpt-4o-mini",
    label: "OpenAI gpt-4o-mini",
    provider: "openai",
    key_saved: true,
  },
  last_question_at: ago(90),
  ...over,
});

const at = (month, day) => `${YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T10:00:00Z`;
const KB = 1024;
const MB = 1024 * 1024;

/** One `GET …/documents` item. `text` is only the fixture's own search corpus. */
export const file = (name, over = {}) => {
  const ext = name.split(".").pop();
  const kind = { md: "MD", pdf: "PDF", html: "HTML", txt: "TXT" }[ext] ?? "TXT";
  const phase = over.phase ?? "ready";
  const pieces = over.pieces ?? 0;
  return {
    document_id: over.document_id ?? `d0c0${name.replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "0")}-0000-4000-8000-000000000000`,
    domain_id: D.support,
    filename: name,
    content_type: "text/plain",
    byte_size: over.byte_size ?? 18 * KB,
    ingest_status: { ready: "ready", needs_attention: "error", reading: "indexing", rereading: "indexing" }[phase] ?? "pending",
    error_message: null,
    version: phase === "rereading" ? 2 : 1,
    created_at: over.created_at ?? at(9, 12),
    updated_at: over.created_at ?? at(9, 12),
    kind,
    phase,
    pieces: phase === "ready" ? pieces : null,
    pieces_total: pieces,
    pieces_done: phase === "ready" ? pieces : 0,
    progress: over.progress ?? null,
    problem: over.problem ?? null,
    text: over.text ?? "",
  };
};

// Support docs' 14 files, oldest first. The first seven are the design's rows (Dm-Sources); the
// other seven fall below the 900px fold.
export const SUPPORT_FILES = [
  file("refund-policy.md", { byte_size: 18 * KB, pieces: 42, created_at: at(9, 12), text: "Refund policy. Customers may request a full refund within 30 days." }),
  file("billing-faq.pdf", { byte_size: 1.2 * MB, pieces: 86, created_at: at(9, 12), text: "Refunds are issued to the original card. Invoices are sent monthly." }),
  file("getting-started.md", { byte_size: 24 * KB, pieces: 51, created_at: at(9, 12) }),
  file("api-limits.html", { byte_size: 64 * KB, pieces: 73, created_at: at(9, 14) }),
  file("account-security.pdf", { byte_size: 2.4 * MB, pieces: 128, created_at: at(9, 14) }),
  file("pricing-2026.pdf", { byte_size: 880 * KB, pieces: 64, created_at: at(9, 15) }),
  file("sso-setup.md", { byte_size: 31 * KB, pieces: 58, created_at: at(9, 18) }),
  file("webhooks.md", { byte_size: 22 * KB, pieces: 66, created_at: at(9, 19) }),
  file("troubleshooting.pdf", { byte_size: 3.1 * MB, pieces: 132, created_at: at(9, 20) }),
  file("integrations.md", { byte_size: 40 * KB, pieces: 97, created_at: at(9, 21) }),
  file("team-management.md", { byte_size: 28 * KB, pieces: 83, created_at: at(9, 21) }),
  file("data-export.pdf", { byte_size: 1.6 * MB, pieces: 142, created_at: at(9, 22) }),
  file("release-notes.html", { byte_size: 90 * KB, pieces: 121, created_at: at(9, 23) }),
  file("contact-support.txt", { byte_size: 6 * KB, pieces: 69, created_at: at(9, 24) }),
];

/** The Filter boards: troubleshooting.pdf couldn't be read (no text). */
export const SUPPORT_FILES_ATTENTION = SUPPORT_FILES.map((f) =>
  f.filename === "troubleshooting.pdf"
    ? file("troubleshooting.pdf", {
        byte_size: 3.1 * MB,
        created_at: at(9, 20),
        phase: "needs_attention",
        document_id: f.document_id,
        problem: {
          kind: "no_text",
          message: "No text found. It may be a scanned image. Export it as text-based PDF.",
          fix: null,
        },
      })
    : f,
);

const FILTER_OF = { ready: "ready", needs_attention: "needs_attention" };

/** `GET …/documents` answering `q` (names + the fixture text) and `status` like the backend. */
export function filesRoute(files) {
  return (req) => {
    const u = new URL(req.url());
    const q = (u.searchParams.get("q") ?? "").trim().toLowerCase();
    const status = u.searchParams.get("status") ?? "all";
    const counts = { all: files.length, ready: 0, reading: 0, needs_attention: 0 };
    for (const f of files) counts[FILTER_OF[f.phase] ?? "reading"] += 1;
    let documents = files.map((f) => ({ ...f, matched: null }));
    if (q) {
      documents = documents.flatMap((f) =>
        f.filename.toLowerCase().includes(q)
          ? [{ ...f, matched: "name" }]
          : f.text.toLowerCase().includes(q)
            ? [{ ...f, matched: "text" }]
            : [],
      );
    }
    if (status !== "all") documents = documents.filter((f) => (FILTER_OF[f.phase] ?? "reading") === status);
    return {
      json: {
        documents,
        counts,
        total_pieces: files.reduce((n, f) => n + (f.pieces ?? 0), 0),
        query: q,
        status,
      },
    };
  };
}

/** Every route a domain's page reads, for one domain in the nav list `domains`. */
export function detailRoutes({ domains = DOMAINS, detail, files, extra = {} }) {
  const id = detail.domain_id;
  return {
    ...domainsRoutes({ domains }),
    [`GET /api/domains/${id}`]: detail,
    [`GET /api/domains/${id}/documents`]: filesRoute(files),
    ...extra,
  };
}
