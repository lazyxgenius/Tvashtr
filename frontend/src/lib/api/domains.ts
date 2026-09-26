/**
 * The Domains API clients (revamp round 2, contract `docs/superpowers/plans/api/domains.md`).
 *
 * The original clients moved here from `lib/api.ts` unchanged in behaviour (it re-exports them for
 * old imports); every call now also reports the backend status. The revamp's own reads are
 * shape-validated at this boundary (`normalizeDomainListItem`): one odd item is dropped or
 * defaulted, never allowed to blank the page.
 */
import { ApiError, apiUrl, getMe } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";

/** fetch + backend-status reporting (a 401 lets the session gate know). */
async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), init);
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  // A gateway error (the proxy is up, the app behind it isn't) counts as unreachable.
  if (res.status >= 502 && res.status <= 504) reportFetchFailed();
  else reportFetchOk();
  if (res.status === 401) void getMe().catch(() => undefined);
  return res;
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await send(path);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** The server's `detail` string, else `fallback`. */
async function detailOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // not JSON
  }
  return fallback;
}

// ---- Revamp summaries (GET /api/domains, GET /api/domains/{id}) ----

/** One word for a domain's badge and nav dot (contract: "The domain summary"). */
export type DomainState =
  | "empty"
  | "reading"
  | "rereading"
  | "waiting_for_key"
  | "needs_attention"
  | "ready";

export interface DomainFiles {
  total: number;
  ready: number;
  reading: number;
  waiting: number;
  waiting_for_key: number;
  needs_attention: number;
}

export interface DomainQuality {
  cases: number;
  last_run_at: string | null;
  /** 0–1 fraction of test questions whose expected file was found. */
  hit_at_k: number | null;
  keyword_hit: number | null;
  retrieval_mode: string | null;
  top_k: number | null;
}

export interface DomainUsage {
  uses: number;
  teams: number;
  steps: number;
  agents: number;
}

export interface DomainReadingModel {
  slug: string;
  label: string;
  provider: string;
  dim: number | null;
  key_saved: boolean;
}

export interface DomainListItem extends DomainSummary {
  files: DomainFiles;
  pieces: number;
  state: DomainState;
  quality: DomainQuality;
  usage: DomainUsage;
  last_activity_at: string;
  reading_model: DomainReadingModel;
}

const STATES: DomainState[] = [
  "empty",
  "reading",
  "rereading",
  "waiting_for_key",
  "needs_attention",
  "ready",
];

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** Validate one summary item. `null` when it lacks an id or a name; every other key defaults. */
export function normalizeDomainListItem(raw: unknown): DomainListItem | null {
  const r = obj(raw);
  if (typeof r.domain_id !== "string" || !r.domain_id || typeof r.name !== "string") return null;
  const f = obj(r.files);
  const files: DomainFiles = {
    total: count(f.total ?? r.doc_count),
    ready: count(f.ready),
    reading: count(f.reading),
    waiting: count(f.waiting),
    waiting_for_key: count(f.waiting_for_key),
    needs_attention: count(f.needs_attention),
  };
  const q = obj(r.quality);
  const u = obj(r.usage);
  const m = obj(r.reading_model);
  const createdAt = typeof r.created_at === "string" ? r.created_at : "";
  const updatedAt = typeof r.updated_at === "string" ? r.updated_at : createdAt;
  const state = STATES.includes(r.state as DomainState)
    ? (r.state as DomainState)
    : files.total === 0
      ? "empty"
      : "ready";
  return {
    domain_id: r.domain_id,
    name: r.name,
    template: typeof r.template === "string" ? r.template : "blank",
    config: obj(r.config),
    status: typeof r.status === "string" ? r.status : "",
    doc_count: count(r.doc_count),
    created_at: createdAt,
    updated_at: updatedAt,
    files,
    pieces: count(r.pieces),
    state,
    quality: {
      cases: count(q.cases),
      last_run_at: strOrNull(q.last_run_at),
      hit_at_k: numOrNull(q.hit_at_k),
      keyword_hit: numOrNull(q.keyword_hit),
      retrieval_mode: strOrNull(q.retrieval_mode),
      top_k: numOrNull(q.top_k),
    },
    usage: {
      uses: count(u.uses),
      teams: count(u.teams),
      steps: count(u.steps),
      agents: count(u.agents),
    },
    last_activity_at: typeof r.last_activity_at === "string" ? r.last_activity_at : updatedAt,
    reading_model: {
      slug: typeof m.slug === "string" ? m.slug : "",
      label: typeof m.label === "string" ? m.label : "",
      provider: typeof m.provider === "string" ? m.provider : "",
      dim: numOrNull(m.dim),
      key_saved: m.key_saved === true,
    },
  };
}

