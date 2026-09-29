/**
 * Documents API (B-DOCS, docs/superpowers/plans/api/docs.md): a run's documents with their latest
 * version, writers and readers; one document with every version; a human save on a live run; and
 * the team's runs for the run pickers. Every answer is shape-checked here, so one unexpected answer
 * never blanks the Documents drawer, the Docs tab or the viewer.
 */
import { ApiError } from "../api";
import { ApiDetailError, apiRequest } from "./runs";

// ---- Types -----------------------------------------------------------------------------------

/** Who wrote a version: an agent of the team (by its authored node) or you. */
export interface DocAuthor {
  kind: "agent" | "human";
  /** The authored node (null for a human, or an agent that can't be resolved). */
  node_id: string | null;
  role_name: string | null;
  label: string;
}

/** An agent that writes or reads a document. */
export interface RunDocAgent {
  /** The authored node's id (the team canvas). */
  node_id: string;
  /** The node in the run's snapshot graph (the run view's canvas). */
  clone_node_id: string;
  role_name: string;
  label: string;
}

export interface RunDocVersion {
  version_no: number;
  created_at: string;
  author: DocAuthor | null;
  note: string | null;
}

export interface RunDoc {
  id: string;
  name: string;
  title: string;
  doc_type: string;
  is_shared_spec: boolean;
  version_count: number;
  latest_version: RunDocVersion | null;
  written_by: RunDocAgent[];
  read_by: RunDocAgent[];
}

export interface DocRun {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  /** Pending, running or waiting on you: edits still reach its agents. */
  live: boolean;
}

export interface RunDocs {
  run: DocRun | null;
  documents: RunDoc[];
}

export interface DocVersion extends RunDocVersion {
  id: string;
  content: string;
}

export interface DocDetail {
  id: string;
  name: string;
  title: string;
  doc_type: string;
  run_id: string | null;
  is_shared_spec: boolean;
  /** The server takes a new version now (the run is live). */
  editable: boolean;
  /** Oldest first. */
  versions: DocVersion[];
}

/** One of the team's runs (newest first), for the run pickers. */
export interface TeamRun {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  updated_at: string | null;
}

// ---- Shape checks ----------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : []);

function toAuthor(v: unknown): DocAuthor | null {
  if (!isObj(v) || typeof v.label !== "string") return null;
  return {
    kind: v.kind === "human" ? "human" : "agent",
    node_id: strOrNull(v.node_id),
    role_name: strOrNull(v.role_name),
    label: v.label,
  };
}

const toAgents = (v: unknown): RunDocAgent[] =>
  rows(v)
    .map((a) => ({
      node_id: str(a.node_id),
      clone_node_id: str(a.clone_node_id),
      role_name: str(a.role_name),
      label: str(a.label),
    }))
    .filter((a) => a.node_id !== "");

const toVersion = (v: Obj): RunDocVersion => ({
  version_no: num(v.version_no),
  created_at: str(v.created_at),
  author: toAuthor(v.author),
  note: strOrNull(v.note),
});

function toRun(v: unknown): DocRun | null {
  if (!isObj(v) || typeof v.run_id !== "string") return null;
  return {
    run_id: v.run_id,
    idea: str(v.idea),
    status: str(v.status),
    created_at: str(v.created_at),
    live: v.live === true,
  };
}

// ---- Calls -----------------------------------------------------------------------------------

/** GET /api/runs/{id}/documents — the run and its documents (oldest first). */
export async function listRunDocs(runId: string): Promise<RunDocs> {
  const body = await apiRequest<unknown>("GET", `/api/runs/${encodeURIComponent(runId)}/documents`);
  if (!isObj(body)) return { run: null, documents: [] };
  return {
    run: toRun(body.run),
    documents: rows(body.documents).flatMap((d) => {
      const id = str(d.id);
      if (!id) return [];
      const latest = isObj(d.latest_version) ? toVersion(d.latest_version) : null;
      return [
        {
          id,
          name: str(d.name),
          title: str(d.title),
          doc_type: str(d.doc_type),
          is_shared_spec: d.is_shared_spec === true,
          version_count: num(d.version_count, latest ? latest.version_no : 0),
          latest_version: latest,
          written_by: toAgents(d.written_by),
          read_by: toAgents(d.read_by),
        },
      ];
    }),
  };
}

