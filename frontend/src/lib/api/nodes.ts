/**
 * Agent panel API (B-NODES, docs/superpowers/plans/api/nodes.md): the agent templates, one agent's
 * rounds across the team's runs, "Preview as the agent sees it", and a PARTIAL agent PATCH — only
 * the fields the drawer changed are sent, so a stale drawer can't clobber a Toolkit-side attach of
 * tools or skills. Every call reports whether the backend answered, and every answer is shape-checked
 * here so one unexpected answer never blanks the drawer.
 */
import { ApiError, apiUrl, type Capability, type TeamGraphNode } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";
import { type Memory, type MemoryStatus, parseMemory } from "./memory";
import { parseRoundConnectors, type RoundConnectors } from "./roundConnectors";
import { apiRequest } from "./runs";

// ---- Types -----------------------------------------------------------------------------------

/** One built-in agent template (drawer Templates menu, focus Templates dialog). */
export interface NodeTemplate {
  key: string;
  title: string;
  description: string;
  /** One sentence on what its instructions do (the Templates dialog); the tagline when absent. */
  summary: string;
  role_name: string;
  node_kind: "thinker" | "worker";
  /** The template's default File access (the UI applies it with the template). */
  edits_allowed: boolean;
  writes_to: string | null;
  verdict_labels: string[];
  prompt: string;
}

export interface NodeRunSummary {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  live: boolean;
  /** The run's memory repo (`memory.repo_key_for_run`); null for a greenfield run. */
  repo_key: string | null;
  repo_label: string | null;
  rounds_count: number;
  last_outcome: string | null;
  last_status: string | null;
  last_round_at: string | null;
}

export interface RoundCost {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface RoundDocument {
  document_id: string;
  name: string;
  version_no: number;
  is_shared_spec?: boolean;
}

export interface NodeRound {
  invocation_id: number;
  iteration: number;
  status: string;
  outcome: string | null;
  outcome_detail: string | null;
  started_at: string | null;
  ended_at: string | null;
  cost: RoundCost | null;
  model_used: string | null;
  runs_on: { via: "subscription" | "api_key"; provider: string } | null;
  given: {
    documents: RoundDocument[];
    memory: { id: string; polarity: string }[];
    skills: Record<string, unknown>[];
  } | null;
  produced: {
    verdict: { file: string; verdict: string; reasons: string } | null;
    documents: RoundDocument[];
    files: string[] | null;
  } | null;
  /** What the round called through connectors and what it ran without; null when neither. */
  connectors?: RoundConnectors | null;
  /** M7: why this round can't be a test (null: "Make this a test" is enabled). */
  test_blocked?: string | null;
}

export interface NodeRunDetail {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  live: boolean;
  rounds: NodeRound[];
}

export interface NodeRuns {
  runs: NodeRunSummary[];
  run: NodeRunDetail | null;
}

export interface ContextPart {
  key: string;
  label: string;
  text: string;
  tokens: number;
  source: Record<string, unknown> & { label?: string };
  placeholder: boolean;
}

export interface ContextSkill {
  name: string;
  mode: string | null;
  triggers: string[];
  delivery: string;
  content: string | null;
  tokens: number;
  source_type: string;
  fetched_at_run_time: boolean;
}

export interface ContextPreview {
  source_run: { run_id: string; idea: string; created_at: string } | null;
  parts: ContextPart[];
  skills: ContextSkill[];
  skills_tokens: number;
  total_tokens: number;
  budget: number;
  over_budget: boolean;
  handle_used: boolean;
  notes: string[];
}

/** The unsaved draft the preview compiles (every field optional: absent = the saved node). */
export interface ContextPreviewDraft {
  prompt?: string;
  model?: string;
  edits_allowed?: boolean;
  reads_from?: string[];
  reads_default?: boolean;
  skills?: unknown[];
  memory_remember_enabled?: boolean;
  run_id?: string;
  idea?: string;
}

/**
 * A partial agent PATCH: send only the keys that changed. `null` clears where the contract allows it
 * (`title`, `description`, `reads_default`, `fallback_model`, `output_schema`).
 */
export interface AgentPatch {
  /** Thinker ↔ worker (the canvas's "Make it the starting thinker"; the backend keeps the root a thinker). */
  capability?: Capability;
  prompt?: string;
  model?: string;
  title?: string | null;
  description?: string | null;
  edits_allowed?: boolean;
  multimodal?: boolean;
  reads_from?: string[];
  reads_default?: boolean | null;
  writes_to?: string;
  fallback_model?: string | null;
  output_schema?: Record<string, unknown> | null;
  skills?: unknown[] | null;
  tool_config?: Record<string, unknown> | null;
  memory_remember_enabled?: boolean;
  /** M11 (R13): the agent's time limit in seconds (5 / 10 / 20 / 30 / 60 minutes; default 20). */
  time_limit_s?: number;
}

/** Why a node save failed, so the drawer can show the server's own words. */
export type NodeSaveErrorKind = "conflict" | "invalid" | "not_found" | "other";

export class NodeSaveError extends ApiError {
  constructor(
    status: number,
    message: string,
    public readonly kind: NodeSaveErrorKind,
  ) {
    super(status, message);
    this.name = "NodeSaveError";
  }
}

// ---- Plumbing --------------------------------------------------------------------------------

async function send(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(apiUrl(url), init);
  } catch (err) {
    reportFetchFailed();
    throw err;
  }
  // A 502/503/504 is the Desktop proxy (or Fly) saying the backend is away, not an answer.
  if (res.status >= 502 && res.status <= 504) reportFetchFailed();
  else reportFetchOk();
  return res;
}

