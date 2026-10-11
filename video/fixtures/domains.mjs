/**
 * Scene 1.5 (SAMPLE): Domains — "Exchange API docs" made from the empty page, three PDFs read, one
 * question answered with numbered sources. Built from the live base (live-base.json) and
 * design-parity's domains-fixtures / domains-new / domains-sources / domains-ask shapes, rewritten
 * to the story. Stateful: POST /api/domains creates the domain, the uploads add its files, reading
 * moves with the clock, POST …/ask answers and the chat then lists it.
 *
 * Why SAMPLE (brief F10): reading files needs an embeddings key and the film account holds only
 * DeepSeek. The sample adds a free Hugging Face token (the product's own "Use the free Hugging Face
 * model" path) — the one thing the live account does not have. With DeepSeek the only model key, the
 * account default answers, labelled as the server labels it ("deepseek deepseek-chat").
 */
import { ago, clone, live, liveRoutes, story } from "./base.mjs";
import { FILENAMES, pdfPath, passage, pieces } from "./domains-docs.mjs";
import fs from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The live domain's id (live-base.json): 2.3's Query domain step points at this domain. */
const LIVE_DOMAIN = live("GET /api/domains").domains.find((d) => d.name === story.domain.name);
export const DOMAIN_ID = LIVE_DOMAIN.domain_id;
export const NAME = story.domain.name;

const HF = "huggingface/BAAI/bge-small-en-v1.5";
const READING_MODEL = { slug: HF, label: "Hugging Face BGE-small (free)", provider: "huggingface", dim: 384, key_saved: true };
// What the server answers with only a DeepSeek model key (domain_views.answer_model_summary).
const ANSWER_MODEL = {
  configured: null,
  resolved: story.backup_model,
  label: "deepseek deepseek-chat",
  provider: "deepseek",
  key_saved: true,
};

// backend control_plane/domains.py list_domain_templates (design-parity domains-fixtures TEMPLATES).
const TEMPLATES = [
  { template: "support", name: "Support", description: "Help center and product docs", short: "Help center and product docs", piece_size: 600, overlap: 100 },
  { template: "legal", name: "Legal", description: "Contracts and policies · precise sources", short: "Contracts and policies", piece_size: 500, overlap: 80 },
  { template: "financial", name: "Financial", description: "Filings, metrics, investor docs", short: "Filings and investor docs", piece_size: 700, overlap: 100 },
  { template: "scientific", name: "Scientific", description: "Papers and methods · more context", short: "Papers and methods", piece_size: 1000, overlap: 150 },
  { template: "blank", name: "Blank", description: "Start from defaults and tune it yourself", short: "Start from defaults", piece_size: 800, overlap: 100 },
];

// Home's first-time view (no team yet) asks for the team templates: a real take opens #/home before
// the scene's start. backend teams.py list_templates/blank_template + graph_validity.shape_from_roles.
const KIND = { pm: "thinker", architect: "thinker", thinker: "thinker", engineer: "worker", reviewer: "worker", gate: "gate", ship: "terminal" };
const LABEL = { pm: "PM", architect: "Architect", thinker: "Thinker", engineer: "Engineer", reviewer: "Reviewer", gate: "Approval", ship: "Ship" };
const tpl = (template, name, description, roles, loops = []) => ({
  template,
  name,
  description,
  shape: { nodes: roles.map((role) => ({ id: null, kind: KIND[role], role, label: LABEL[role] })), loops: loops.map(([from, to]) => ({ from, to })) },
});
const TEAM_TEMPLATES = {
  templates: [
    tpl("two_node", "PM → Engineer", "A PM writes the spec; an Engineer builds and ships it. No review step.", ["pm", "gate", "engineer", "ship"]),
    tpl("review_loop", "PM → Engineer ⇄ Reviewer", "Adds a Reviewer that runs the tests and loops back for fixes.", ["pm", "gate", "engineer", "reviewer", "ship"], [[3, 2]]),
    tpl("plan_review", "PM → Architect → Engineer ⇄ Reviewer", "Two thinkers plan it, then a build-and-review loop ships it.", ["pm", "architect", "gate", "engineer", "reviewer", "ship"], [[4, 3]]),
    tpl("full_squad", "Full feature squad", "Plan, you approve, build and test in a loop, you approve the ship.", ["pm", "architect", "gate", "engineer", "reviewer", "gate", "ship"], [[4, 3]]),
  ],
  blank: tpl("blank", "Blank", "An empty canvas: one thinker into Ship. Wire the rest yourself.", ["thinker", "ship"]),
};

/** The files to pick on camera: the real PDFs, under the names the app shows. */
export const PICKED = FILENAMES.map((name) => ({ name, mimeType: "application/pdf", buffer: fs.readFileSync(pdfPath(name)) }));