/** GET /api/documents/{id} — the document with every version (oldest first). */
export async function getDocument(documentId: string): Promise<DocDetail> {
  const body = await apiRequest<unknown>("GET", `/api/documents/${encodeURIComponent(documentId)}`);
  if (!isObj(body) || typeof body.id !== "string")
    throw new Error("Unexpected answer from /api/documents");
  return {
    id: body.id,
    name: str(body.name),
    title: str(body.title),
    doc_type: str(body.doc_type),
    run_id: strOrNull(body.run_id),
    is_shared_spec: body.is_shared_spec === true,
    editable: body.editable === true,
    versions: rows(body.versions)
      .map((v) => ({ ...toVersion(v), id: str(v.id), content: str(v.content) }))
      .sort((a, b) => a.version_no - b.version_no),
  };
}

/** Why a document save failed, so the viewer can say it plainly. */
export type DocSaveErrorKind = "stale_version" | "run_finished" | "not_found" | "other";

export class DocSaveError extends ApiError {
  constructor(
    status: number,
    message: string,
    public readonly kind: DocSaveErrorKind,
    /** stale_version: the newest version and who wrote it. */
    public readonly latestVersionNo: number | null = null,
    public readonly latestAuthor: DocAuthor | null = null,
  ) {
    super(status, message);
    this.name = "DocSaveError";
  }
}

/**
 * POST /api/documents/{id}/versions — save your edit as the next version. `baseVersionNo` is the
 * version the editor opened on: when someone saved a newer one meanwhile the server refuses (409
 * `stale_version`); a finished run refuses too (409 `run_finished`). Both throw a `DocSaveError`
 * carrying the server's own sentence.
 */
export async function addDocumentVersion(
  documentId: string,
  content: string,
  { baseVersionNo, note }: { baseVersionNo?: number; note?: string } = {},
): Promise<DocVersion> {
  let body: unknown;
  try {
    body = await apiRequest<unknown>(
      "POST",
      `/api/documents/${encodeURIComponent(documentId)}/versions`,
      {
        content,
        ...(baseVersionNo !== undefined && { base_version_no: baseVersionNo }),
        ...(note !== undefined && { note }),
      },
    );
  } catch (err) {
    if (!(err instanceof ApiDetailError)) throw err;
    const detail = isObj(err.detail) ? err.detail : {};
    const code = detail.code;
    const kind: DocSaveErrorKind =
      err.status === 409 && (code === "stale_version" || code === "run_finished")
        ? code
        : err.status === 404
          ? "not_found"
          : "other";
    throw new DocSaveError(
      err.status,
      err.message,
      kind,
      kind === "stale_version" ? num(detail.latest_version_no) || null : null,
      kind === "stale_version" ? toAuthor(detail.latest_author) : null,
    );
  }
  if (!isObj(body)) throw new Error("Unexpected answer from /api/documents");
  return { ...toVersion(body), id: str(body.id), content: str(body.content, content) };
}

/** GET /api/teams/{id}/runs — the team's runs, newest first (the run pickers). */
export async function listTeamRuns(teamId: string): Promise<TeamRun[]> {
  const body = await apiRequest<unknown>("GET", `/api/teams/${encodeURIComponent(teamId)}/runs`);
  return rows(isObj(body) ? body.runs : null).flatMap((r) =>
    typeof r.run_id === "string" && r.run_id
      ? [
          {
            run_id: r.run_id,
            idea: str(r.idea),
            status: str(r.status),
            created_at: str(r.created_at),
            updated_at: strOrNull(r.updated_at),
          },
        ]
      : [],
  );
}
