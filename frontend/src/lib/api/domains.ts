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

/**
 * The re-read still running (G10; DmF-Embed-4, DmF-Piece-3): its files, how many are done, the
 * estimate, why (`reading_model` = a new reading model, asking is paused) and whether the tests run
 * when it's done.
 */
export interface DomainRereading {
  total: number;
  done: number;
  eta_seconds: number;
  reason: "reading_model" | "files";
  run_tests_after: boolean;
}

export interface DomainDetailView extends DomainListItem {
  setup: DomainSetup;
  answer_model: DomainAnswerModel;
  last_question_at: string | null;
  rereading: DomainRereading | null;
}

function normalizeRereading(raw: unknown): DomainRereading | null {
  const r = obj(raw);
  if (typeof r.total !== "number" || r.total < 1) return null;
  return {
    total: count(r.total),
    done: count(r.done),
    eta_seconds: count(r.eta_seconds),
    reason: r.reason === "reading_model" ? "reading_model" : "files",
    run_tests_after: r.run_tests_after === true,
  };
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
    rereading: normalizeRereading(r.rereading),
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
  | "uploading"
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

// ---- The ⋯ menus (G4): rename, duplicate, delete a domain, delete a file ----

const BACKEND_DOWN = "Couldn’t reach Tvashtr — is the backend running?";

/**
 * Rename (DM-14). A clash is a 409 and a bad name a 422, each carrying the copy to show under the
 * Name field (`ApiError.message`).
 */
export async function renameDomain(domainId: string, name: string): Promise<void> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
}

/** Duplicate settings (DM-16): an empty copy named "<name> copy" (or `name`), with its summary. */
export async function duplicateDomain(domainId: string, name?: string): Promise<DomainDetailView> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}/duplicate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(name === undefined ? {} : { name }),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const detail = normalizeDomainDetail((await res.json()) as unknown);
  if (!detail) throw new ApiError(500, BACKEND_DOWN);
  return detail;
}

/**
 * Delete a domain for good (DM-15): its files, pieces, chat and test questions go; steps that used
 * it lose it and agents' lists drop it (the counts say how many).
 */
export async function removeDomain(
  domainId: string,
): Promise<{ steps_cleared: number; agents_cleared: number }> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}`, { method: "DELETE" });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const out = obj((await res.json().catch(() => ({}))) as unknown);
  return { steps_cleared: count(out.steps_cleared), agents_cleared: count(out.agents_cleared) };
}

/**
 * Delete one file (DM-53). `keepalive` lets the request outlive the page — the deferred delete
 * (OQ-12) is sent that way when the user leaves before its Undo toast closes. A file that is
 * already gone (404) counts as deleted.
 */
export async function deleteDomainFile(
  domainId: string,
  documentId: string,
  { keepalive = false }: { keepalive?: boolean } = {},
): Promise<void> {
  const res = await send(
    `/api/domains/${encodeURIComponent(domainId)}/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE", keepalive },
  );
  if (!res.ok && res.status !== 404) {
    throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  }
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

/** The upload answer's `detail` (a string, or `{message}`), if any. */
function uploadDetail(body: unknown): string | null {
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : null;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object" && "message" in detail) {
    return String(detail.message);
  }
  return null;
}

/**
 * Upload one file with progress (DM-48): XHR, because `fetch` reports no upload progress.
 * `onProgress` gets 0–1; `abort()` cancels (the promise then rejects with an `AbortError`).
 */
export function uploadDomainFile(
  domainId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { done: Promise<DomainDocumentSummary>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<DomainDocumentSummary>((resolve, reject) => {
    xhr.open("POST", apiUrl(`/api/domains/${domainId}/documents`));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 502 && xhr.status <= 504) reportFetchFailed();
      else reportFetchOk();
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      const doc = body as DomainDocumentSummary | null;
      if (xhr.status >= 200 && xhr.status < 300 && typeof doc?.document_id === "string") {
        resolve(doc);
      } else {
        reject(
          new ApiError(xhr.status, uploadDetail(body) ?? `The upload failed (${xhr.status}).`),
        );
      }
    };
    xhr.onerror = () => {
      reportFetchFailed();
      reject(new Error("The upload failed. Is the backend running?"));
    };
    xhr.onabort = () => reject(new DOMException("The upload was cancelled.", "AbortError"));
    const body = new FormData();
    body.append("file", file);
    xhr.send(body);
  });
  return { done, abort: () => xhr.abort() };
}