/** Seconds each file takes to read, one after the other (a 2-piece file on BGE-small). */
const READ_S = 1.3;

export const QUESTION = "What are the rate limits on the candles endpoint?";

/** A UUID-shaped id like the server's (`tag`: 4 hex digits naming the kind). */
const uid = (tag, i) => `${DOMAIN_ID.slice(0, 8)}-${tag}-4000-8000-${String(i + 1).padStart(12, "0")}`;
const docId = (i) => uid("d0c0", i);

/** Piece `i` of `name` as a search hit (describe_passages: the citation plus where it sits). */
const hit = (name, i) => {
  const f = FILENAMES.indexOf(name);
  const list = pieces(name);
  return {
    document_id: docId(f),
    filename: name,
    chunk_id: uid("c0c0", f * 10 + i),
    ordinal: i,
    page: 1,
    piece_number: i + 1,
    pieces_in_file: list.length,
    excerpt: list[i].slice(0, 400),
  };
};
const at = (name, phrase) => passage(name, phrase).piece_number - 1;
const LIMITS = { ...hit("exchange-api-limits.pdf", at("exchange-api-limits.pdf", "GET /candles returns at most 1,000 candles")), number: 1 };
const ERRORS = { ...hit("exchange-api-errors.pdf", at("exchange-api-errors.pdf", "429 rate_limited")), number: 2 };
// Dense search with top_k 8 over 6 pieces returns every piece; the two the answer cites rank first.
const SEARCHED = [
  LIMITS,
  ERRORS,
  ...FILENAMES.flatMap((n) => pieces(n).map((_, i) => hit(n, i))).filter((h) => h.chunk_id !== LIMITS.chunk_id && h.chunk_id !== ERRORS.chunk_id),
].map(({ number: _n, ...h }) => h);
const ANSWER = {
  role: "assistant",
  covered: true,
  answer_text:
    "GET /candles is a market data endpoint, so it allows **20 requests per second** per API key[1]. Each request returns at most **1,000 candles**; page back with the `end` parameter for older data[1]. Over the limit you get a **429** with a `Retry-After` header: wait that many seconds before you retry[2].",
  sources: [
    { ...LIMITS, citation_index: 1 },
    { ...ERRORS, citation_index: 2 },
  ],
  searched: SEARCHED,
  used_history: false,
  model: ANSWER_MODEL.resolved,
  model_label: ANSWER_MODEL.label,
  latency_ms: 2400,
};