/** The account's domains with their summaries, in creation order (the nav's order). */
export async function listDomainSummaries(): Promise<DomainListItem[]> {
  const res = await send("/api/domains");
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load your domains."));
  const body = obj((await res.json()) as unknown);
  const items = Array.isArray(body.domains) ? body.domains : [];
  return items.map(normalizeDomainListItem).filter((d): d is DomainListItem => d !== null);
}

/** The starting points in design order (support, legal, financial, scientific, blank). */
export async function listDomainTemplates(): Promise<DomainTemplate[]> {
  const res = await send("/api/domain-templates");
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load the templates."));
  const body = obj((await res.json()) as unknown);
  const items = Array.isArray(body.templates) ? body.templates : [];
  return items.flatMap((raw): DomainTemplate[] => {
    const t = obj(raw);
    if (typeof t.template !== "string" || typeof t.name !== "string") return [];
    return [
      {
        template: t.template,
        name: t.name,
        description: typeof t.description === "string" ? t.description : "",
        short: typeof t.short === "string" ? t.short : undefined,
        piece_size: numOrNull(t.piece_size) ?? undefined,
        overlap: numOrNull(t.overlap) ?? undefined,
      },
    ];
  });
}

// ---- The detail page and its Sources tab (GET /api/domains/{id}, …/documents) ----

/** The setup strip's four steps (DM-37); the strip shows while `files_read` is false. */
export interface DomainSetup {
  key: boolean;
  files_read: boolean;
  tested: boolean;
  used: boolean;
}

/** What answers questions (DM-63): `configured` null = the account default. */
export interface DomainAnswerModel {
  configured: string | null;
  resolved: string | null;
  label: string | null;
  provider: string | null;
  key_saved: boolean;
}

export interface DomainDetailView extends DomainListItem {
  setup: DomainSetup;
  answer_model: DomainAnswerModel;
  last_question_at: string | null;
}

/** Validate the detail answer; `null` when it isn't a domain. */
export function normalizeDomainDetail(raw: unknown): DomainDetailView | null {
  const base = normalizeDomainListItem(raw);
  if (!base) return null;
  const r = obj(raw);
  const s = obj(r.setup);
  const a = obj(r.answer_model);
  return {
    ...base,
    setup: {
      key: s.key === undefined ? base.reading_model.key_saved : s.key === true,
      files_read: s.files_read === undefined ? base.state === "ready" : s.files_read === true,
      tested: s.tested === true,
      used: s.used === undefined ? base.usage.uses > 0 : s.used === true,
    },
    answer_model: {
      configured: strOrNull(a.configured),
      resolved: strOrNull(a.resolved),
      label: strOrNull(a.label),
      provider: strOrNull(a.provider),
      key_saved: a.key_saved === true,
    },
    last_question_at: strOrNull(r.last_question_at),
  };
}