/** The server's human `detail` (a string, or FastAPI's validation list), else the fallback. */
async function detailOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
    if (body.detail && typeof body.detail === "object") {
      const nested = (body.detail as { message?: unknown }).message;
      if (typeof nested === "string" && nested.trim()) return nested;
    }
  } catch {
    // not JSON — keep the fallback
  }
  return fallback;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

// ---- Templates -------------------------------------------------------------------------------

/** The four built-in templates. Rows missing a key or a prompt are dropped. */
export async function getNodeTemplates(): Promise<NodeTemplate[]> {
  const res = await send("/api/node-templates");
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t load templates."));
  const body: unknown = await res.json();
  const rows = isObj(body) && Array.isArray(body.templates) ? body.templates : [];
  return rows.filter(isObj).flatMap((t): NodeTemplate[] => {
    const key = str(t.key);
    const prompt = str(t.prompt);
    if (!key || !prompt) return [];
    return [
      {
        key,
        title: str(t.title, key),
        description: str(t.description),
        summary: str(t.summary, str(t.description)),
        role_name: str(t.role_name, key),
        node_kind: t.node_kind === "worker" ? "worker" : "thinker",
        edits_allowed: t.edits_allowed === true,
        writes_to: strOrNull(t.writes_to),
        verdict_labels: strList(t.verdict_labels),
        prompt,
      },
    ];
  });
}

// ---- Node history ----------------------------------------------------------------------------

function toRunSummary(r: Record<string, unknown>): NodeRunSummary | null {
  const run_id = str(r.run_id);
  if (!run_id) return null;
  return {
    run_id,
    idea: str(r.idea),
    status: str(r.status),
    created_at: str(r.created_at),
    live: r.live === true,
    repo_key: strOrNull(r.repo_key),
    repo_label: strOrNull(r.repo_label),
    rounds_count: num(r.rounds_count),
    last_outcome: strOrNull(r.last_outcome),
    last_status: strOrNull(r.last_status),
    last_round_at: strOrNull(r.last_round_at),
  };
}

function toDocs(v: unknown): RoundDocument[] {
  return (Array.isArray(v) ? v : []).filter(isObj).map((d) => ({
    document_id: str(d.document_id),
    name: str(d.name),
    version_no: num(d.version_no),
    is_shared_spec: d.is_shared_spec === true,
  }));
}

function toRound(r: Record<string, unknown>): NodeRound {
  const cost = isObj(r.cost)
    ? {
        prompt_tokens: num(r.cost.prompt_tokens),
        completion_tokens: num(r.cost.completion_tokens),
        total_tokens: num(r.cost.total_tokens),
        cost_usd: num(r.cost.cost_usd),
      }
    : null;
  const runsOn = isObj(r.runs_on)
    ? {
        via: r.runs_on.via === "subscription" ? ("subscription" as const) : ("api_key" as const),
        provider: str(r.runs_on.provider),
      }
    : null;
  const given = isObj(r.given)
    ? {
        documents: toDocs(r.given.documents),
        memory: (Array.isArray(r.given.memory) ? r.given.memory : [])
          .filter(isObj)
          .map((m) => ({ id: str(m.id), polarity: str(m.polarity) })),
        skills: (Array.isArray(r.given.skills) ? r.given.skills : []).filter(isObj),
      }
    : null;
  const produced = isObj(r.produced)
    ? {
        verdict: isObj(r.produced.verdict)
          ? {
              file: str(r.produced.verdict.file),
              verdict: str(r.produced.verdict.verdict),
              reasons: str(r.produced.verdict.reasons),
            }
          : null,
        documents: toDocs(r.produced.documents),
        files: Array.isArray(r.produced.files) ? strList(r.produced.files) : null,
      }
    : null;
  return {
    invocation_id: num(r.invocation_id),
    iteration: num(r.iteration),
    status: str(r.status),
    outcome: strOrNull(r.outcome),
    outcome_detail: strOrNull(r.outcome_detail),
    started_at: strOrNull(r.started_at),
    ended_at: strOrNull(r.ended_at),
    cost,
    model_used: strOrNull(r.model_used),
    runs_on: runsOn,
    given,
    produced,
    connectors: parseRoundConnectors(r.connectors),
    test_blocked: strOrNull(r.test_blocked),
  };
}