export default function domainsRoutes() {
  const base = liveRoutes();
  let created = null; // ms when POST /api/domains answered
  const uploads = []; // { name, size, at }
  const chat = [];

  /** Each uploaded file's phase now: read one after the other, READ_S apiece, from the first upload. */
  const files = () => {
    const t0 = uploads[0]?.at ?? Date.now();
    const t = (Date.now() - t0) / 1000;
    return uploads.map((u, i) => {
      const n = pieces(u.name).length;
      const k = Math.min(1, Math.max(0, (t - i * READ_S) / READ_S));
      const phase = k >= 1 ? "ready" : k > 0 ? "reading" : "waiting";
      const at = new Date(u.at).toISOString();
      return {
        document_id: docId(FILENAMES.indexOf(u.name)),
        domain_id: DOMAIN_ID,
        filename: u.name,
        content_type: "application/pdf",
        byte_size: u.size,
        ingest_status: { ready: "ready", reading: "indexing" }[phase] ?? "pending",
        error_message: null,
        version: 1,
        created_at: at,
        updated_at: at,
        kind: "PDF",
        phase,
        pieces: phase === "ready" ? n : null,
        pieces_total: n,
        pieces_done: phase === "ready" ? n : Math.floor(k * n),
        progress: phase === "reading" ? Math.round(k * 100) / 100 : null,
        problem: null,
        matched: null,
      };
    });
  };

  const detail = () => {
    const fs_ = files();
    const count = (p) => fs_.filter((f) => f.phase === p).length;
    const ready = count("ready");
    const busy = ready < fs_.length;
    const at = new Date(created).toISOString();
    const lastQ = chat.findLast?.((m) => m.role === "user")?.created_at ?? null;
    return {
      ...clone(LIVE_DOMAIN),
      config: { ...clone(LIVE_DOMAIN.config), embedding: { model: HF } },
      status: fs_.length === 0 ? "empty" : busy ? "indexing" : "ready",
      doc_count: fs_.length,
      created_at: at,
      updated_at: at,
      files: { total: fs_.length, ready, reading: count("reading"), waiting: count("waiting"), waiting_for_key: 0, needs_attention: 0 },
      pieces: fs_.reduce((n, f) => n + (f.pieces ?? 0), 0),
      state: fs_.length === 0 ? "empty" : busy ? "reading" : "ready",
      // 1.5 comes before chapter 2 builds the team: nothing uses the domain yet.
      usage: { uses: 0, teams: 0, steps: 0, agents: 0 },
      last_activity_at: uploads.length ? new Date(uploads.at(-1).at).toISOString() : at,
      reading_model: READING_MODEL,
      setup: { key: true, files_read: fs_.length > 0 && !busy, tested: lastQ !== null, used: false },
      answer_model: ANSWER_MODEL,
      last_question_at: lastQ,
      rereading: null,
    };
  };

  const item = () => {
    const { setup: _s, answer_model: _a, last_question_at: _l, rereading: _r, ...rest } = detail();
    return rest;
  };

  const provider = (p) => base["GET /api/providers"].providers.find((x) => x.provider === p);

  return {
    ...base,
    "GET /api/account/preferences": { ...base["GET /api/account/preferences"], notify_asked: true },
    // Chapter 1 is before the team exists (2.1 builds it): no team, nothing in the inbox.
    "GET /api/teams": { teams: [] },
    "GET /api/templates": TEAM_TEMPLATES,
    "GET /api/inbox": { count: 0, items: [] },
    "GET /api/inbox?surface=desktop": { count: 0, items: [] },
    // The live DeepSeek key, plus the free Hugging Face token the sample assumes (mismatch, SCENES.md).
    "GET /api/providers": {
      providers: [
        provider("deepseek"),
        { provider: "huggingface", key_last4: "9f3c", created_at: ago(3600), updated_at: ago(3600) },
      ],
    },
    // No team yet, so nothing for Engines to flag; the new domain reads with the Hugging Face token.
    "GET /api/engines/usage": () => {
      const d = created && { domain_id: DOMAIN_ID, name: NAME };
      return {
        json: {
          teams: [],
          domains: d ? [{ ...d, embedding_model: HF, embedding_provider: "huggingface", generation_model: null, generation_provider: null }] : [],
          by_provider: d ? { huggingface: { teams: [], fallback_teams: [], domains: [{ ...d, use: "embedding" }] } } : {},
        },
      };
    },
    "GET /api/domain-templates": { templates: TEMPLATES },
    "GET /api/domains": () => ({ json: { domains: created ? [item()] : [] } }),
    "POST /api/domains": async (req) => {
      const body = req.postDataJSON() ?? {};
      await sleep(350);
      created = Date.now();
      const d = detail();
      return { json: { ...d, name: body.name ?? NAME, template: body.template ?? d.template } };
    },
    [`POST /api/domains/${DOMAIN_ID}/documents`]: async (req) => {
      const buf = req.postDataBuffer() ?? Buffer.alloc(0);
      const name = /filename="([^"]+)"/.exec(buf.toString("latin1"))?.[1];
      if (!FILENAMES.includes(name)) return { status: 400, json: { detail: `no fixture for ${name}` } };
      await sleep(450);
      const size = PICKED.find((p) => p.name === name).buffer.length;
      uploads.push({ name, size, at: Date.now() });
      const row = files().find((f) => f.filename === name);
      return { json: { ...row, reading: "started" } };
    },
    [`GET /api/domains/${DOMAIN_ID}`]: () => (created ? { json: detail() } : { status: 404, json: { detail: "Domain not found" } }),
    [`GET /api/domains/${DOMAIN_ID}/documents`]: () => {
      const documents = files();
      const ready = documents.filter((f) => f.phase === "ready").length;
      return {
        json: {
          documents,
          counts: { all: documents.length, ready, reading: documents.length - ready, needs_attention: 0 },
          total_pieces: documents.reduce((n, f) => n + (f.pieces ?? 0), 0),
          query: "",
          status: "all",
        },
      };
    },
    [`GET /api/domains/${DOMAIN_ID}/messages`]: () => ({ json: { messages: chat } }),
    [`POST /api/domains/${DOMAIN_ID}/ask`]: async (req) => {
      const { question } = req.postDataJSON() ?? {};
      const asked = new Date().toISOString();
      await sleep(ANSWER.latency_ms);
      const answer = {
        ...ANSWER,
        answer: ANSWER.answer_text,
        message_id: uid("a5c1", chat.length),
        user_message_id: uid("a5c0", chat.length),
        domain_id: DOMAIN_ID,
        content: ANSWER.answer_text,
        citations: ANSWER.searched,
        created_at: new Date().toISOString(),
      };
      chat.push({ message_id: answer.user_message_id, domain_id: DOMAIN_ID, role: "user", content: question, citations: null, created_at: asked }, answer);
      return { json: answer };
    },
  };
}