/** One domain with its summaries; `ApiError` 404 when it doesn't exist (any more). */
export async function getDomainDetail(domainId: string): Promise<DomainDetailView> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}`);
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load this domain."));
  const detail = normalizeDomainDetail((await res.json()) as unknown);
  if (!detail) throw new ApiError(500, "Couldn’t load this domain.");
  return detail;
}

/**
 * `POST /api/domains` from the New domain dialog (DM-22, DM-29): the name, starting point and —
 * when the user changed it — the reading model. Answers with the full summary. A name clash is a
 * 409 and a bad name a 422, each with the copy to show under the Name field (`ApiError.message`).
 */
export async function createNewDomain(body: {
  name: string;
  template: string;
  embedding_model?: string;
}): Promise<DomainDetailView> {
  const res = await send("/api/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(
      res.status,
      await detailOf(res, "Couldn’t create the domain — is the backend running?"),
    );
  }
  const detail = normalizeDomainDetail((await res.json()) as unknown);
  if (!detail) throw new ApiError(500, "Couldn’t create the domain — is the backend running?");
  return detail;
}

/** A file's phase in the Status column (DM-42). `uploading` is local to this browser. */
export type DomainFilePhase =
  | "ready"
  | "reading"
  | "rereading"
  | "waiting"
  | "waiting_for_key"
  | "needs_attention";

export type DomainFileKind = "PDF" | "MD" | "HTML" | "TXT";

/** A failed read in the table's words (DM-43). */
export interface DomainFileProblem {
  kind: string;
  message: string;
  /** `engines_key`: the fix is a key in Engines ("Fix key in Engines"). */
  fix: "engines_key" | null;
}

export interface DomainFile {
  document_id: string;
  filename: string;
  byte_size: number;
  created_at: string;
  version: number;
  kind: DomainFileKind;
  phase: DomainFilePhase;
  /** Pieces of a ready file; null otherwise ("—"). */
  pieces: number | null;
  pieces_total: number;
  pieces_done: number;
  /** 0–1 while reading or re-reading. */
  progress: number | null;
  problem: DomainFileProblem | null;
  matched: "name" | "text" | null;
}

export type DomainFileFilter = "all" | "ready" | "reading" | "needs_attention";

export interface DomainFileCounts {
  all: number;
  ready: number;
  reading: number;
  needs_attention: number;
}

export interface DomainFilesList {
  documents: DomainFile[];
  counts: DomainFileCounts;
  total_pieces: number;
}

const PHASES: DomainFilePhase[] = [
  "ready",
  "reading",
  "rereading",
  "waiting",
  "waiting_for_key",
  "needs_attention",
];
const KINDS: DomainFileKind[] = ["PDF", "MD", "HTML", "TXT"];

function kindOf(filename: string): DomainFileKind {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "PDF";
  if (ext === "md") return "MD";
  if (ext === "html") return "HTML";
  return "TXT";
}

/** Validate one file; `null` when it lacks an id or a name. */
export function normalizeDomainFile(raw: unknown): DomainFile | null {
  const r = obj(raw);
  if (typeof r.document_id !== "string" || !r.document_id) return null;
  if (typeof r.filename !== "string") return null;
  const p = r.problem ? obj(r.problem) : null;
  const phase = PHASES.includes(r.phase as DomainFilePhase)
    ? (r.phase as DomainFilePhase)
    : r.ingest_status === "ready"
      ? "ready"
      : r.ingest_status === "error"
        ? "needs_attention"
        : r.ingest_status === "indexing"
          ? "reading"
          : "waiting";
  return {
    document_id: r.document_id,
    filename: r.filename,
    byte_size: count(r.byte_size),
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    version: count(r.version) || 1,
    kind: KINDS.includes(r.kind as DomainFileKind)
      ? (r.kind as DomainFileKind)
      : kindOf(r.filename),
    phase,
    pieces: numOrNull(r.pieces),
    pieces_total: count(r.pieces_total),
    pieces_done: count(r.pieces_done),
    progress: numOrNull(r.progress),
    problem:
      p && typeof p.message === "string"
        ? {
            kind: typeof p.kind === "string" ? p.kind : "other",
            message: p.message,
            fix: p.fix === "engines_key" ? "engines_key" : null,
          }
        : null,
    matched: r.matched === "name" || r.matched === "text" ? r.matched : null,
  };
}

/** The domain's files (oldest first), narrowed by `q` (names and text) and the Show filter. */
export async function listDomainFiles(
  domainId: string,
  opts: { q?: string; status?: DomainFileFilter } = {},
): Promise<DomainFilesList> {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  const qs = params.toString();
  const res = await send(
    `/api/domains/${encodeURIComponent(domainId)}/documents${qs ? `?${qs}` : ""}`,
  );
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load the files."));
  const body = obj((await res.json()) as unknown);
  const documents = (Array.isArray(body.documents) ? body.documents : [])
    .map(normalizeDomainFile)
    .filter((d): d is DomainFile => d !== null);
  const c = obj(body.counts);
  return {
    documents,
    counts: {
      all: c.all === undefined ? documents.length : count(c.all),
      ready: count(c.ready),
      reading: count(c.reading),
      needs_attention: count(c.needs_attention),
    },
    total_pieces: count(body.total_pieces),
  };
}

export interface DomainPiece {
  number: number;
  chars: number;
  page: number | null;
  text: string;
}

export interface DomainFilePieces {
  document: DomainFile;
  pieces: DomainPiece[];
  /** Pieces matching the find (for paging). */
  total: number;
  used_in_answers: { count: number; of: number };
}

/** One file's pieces in order (`q` keeps the pieces that contain it), 50 at a time. */
export async function getDomainFilePieces(
  domainId: string,
  documentId: string,
  opts: { q?: string; offset?: number; limit?: number } = {},
): Promise<DomainFilePieces> {
  const params = new URLSearchParams();
  if (opts.q?.trim()) params.set("q", opts.q.trim());
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const res = await send(
    `/api/domains/${encodeURIComponent(domainId)}/documents/${encodeURIComponent(documentId)}/pieces${
      qs ? `?${qs}` : ""
    }`,
  );
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load this file."));
  const body = obj((await res.json()) as unknown);
  const document = normalizeDomainFile(body.document);
  if (!document) throw new ApiError(500, "Couldn’t load this file.");
  const used = obj(body.used_in_answers);
  return {
    document,
    pieces: (Array.isArray(body.pieces) ? body.pieces : []).flatMap((raw): DomainPiece[] => {
      const p = obj(raw);
      if (typeof p.text !== "string" || typeof p.number !== "number") return [];
      return [{ number: p.number, chars: count(p.chars), page: numOrNull(p.page), text: p.text }];
    }),
    total: count(body.total),
    used_in_answers: { count: count(used.count), of: count(used.of) },
  };
}

/** Read some files — or all of them — again (DM-50). */
export async function rereadDomainFiles(
  domainId: string,
  body: { document_ids?: string[]; run_tests_after?: boolean } = {},
): Promise<{ reading: number; state: string }> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}/reread`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t start reading."));
  const out = obj((await res.json()) as unknown);
  return { reading: count(out.reading), state: typeof out.state === "string" ? out.state : "" };
}

