/**
 * Toolkit › Memory (B-MEMORY contract, `docs/superpowers/plans/api/memory.md`): the account's
 * memories by status (Inbox = `pending_review`, Active, Archive = `superseded` + `rejected`), the tab
 * counts, the review-before-apply switch, Keep / Discard / Undo (`/requeue`), edits with a scope
 * change, pin / unpin / delete / create, and the repos a memory can be scoped to.
 *
 * Every answer is shape-checked here, at the boundary: a list answer in another shape is a failed
 * load (the page shows its error state), and a single malformed row is dropped rather than blanking
 * the whole list. Errors come back as `ApiDetailError` (status + the backend's own message).
 */
import type { MemoryPolarity, MemoryTier } from "../api";
import { ApiDetailError, apiRequest } from "./runs";

export type { MemoryPolarity, MemoryTier } from "../api";

export type MemoryStatus = "active" | "pending_review" | "superseded" | "rejected";

/** The agent a node-tier memory is scoped to. `role_name: null` = the agent was removed. */
export interface MemoryAgent {
  node_id: string;
  role_name: string | null;
  title: string | null;
  team_id: string | null;
  team_name: string | null;
}

/** Where a memory came from: a run (with its title, status and round) or a person. */
export interface MemorySource {
  kind: "run" | "manual";
  run_id: string | null;
  run_title: string | null;
  run_status: string | null;
  run_succeeded: boolean | null;
  round: number | null;
  agent_role: string | null;
  team_name: string | null;
  node_id: string | null;
}

export type SupersededReason = "merged" | "replaced";

export interface Memory {
  id: string;
  content: string;
  polarity: MemoryPolarity;
  repo_key: string | null;
  repo_label: string | null;
  node_id: string | null;
  tier: MemoryTier;
  pinned: boolean;
  status: MemoryStatus;
  confirmation_count: number;
  source_run_id: string | null;
  source_node_id: string | null;
  superseded_by: string | null;
  /**
   * How a superseded memory was retired: folded into a memory you already had ("merged"), or
   * replaced by one that says the opposite ("replaced"); null otherwise or when unknown.
   */
  superseded_reason: SupersededReason | null;
  valid_from: string | null;
  invalid_at: string | null;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  agent: MemoryAgent | null;
  source: MemorySource;
}

export interface MemoryCounts {
  inbox: number;
  active: number;
  archive: number;
}

export type PromoteAction = "promote" | "promote_merged" | "promote_supersede";

/** Keep's answer. For a merge `memory` is the EXISTING memory and Undo must requeue `mergedId`. */
export interface PromoteResult {
  memory: Memory;
  action: PromoteAction;
  mergedId: string | null;
  superseded: string | null;
}

export interface RequeueResult {
  memory: Memory;
  action: "requeue" | "already_pending";
  restored: string[];
  unmergedFrom: string | null;
}

export type MemoryScope = "account" | "repo" | "agent";

export interface MemoryPatch {
  content?: string;
  polarity?: MemoryPolarity;
  pinned?: boolean;
  scope?: MemoryScope;
  /** Only read together with `scope`. */
  repo_key?: string | null;
}

export interface NewMemory {
  content: string;
  polarity: MemoryPolarity;
  repo_key?: string | null;
  node_id?: string | null;
}

export interface MemoryRepo {
  repo_key: string;
  label: string;
  memory_count: number;
  pending_count: number;
  last_run_at: string | null;
}

// ---- shape checks ----

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): string | null => (str(v) ? v : null);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const POLARITIES: readonly string[] = ["require", "prefer", "allow", "context", "avoid", "forbid"];
const STATUSES: readonly string[] = ["active", "pending_review", "superseded", "rejected"];
const TIERS: readonly string[] = ["account", "repo", "node"];

function parseAgent(raw: unknown): MemoryAgent | null {
  if (!isObj(raw) || !str(raw.node_id)) return null;
  return {
    node_id: raw.node_id,
    role_name: strOrNull(raw.role_name),
    title: strOrNull(raw.title),
    team_id: strOrNull(raw.team_id),
    team_name: strOrNull(raw.team_name),
  };
}