export interface DomainCitation {
  document_id: string;
  filename: string;
  chunk_id: string;
  ordinal: number;
  excerpt: string;
  score?: number | null;
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

export async function listDomainEvalCases(domainId: string): Promise<DomainEvalCase[]> {
  const data = await getJSON<{ cases: DomainEvalCase[] }>(`/api/domains/${domainId}/eval/cases`);
  return data.cases;
}

// ---- The Ask tab (G6): the chat, asking, Clear chat, the answer model ----

/** One passage an answer used or search found (DM-60): `number` is its chip. */
export interface DomainPassage {
  number: number;
  document_id: string;
  filename: string;
  piece_number: number;
  pieces_in_file: number | null;
  page: number | null;
  excerpt: string;
}

/** An answer as the Ask tab shows it (contract: "POST /api/domains/{id}/ask (G6 additions)"). */
export interface DomainAnswer {
  message_id: string | null;
  covered: boolean;
  /** Markers renumbered to `sources`' numbers, NOT_FOUND stripped. */
  answer_text: string;
  sources: DomainPassage[];
  /** Every passage search found, in rank order (numbered 1…k). */
  searched: DomainPassage[];
  used_history: boolean | null;
  model_label: string | null;
  latency_ms: number | null;
}

/** A question and its answer (`null` while it's being asked or when the chat lost it). */
export interface DomainChatTurn {
  question: string;
  answer: DomainAnswer | null;
}

function passages(raw: unknown, numbered: boolean): DomainPassage[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item, i): DomainPassage[] => {
    const p = obj(item);
    if (typeof p.filename !== "string" || typeof p.excerpt !== "string") return [];
    return [
      {
        number: numbered && typeof p.number === "number" ? p.number : i + 1,
        document_id: typeof p.document_id === "string" ? p.document_id : "",
        filename: p.filename,
        piece_number: typeof p.piece_number === "number" ? p.piece_number : count(p.ordinal) + 1,
        pieces_in_file: numOrNull(p.pieces_in_file),
        page: numOrNull(p.page),
        excerpt: p.excerpt,
      },
    ];
  });
}

/** Validate one answer (an ask's result or an assistant message); `null` when it isn't one. */
export function normalizeDomainAnswer(raw: unknown): DomainAnswer | null {
  const r = obj(raw);
  const text =
    typeof r.answer_text === "string"
      ? r.answer_text
      : typeof r.answer === "string"
        ? r.answer
        : typeof r.content === "string"
          ? r.content
          : null;
  if (text === null) return null;
  const searched = passages(r.searched ?? r.citations, false);
  return {
    message_id: strOrNull(r.message_id),
    covered: r.covered !== false,
    answer_text: text,
    sources: Array.isArray(r.sources) ? passages(r.sources, true) : searched.slice(0, 2),
    searched,
    used_history: typeof r.used_history === "boolean" ? r.used_history : null,
    model_label: strOrNull(r.model_label),
    latency_ms: numOrNull(r.latency_ms),
  };
}

/** The chat, oldest first, as question/answer turns. */
export async function listDomainChat(domainId: string): Promise<DomainChatTurn[]> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}/messages`);
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const rows = obj((await res.json()) as unknown).messages;
  const turns: DomainChatTurn[] = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const m = obj(raw);
    if (m.role === "user" && typeof m.content === "string") {
      turns.push({ question: m.content, answer: null });
    } else if (m.role === "assistant" && turns.length && !turns[turns.length - 1].answer) {
      turns[turns.length - 1].answer = normalizeDomainAnswer(raw);
    }
  }
  return turns;
}

/**
 * Why an ask failed: the status, the server's words and the providers it needs a key for. (Not an
 * `ApiError` subclass: `lib/api.ts` re-exports this module, so its classes aren't ready here yet.)
 */
export class AskError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly missingProviders: string[] = [],
  ) {
    super(message);
    this.name = "AskError";
  }
}

/** Ask (DM-57): `useHistory` = "Use earlier messages". Throws `AskError`. */
export async function askDomainQuestion(
  domainId: string,
  question: string,
  useHistory: boolean,
): Promise<DomainAnswer> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, use_history: useHistory }),
  });
  if (!res.ok) {
    const detail = obj(await res.json().catch(() => ({}))).detail;
    const d = obj(detail);
    const missing = Array.isArray(d.missing_providers)
      ? d.missing_providers.filter((p): p is string => typeof p === "string")
      : [];
    const message =
      typeof detail === "string" ? detail : typeof d.message === "string" ? d.message : "";
    throw new AskError(res.status, message, missing);
  }
  const answer = normalizeDomainAnswer((await res.json()) as unknown);
  if (!answer) throw new AskError(500, "");
  return answer;
}

/** Clear chat (DM-67): `keepalive` when the page is going away. 404 = nothing left to clear. */
export async function clearDomainChat(
  domainId: string,
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}/messages`, {
    method: "DELETE",
    keepalive: opts.keepalive,
  });
  if (!res.ok && res.status !== 404) {
    throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  }
}