/**
 * The original file's address. The page links to it in the SAME window (`<a href download>`),
 * never a new one: on Desktop a new window opens in the system browser, which has no session (D2).
 */
export function domainFileUrl(domainId: string, documentId: string): string {
  return apiUrl(
    `/api/domains/${encodeURIComponent(domainId)}/documents/${encodeURIComponent(documentId)}/file`,
  );
}

// ---- The original clients (moved from lib/api.ts) ----

export interface DomainSummary {
  domain_id: string;
  name: string;
  template: string;
  config: Record<string, unknown>;
  status: string;
  doc_count: number;
  created_at: string;
  updated_at: string;
}

export type DomainDetail = DomainSummary;

export interface DomainTemplate {
  template: string;
  name: string;
  /** The New domain dialog's line under the name. */
  description: string;
  /** The empty page's template-card line (revamp). */
  short?: string;
  piece_size?: number;
  overlap?: number;
}

export async function listDomains(): Promise<DomainSummary[]> {
  const data = await getJSON<{ domains: DomainSummary[] }>("/api/domains");
  return data.domains;
}

export async function getDomainTemplates(): Promise<DomainTemplate[]> {
  const data = await getJSON<{ templates: DomainTemplate[] }>("/api/domain-templates");
  return data.templates;
}

export async function createDomain(template: string, name: string): Promise<DomainSummary> {
  const res = await send("/api/domains", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template, name }),
  });
  if (!res.ok) throw new Error(`POST /api/domains -> ${res.status}`);
  return (await res.json()) as DomainSummary;
}

export async function getDomain(domainId: string): Promise<DomainDetail> {
  return getJSON<DomainDetail>(`/api/domains/${domainId}`);
}

export async function updateDomain(
  domainId: string,
  body: { name?: string; config?: Record<string, unknown> },
): Promise<DomainDetail> {
  const res = await send(`/api/domains/${domainId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /api/domains/${domainId} -> ${res.status}`);
  return (await res.json()) as DomainDetail;
}

export async function deleteDomain(domainId: string): Promise<void> {
  const res = await send(`/api/domains/${domainId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/domains/${domainId} -> ${res.status}`);
}