function parseSource(raw: unknown, sourceRunId: string | null): MemorySource {
  const src = isObj(raw) ? raw : {};
  const kind =
    src.kind === "run" || src.kind === "manual" ? src.kind : sourceRunId ? "run" : "manual";
  return {
    kind,
    run_id: strOrNull(src.run_id) ?? (kind === "run" ? sourceRunId : null),
    run_title: strOrNull(src.run_title),
    run_status: strOrNull(src.run_status),
    run_succeeded: typeof src.run_succeeded === "boolean" ? src.run_succeeded : null,
    round: num(src.round) ? src.round : null,
    agent_role: strOrNull(src.agent_role),
    team_name: strOrNull(src.team_name),
    node_id: strOrNull(src.node_id),
  };
}

/** One memory row, or null when it isn't one (a newer server's unknown polarity, say). */
export function parseMemory(raw: unknown): Memory | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.content)) return null;
  if (!str(raw.polarity) || !POLARITIES.includes(raw.polarity)) return null;
  if (!str(raw.status) || !STATUSES.includes(raw.status)) return null;
  const repoKey = strOrNull(raw.repo_key);
  const nodeId = strOrNull(raw.node_id);
  const tier: MemoryTier =
    str(raw.tier) && TIERS.includes(raw.tier)
      ? (raw.tier as MemoryTier)
      : nodeId
        ? "node"
        : repoKey
          ? "repo"
          : "account";
  const created = str(raw.created_at) ? raw.created_at : "";
  const sourceRunId = strOrNull(raw.source_run_id);
  return {
    id: raw.id,
    content: raw.content,
    polarity: raw.polarity as MemoryPolarity,
    repo_key: repoKey,
    repo_label: strOrNull(raw.repo_label) ?? repoKey,
    node_id: nodeId,
    tier,
    pinned: raw.pinned === true,
    status: raw.status as MemoryStatus,
    confirmation_count: num(raw.confirmation_count) ? raw.confirmation_count : 1,
    source_run_id: sourceRunId,
    source_node_id: strOrNull(raw.source_node_id),
    superseded_by: strOrNull(raw.superseded_by),
    superseded_reason:
      raw.superseded_reason === "merged" || raw.superseded_reason === "replaced"
        ? raw.superseded_reason
        : null,
    valid_from: strOrNull(raw.valid_from),
    invalid_at: strOrNull(raw.invalid_at),
    edited_at: strOrNull(raw.edited_at),
    created_at: created,
    updated_at: str(raw.updated_at) ? raw.updated_at : created,
    agent: parseAgent(raw.agent),
    source: parseSource(raw.source, sourceRunId),
  };
}

function expectMemory(body: unknown, what: string): Memory {
  const m = parseMemory(body);
  if (!m) throw new Error(`Unexpected answer from ${what}`);
  return m;
}

const enc = encodeURIComponent;
const count = (v: unknown): number => (num(v) && v >= 0 ? v : 0);

// ---- lists and counts ----

/** GET /api/memories?status=… — one status's memories (oldest first; the page sorts). */
export async function listMemories(status: MemoryStatus): Promise<Memory[]> {
  const body = await apiRequest<unknown>("GET", `/api/memories?status=${enc(status)}`);
  if (!isObj(body) || !Array.isArray(body.memories))
    throw new Error("Unexpected answer from /api/memories");
  return body.memories.map(parseMemory).filter((m): m is Memory => m !== null);
}

/** GET /api/memories/counts — the tab counts; `inbox` is also the nav badge ("2 new"). */
export async function getMemoryCounts(): Promise<MemoryCounts> {
  const body = await apiRequest<unknown>("GET", "/api/memories/counts");
  if (!isObj(body) || !num(body.inbox) || !num(body.active))
    throw new Error("Unexpected answer from /api/memories/counts");
  return { inbox: count(body.inbox), active: count(body.active), archive: count(body.archive) };
}

// ---- review before apply ----

/** GET /api/memory/review-mode — true: every new memory waits in the Inbox. */
export async function getReviewMode(): Promise<boolean> {
  const body = await apiRequest<unknown>("GET", "/api/memory/review-mode");
  if (!isObj(body) || typeof body.review_mode !== "boolean")
    throw new Error("Unexpected answer from /api/memory/review-mode");
  return body.review_mode;
}

/** PATCH /api/memory/review-mode — answers the value it stored. */
export async function setReviewMode(on: boolean): Promise<boolean> {
  const body = await apiRequest<unknown>("PATCH", "/api/memory/review-mode", {
    review_mode: on,
  });
  return isObj(body) && typeof body.review_mode === "boolean" ? body.review_mode : on;
}