/** One agent's rounds across the team's runs (`runId` expands that run; default the newest). */
export async function getNodeRuns(
  teamId: string,
  nodeId: string,
  opts: { runId?: string; limit?: number } = {},
): Promise<NodeRuns> {
  const q = new URLSearchParams();
  if (opts.runId) q.set("run_id", opts.runId);
  if (opts.limit !== undefined) q.set("limit", String(opts.limit));
  const qs = q.toString();
  const res = await send(
    `/api/teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(nodeId)}/runs${qs ? `?${qs}` : ""}`,
  );
  if (!res.ok)
    throw new ApiError(res.status, await detailOf(res, "Couldn’t load this agent’s runs."));
  const body: unknown = await res.json();
  if (!isObj(body)) return { runs: [], run: null };
  const runs = (Array.isArray(body.runs) ? body.runs : [])
    .filter(isObj)
    .map(toRunSummary)
    .filter((r): r is NodeRunSummary => r !== null);
  const r = isObj(body.run) ? body.run : null;
  const run: NodeRunDetail | null =
    r && str(r.run_id)
      ? {
          run_id: str(r.run_id),
          idea: str(r.idea),
          status: str(r.status),
          created_at: str(r.created_at),
          live: r.live === true,
          rounds: (Array.isArray(r.rounds) ? r.rounds : []).filter(isObj).map(toRound),
        }
      : null;
  return { runs, run };
}

// ---- Context preview -------------------------------------------------------------------------

/** "Preview as the agent sees it": the first-round context with the unsaved draft applied. */
export async function previewNodeContext(
  teamId: string,
  nodeId: string,
  draft: ContextPreviewDraft = {},
): Promise<ContextPreview> {
  const res = await send(
    `/api/teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(nodeId)}/context-preview`,
    jsonInit("POST", draft),
  );
  if (!res.ok) throw new ApiError(res.status, await detailOf(res, "Couldn’t build the preview."));
  const body: unknown = await res.json();
  const b = isObj(body) ? body : {};
  const sr = isObj(b.source_run) ? b.source_run : null;
  return {
    source_run:
      sr && str(sr.run_id)
        ? { run_id: str(sr.run_id), idea: str(sr.idea), created_at: str(sr.created_at) }
        : null,
    parts: (Array.isArray(b.parts) ? b.parts : []).filter(isObj).map((p) => ({
      key: str(p.key),
      label: str(p.label),
      text: str(p.text),
      tokens: num(p.tokens),
      source: isObj(p.source) ? (p.source as ContextPart["source"]) : {},
      placeholder: p.placeholder === true,
    })),
    skills: (Array.isArray(b.skills) ? b.skills : []).filter(isObj).map((s) => ({
      name: str(s.name),
      mode: strOrNull(s.mode),
      triggers: strList(s.triggers),
      delivery: str(s.delivery),
      content: strOrNull(s.content),
      tokens: num(s.tokens),
      source_type: str(s.source_type),
      fetched_at_run_time: s.fetched_at_run_time === true,
    })),
    skills_tokens: num(b.skills_tokens),
    total_tokens: num(b.total_tokens),
    budget: num(b.budget),
    over_budget: b.over_budget === true,
    handle_used: b.handle_used === true,
    notes: strList(b.notes),
  };
}

// ---- Partial agent PATCH ---------------------------------------------------------------------

function saveErrorKind(status: number): NodeSaveErrorKind {
  if (status === 409) return "conflict";
  if (status === 422) return "invalid";
  if (status === 404) return "not_found";
  return "other";
}

/**
 * PATCH only the changed fields of an agent node. Throws a `NodeSaveError` carrying the server's
 * detail (409 "The first agent writes the shared spec…", 422 "Instructions can’t be empty.", …).
 */
export async function patchAgentNode(
  teamId: string,
  nodeId: string,
  patch: AgentPatch,
): Promise<TeamGraphNode> {
  const res = await send(
    `/api/teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(nodeId)}`,
    jsonInit("PATCH", patch),
  );
  if (!res.ok) {
    const message = await detailOf(res, "Couldn’t save. Try again.");
    throw new NodeSaveError(res.status, message, saveErrorKind(res.status));
  }
  return (await res.json()) as TeamGraphNode;
}

/** GET /api/memories?node_id=&status= — one agent's own notes with one status (the Memory tab). */
export async function listNodeMemories(nodeId: string, status: MemoryStatus): Promise<Memory[]> {
  const q = new URLSearchParams({ node_id: nodeId, status });
  const body = await apiRequest<unknown>("GET", `/api/memories?${q}`);
  if (!isObj(body) || !Array.isArray(body.memories))
    throw new Error("Unexpected answer from /api/memories");
  return body.memories.map(parseMemory).filter((m): m is Memory => m !== null);
}