export interface DomainDocumentSummary {
  document_id: string;
  domain_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  /** "pending" | "indexing" | "ready" | "error" (kept open for newer values). */
  ingest_status: string;
  error_message: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function listDomainDocuments(domainId: string): Promise<DomainDocumentSummary[]> {
  const data = await getJSON<{ documents: DomainDocumentSummary[] }>(
    `/api/domains/${domainId}/documents`,
  );
  return data.documents;
}

export async function uploadDomainDocument(
  domainId: string,
  file: File,
): Promise<DomainDocumentSummary> {
  const body = new FormData();
  body.append("file", file);
  const res = await send(`/api/domains/${domainId}/documents`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    let detail = `POST /api/domains/${domainId}/documents -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail && typeof j.detail === "object" && "message" in j.detail) {
        detail = String((j.detail as { message: string }).message);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as DomainDocumentSummary;
}

export async function deleteDomainDocument(domainId: string, documentId: string): Promise<void> {
  const res = await send(`/api/domains/${domainId}/documents/${documentId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new ApiError(res.status, `DELETE document -> ${res.status}`);
}

export async function ingestDomain(
  domainId: string,
): Promise<{ domain_id: string; workflow_id: string; status: string }> {
  const res = await send(`/api/domains/${domainId}/ingest`, { method: "POST" });
  if (!res.ok) {
    let detail = `POST ingest -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail && typeof j.detail === "object" && "message" in j.detail) {
        detail = String((j.detail as { message: string }).message);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as { domain_id: string; workflow_id: string; status: string };
}

export interface DomainCitation {
  document_id: string;
  filename: string;
  chunk_id: string;
  ordinal: number;
  excerpt: string;
  score?: number | null;
}

export interface DomainMessageSummary {
  message_id: string;
  domain_id: string;
  /** "user" | "assistant". */
  role: string;
  content: string;
  citations: DomainCitation[] | null;
  latency_ms: number | null;
  cost_usd: number | null;
  created_at: string | null;
}

export interface DomainAskResult {
  answer: string;
  citations: DomainCitation[];
  message_id: string;
  user_message_id: string;
  latency_ms: number | null;
  cost_usd?: number | null;
  model?: string;
}

export async function listDomainMessages(domainId: string): Promise<DomainMessageSummary[]> {
  const data = await getJSON<{ messages: DomainMessageSummary[] }>(
    `/api/domains/${domainId}/messages`,
  );
  return data.messages;
}

export async function askDomain(domainId: string, question: string): Promise<DomainAskResult> {
  const res = await send(`/api/domains/${domainId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!res.ok) {
    let detail = `POST /api/domains/${domainId}/ask -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
      else if (j.detail && typeof j.detail === "object" && "message" in j.detail) {
        detail = String((j.detail as { message: string }).message);
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as DomainAskResult;
}

export interface DomainEvalCase {
  case_id: string;
  domain_id: string;
  question: string;
  expected_answer: string | null;
  expected_citation_doc_ids: string[];
  expected_keywords: string[];
  ordinal: number;
  created_at: string | null;
}

export interface DomainEvalCaseCreate {
  question: string;
  expected_answer?: string | null;
  expected_citation_doc_ids?: string[];
  expected_keywords?: string[];
  ordinal?: number;
}

export interface DomainEvalPerCaseScore {
  case_id: string;
  question: string;
  hit: boolean | null;
  keyword_hit: boolean | null;
  citation_doc_ids: string[];
  latency_ms: number | null;
  error: string | null;
}

export interface DomainEvalScores {
  cases_total: number;
  cases_scored_hit: number;
  cases_scored_keyword: number;
  hit_at_k: number | null;
  keyword_hit: number | null;
  top_k: number;
  retrieval_mode: string;
  per_case: DomainEvalPerCaseScore[];
}

export interface DomainEvalRun {
  run_id: string;
  domain_id: string;
  status: string;
  scores: DomainEvalScores | null;
  error_message: string | null;
  created_at: string | null;
  completed_at: string | null;
}

export async function listDomainEvalCases(domainId: string): Promise<DomainEvalCase[]> {
  const data = await getJSON<{ cases: DomainEvalCase[] }>(`/api/domains/${domainId}/eval/cases`);
  return data.cases;
}

export async function createDomainEvalCase(
  domainId: string,
  body: DomainEvalCaseCreate,
): Promise<DomainEvalCase> {
  const res = await send(`/api/domains/${domainId}/eval/cases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST eval case -> ${res.status}`);
  return (await res.json()) as DomainEvalCase;
}

export async function deleteDomainEvalCase(domainId: string, caseId: string): Promise<void> {
  const res = await send(`/api/domains/${domainId}/eval/cases/${caseId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`DELETE eval case -> ${res.status}`);
}

export async function getLatestDomainEvalRun(domainId: string): Promise<DomainEvalRun> {
  return getJSON<DomainEvalRun>(`/api/domains/${domainId}/eval/runs/latest`);
}

export async function runDomainEval(domainId: string): Promise<DomainEvalRun> {
  const res = await send(`/api/domains/${domainId}/eval`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    let detail = `POST eval -> ${res.status}`;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return (await res.json()) as DomainEvalRun;
}
