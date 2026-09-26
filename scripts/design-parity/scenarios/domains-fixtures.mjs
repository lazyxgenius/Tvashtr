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