// ---- Inbox: Keep / Discard / Undo ----

/** POST /api/memories/{id}/promote — Keep (or Restore a discarded one). */
export async function promoteMemory(id: string): Promise<PromoteResult> {
  const body = await apiRequest<unknown>("POST", `/api/memories/${enc(id)}/promote`);
  const memory = expectMemory(body, "POST /api/memories/{id}/promote");
  const b = body as Obj;
  const action: PromoteAction =
    b.action === "promote_merged" || b.action === "promote_supersede" ? b.action : "promote";
  return {
    memory,
    action,
    mergedId: action === "promote_merged" ? (strOrNull(b.merged_id) ?? id) : null,
    superseded: strOrNull(b.superseded),
  };
}

/** POST /api/memories/{id}/reject — Discard: a tombstone that lands in Archive. */
export async function rejectMemory(id: string): Promise<Memory> {
  const body = await apiRequest<unknown>("POST", `/api/memories/${enc(id)}/reject`);
  return expectMemory(body, "POST /api/memories/{id}/reject");
}

/** POST /api/memories/{id}/requeue — the Undo of Keep and Discard: back to the Inbox. */
export async function requeueMemory(id: string): Promise<RequeueResult> {
  const body = await apiRequest<unknown>("POST", `/api/memories/${enc(id)}/requeue`);
  const memory = expectMemory(body, "POST /api/memories/{id}/requeue");
  const b = body as Obj;
  return {
    memory,
    action: b.action === "already_pending" ? "already_pending" : "requeue",
    restored: Array.isArray(b.restored) ? b.restored.filter(str) : [],
    unmergedFrom: strOrNull(b.unmerged_from),
  };
}

// ---- edit / pin / delete / create ----

/** PATCH /api/memories/{id} — text, force, pin and/or scope (422 when a scope can't resolve). */
export async function updateMemory(id: string, patch: MemoryPatch): Promise<Memory> {
  const body = await apiRequest<unknown>("PATCH", `/api/memories/${enc(id)}`, patch);
  return expectMemory(body, "PATCH /api/memories/{id}");
}

export async function pinMemory(id: string): Promise<Memory> {
  const body = await apiRequest<unknown>("POST", `/api/memories/${enc(id)}/pin`);
  return expectMemory(body, "POST /api/memories/{id}/pin");
}

export async function unpinMemory(id: string): Promise<Memory> {
  const body = await apiRequest<unknown>("POST", `/api/memories/${enc(id)}/unpin`);
  return expectMemory(body, "POST /api/memories/{id}/unpin");
}

/** DELETE /api/memories/{id} — a hard delete (204). */
export async function deleteMemory(id: string): Promise<void> {
  await apiRequest<null>("DELETE", `/api/memories/${enc(id)}`);
}

/** POST /api/memories — a memory you add applies right away (it skips the Inbox). */
/** The backend's 502 when a create or a text edit couldn't embed: the app answered, only the
 *  embedding service behind it didn't. `apiRequest` has already marked the backend unreachable on
 *  the 502, so a caller that says so also calls `reportFetchOk()`. */
export const EMBEDDING_FAILED = "the embedding call failed";
export const isEmbeddingFailure = (e: unknown): boolean =>
  e instanceof ApiDetailError && e.status === 502 && e.detail === EMBEDDING_FAILED;

export async function createMemory(input: NewMemory): Promise<Memory> {
  const body = await apiRequest<unknown>("POST", "/api/memories", input);
  return expectMemory(body, "POST /api/memories");
}

// ---- repos ----

/** GET /api/memory/repos — the repos a memory can be scoped to (sorted by label). */
export async function listMemoryRepos(
  opts: { includeGithub?: boolean } = {},
): Promise<MemoryRepo[]> {
  const q = opts.includeGithub ? "?include_github=true" : "";
  const body = await apiRequest<unknown>("GET", `/api/memory/repos${q}`);
  if (!isObj(body) || !Array.isArray(body.repos))
    throw new Error("Unexpected answer from /api/memory/repos");
  return body.repos.flatMap((r): MemoryRepo[] =>
    isObj(r) && str(r.repo_key)
      ? [
          {
            repo_key: r.repo_key,
            label: str(r.label) && r.label ? r.label : r.repo_key,
            memory_count: count(r.memory_count),
            pending_count: count(r.pending_count),
            last_run_at: strOrNull(r.last_run_at),
          },
        ]
      : [],
  );
}