/**
 * The domain's answer model (DM-64; the same setting as Settings › Answer model): `null` = the
 * account default. The domain's other settings are sent back unchanged.
 */
export async function setDomainAnswerModel(
  domainId: string,
  config: Record<string, unknown>,
  model: string | null,
): Promise<void> {
  const generation = { ...obj(config.generation), model };
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { ...config, generation } }),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
}

/**
 * Save the Settings tab (DM-80…DM-85): the whole config, plus the starting point when it changed.
 * A 4xx answer's `detail` is the tab's own copy ("Use a number from 1 to 30.").
 */
export async function saveDomainSettings(
  domainId: string,
  body: { template?: string; config: Record<string, unknown> },
): Promise<{ reread: "none" | "required" | "optional" }> {
  const res = await send(`/api/domains/${encodeURIComponent(domainId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  // `required`: a reading model with other weights — the server already started re-reading.
  const needed = obj(obj((await res.json().catch(() => ({}))) as unknown).reread).needed;
  return { reread: needed === "required" || needed === "optional" ? needed : "none" };
}

// ---- The Quality tab (G7): test questions and test runs ----

/** An expected file of a test question; a deleted file keeps its id (`exists: false`, DM-54). */
export interface DomainTestFile {
  document_id: string;
  filename: string | null;
  exists: boolean;
}

export interface DomainTestCase {
  case_id: string;
  question: string;
  expected_files: DomainTestFile[];
  expected_keywords: string[];
  ordinal: number;
}

/** One of the first passages search found for a test question (DM-77). */
export interface DomainTestPassage {
  number: number;
  document_id: string;
  filename: string;
  excerpt: string;
}

/** One test question's result: `null` = nothing to check (no files / no key words). */
export interface DomainTestResult {
  case_id: string;
  hit: boolean | null;
  keyword_hit: boolean | null;
  top: DomainTestPassage[];
  error: string | null;
}

export type DomainTestRunStatus = "running" | "completed" | "failed";

export interface DomainTestRun {
  run_id: string;
  /** 1 = the domain's first run. */
  number: number;
  status: DomainTestRunStatus;
  created_at: string;
  completed_at: string | null;
  hit_at_k: number | null;
  keyword_hit: number | null;
  retrieval_mode: string | null;
  top_k: number | null;
  /** The settings the run used (chunking, embedding, retrieval, generation). */
  config: Record<string, unknown>;
  progress: { done: number; total: number };
  error_message: string | null;
  /** Every case's result — only from `getTestRun`. */
  results: DomainTestResult[] | null;
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const bool3 = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function normalizeTestCase(raw: unknown): DomainTestCase | null {
  const r = obj(raw);
  if (typeof r.case_id !== "string" || typeof r.question !== "string") return null;
  const files: Record<string, unknown>[] = Array.isArray(r.expected_files)
    ? r.expected_files.map(obj).filter((f) => typeof f.document_id === "string")
    : strs(r.expected_citation_doc_ids).map((id) => ({ document_id: id }));
  return {
    case_id: r.case_id,
    question: r.question,
    expected_files: files.map((f) => ({
      document_id: f.document_id as string,
      filename: strOrNull(f.filename),
      exists: f.exists !== false && typeof f.filename === "string",
    })),
    expected_keywords: strs(r.expected_keywords),
    ordinal: count(r.ordinal),
  };
}

export function normalizeTestRun(raw: unknown): DomainTestRun | null {
  const r = obj(raw);
  if (typeof r.run_id !== "string") return null;
  const status: DomainTestRunStatus =
    r.status === "running" || r.status === "failed" ? r.status : "completed";
  const p = obj(r.progress);
  const perCase = obj(r.scores).per_case;
  return {
    run_id: r.run_id,
    number: count(r.number),
    status,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    completed_at: strOrNull(r.completed_at),
    hit_at_k: numOrNull(r.hit_at_k),
    keyword_hit: numOrNull(r.keyword_hit),
    retrieval_mode: strOrNull(r.retrieval_mode),
    top_k: numOrNull(r.top_k),
    config: obj(r.config),
    progress: { done: count(p.done), total: count(p.total) },
    error_message: strOrNull(r.error_message),
    results: Array.isArray(perCase)
      ? perCase.map(obj).flatMap((c) =>
          typeof c.case_id === "string"
            ? [
                {
                  case_id: c.case_id,
                  hit: bool3(c.hit),
                  keyword_hit: bool3(c.keyword_hit),
                  error: strOrNull(c.error),
                  top: (Array.isArray(c.top) ? c.top : []).map(obj).map((t, i) => ({
                    number: count(t.number) || i + 1,
                    document_id: typeof t.document_id === "string" ? t.document_id : "",
                    filename: typeof t.filename === "string" ? t.filename : "",
                    excerpt: typeof t.excerpt === "string" ? t.excerpt : "",
                  })),
                },
              ]
            : [],
        )
      : null,
  };
}

const evalPath = (domainId: string, rest = "") =>
  `/api/domains/${encodeURIComponent(domainId)}/eval${rest}`;

export async function listTestCases(domainId: string): Promise<DomainTestCase[]> {
  const res = await send(evalPath(domainId, "/cases"));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const rows = obj((await res.json()) as unknown).cases;
  return (Array.isArray(rows) ? rows : []).flatMap((c) => normalizeTestCase(c) ?? []);
}

/** Add a test question, or change one (`caseId`). A 422 carries the Quality copy. */
export async function saveTestCase(
  domainId: string,
  body: { question: string; expected_citation_doc_ids: string[]; expected_keywords: string[] },
  caseId?: string,
): Promise<DomainTestCase> {
  const res = await send(evalPath(domainId, caseId ? `/cases/${caseId}` : "/cases"), {
    method: caseId ? "PATCH" : "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const saved = normalizeTestCase((await res.json()) as unknown);
  if (!saved) throw new ApiError(500, BACKEND_DOWN);
  return saved;
}

/** Delete a test question; `keepalive` when the page is going away. 404 = already gone. */
export async function deleteTestCase(
  domainId: string,
  caseId: string,
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  const res = await send(evalPath(domainId, `/cases/${caseId}`), {
    method: "DELETE",
    keepalive: opts.keepalive,
  });
  if (!res.ok && res.status !== 404) {
    throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  }
}

/** The domain's test runs, newest first (without their per-case results). */
export async function listTestRuns(domainId: string): Promise<DomainTestRun[]> {
  const res = await send(evalPath(domainId, "/runs?limit=20"));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const rows = obj((await res.json()) as unknown).runs;
  return (Array.isArray(rows) ? rows : []).flatMap((r) => normalizeTestRun(r) ?? []);
}

/** One run with every case's result and the passages search found. */
export async function getTestRun(domainId: string, runId: string): Promise<DomainTestRun> {
  const res = await send(evalPath(domainId, `/runs/${runId}`));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const run = normalizeTestRun((await res.json()) as unknown);
  if (!run) throw new ApiError(500, BACKEND_DOWN);
  return run;
}

/** Run all tests (DM-74): the running run (or the one already going). */
export async function startTestRun(domainId: string): Promise<DomainTestRun> {
  const res = await send(evalPath(domainId, "/runs"), { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const run = normalizeTestRun((await res.json()) as unknown);
  if (!run) throw new ApiError(500, BACKEND_DOWN);
  return run;
}

// ---- Use in teams (G11: DM-92…97) ----

/** A Query domain step that asks this domain. */
export interface DomainStep {
  node_id: string;
  team_id: string;
  team_name: string;
  title: string;
  pass_to_spec: boolean;
}

/** An agent and how it reaches this domain: `"this"`, `"all"` (the legacy switch) or `null`. */
export interface DomainAgent {
  node_id: string;
  team_id: string;
  team_name: string;
  role_name: string;
  title: string;
  model: string | null;
  scope: "this" | "all" | null;
  /** A connected Desktop plan (`claude`/`grok`) that runs this agent without Domains tools. */
  subscription: string | null;
}

export interface DomainUsageDetail {
  steps: DomainStep[];
  agents: DomainAgent[];
}

/** One "After <agent>" place for a new step (OQ-20). */
export interface StepPlace {
  after_node_id: string;
  after: string;
  next: string | null;
}

export interface StepTeam {
  team_id: string;
  name: string;
  /** The agents and steps on the main path ("Product manager → Writer → Reviewer"). */
  path: string[];
  places: StepPlace[];
}

export interface AddedStep {
  node_id: string;
  team_id: string;
  title: string;
  after: { node_id: string; title: string };
  connected_to: { node_id: string; title: string } | null;
}

const rows = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function normalizeDomainStep(raw: unknown): DomainStep | null {
  const r = obj(raw);
  if (!str(r.node_id) || !str(r.team_id)) return null;
  return {
    node_id: str(r.node_id),
    team_id: str(r.team_id),
    team_name: str(r.team_name),
    title: str(r.title) || "Query domain",
    pass_to_spec: r.pass_to_spec === true,
  };
}

export function normalizeDomainAgent(raw: unknown): DomainAgent | null {
  const r = obj(raw);
  if (!str(r.node_id) || !str(r.team_id)) return null;
  return {
    node_id: str(r.node_id),
    team_id: str(r.team_id),
    team_name: str(r.team_name),
    role_name: str(r.role_name),
    title: str(r.title) || str(r.role_name) || "Agent",
    model: strOrNull(r.model),
    scope: r.scope === "this" || r.scope === "all" ? r.scope : null,
    subscription: strOrNull(r.subscription),
  };
}

function agentsOf(raw: unknown): DomainAgent[] {
  return rows(obj(raw).agents).flatMap((a) => normalizeDomainAgent(a) ?? []);
}

const domainPath = (domainId: string, rest: string) =>
  `/api/domains/${encodeURIComponent(domainId)}${rest}`;

/** Where the domain is used: its steps and the agents that can search it. */
export async function getDomainUsage(domainId: string): Promise<DomainUsageDetail> {
  const res = await send(domainPath(domainId, "/usage"));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const body = (await res.json()) as unknown;
  return {
    steps: rows(obj(body).steps).flatMap((s) => normalizeDomainStep(s) ?? []),
    agents: agentsOf(body),
  };
}

/** The Add step dialog's teams with their paths and places. */
export async function getStepPlaces(domainId: string): Promise<StepTeam[]> {
  const res = await send(domainPath(domainId, "/step-places"));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  return rows(obj((await res.json()) as unknown).teams).flatMap((raw) => {
    const t = obj(raw);
    if (!str(t.team_id)) return [];
    const places = rows(t.places).flatMap((p) => {
      const q = obj(p);
      return str(q.after_node_id)
        ? [{ after_node_id: str(q.after_node_id), after: str(q.after), next: strOrNull(q.next) }]
        : [];
    });
    return [{ team_id: str(t.team_id), name: str(t.name), path: rows(t.path).map(str), places }];
  });
}

/** Add the domain to a team as a Query domain step (DM-94). A 422 carries the dialog's copy. */
export async function addDomainStep(
  domainId: string,
  body: { team_id: string; after_node_id: string; prompt: string; pass_to_spec: boolean },
): Promise<AddedStep> {
  const res = await send(domainPath(domainId, "/steps"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  const r = obj((await res.json()) as unknown);
  const after = obj(r.after);
  const next = obj(r.connected_to);
  if (!str(r.node_id)) throw new ApiError(500, BACKEND_DOWN);
  return {
    node_id: str(r.node_id),
    team_id: str(r.team_id) || body.team_id,
    title: str(r.title),
    after: { node_id: str(after.node_id), title: str(after.title) },
    connected_to: str(next.node_id) ? { node_id: str(next.node_id), title: str(next.title) } : null,
  };
}

/** Every agent of the account's teams and whether it can search the domain. */
export async function listDomainAgents(domainId: string): Promise<DomainAgent[]> {
  const res = await send(domainPath(domainId, "/agents"));
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  return agentsOf((await res.json()) as unknown);
}

/** Exactly `nodeIds` can search the domain afterwards (DM-96); the agents with access. */
export async function setDomainAgents(domainId: string, nodeIds: string[]): Promise<DomainAgent[]> {
  const res = await send(domainPath(domainId, "/agents"), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ node_ids: nodeIds }),
  });
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, BACKEND_DOWN));
  return agentsOf((await res.json()) as unknown);
}
