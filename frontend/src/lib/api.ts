// Typed client for the Tvashtr control-plane HTTP surface (proxied to :8000 by Vite).

export interface NodePosition {
  x: number;
  y: number;
}

// P1.5b: a node's jsonb `config`. Gate nodes carry gate metadata, terminal nodes a
// terminal_kind; completion/agent nodes carry null. Kept permissive (config is jsonb) —
// narrow at the use site by `node.kind === "gate" | "terminal"`, not by discriminating
// on config itself.
export interface GateConfig {
  gate_kind: string;
  title: string;
  description: string;
}
export interface TerminalConfig {
  terminal_kind: "ship" | "stop";
}
export type NodeConfig = GateConfig | TerminalConfig | Record<string, unknown>;

// P1.5c (§14.1): one persisted AgentInvocation row — a single round of a node's
// execution. The Reviewer panel renders the per-round verdict history from these.
export interface NodeInvocation {
  iteration: number;
  status: string; // running | done | failed | stopped
  outcome: string | null; // reviewer: approved | changes_requested ; engineer: built ; …
  // P1.5c (§14.3): the verdict REASONS behind `outcome` — populated on a reviewer
  // `changes_requested` close, null otherwise. The Reviewer panel shows it under that round.
  outcome_detail: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface GraphNode {
  id: string;
  role_name: string;
  kind: string; // completion | agent | gate | terminal
  model: string;
  engine: string | null;
  // P1.8b: the node's behavior text — its whole identity in the prompt-driven model. Null for
  // gate/terminal nodes (control primitives, no LLM). Additive on this run endpoint; the editable
  // copy lives on the team-graph read.
  prompt: string | null;
  position: NodePosition;
  // P1.5b: gate/terminal node metadata (null for completion/agent).
  config: NodeConfig | null;
  // P1.5a: the node's live per-invocation state (backend owns this now).
  status: string; // idle | running | done | failed | stopped
  iteration: number; // 1-based count of this node's runs; 0 before it is reached
  // P1.5c: the node's full per-round history, ascending by iteration ([] before reached).
  invocations: NodeInvocation[];
}

export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  // P1.5a: edge routing condition — null = unconditional; the Reviewer->Engineer
  // loop-back carries {"when":"changes_requested"}.
  conditions: { when: string } | null;
}

export interface GraphData {
  run_id: string;
  team_graph_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface RunRow {
  id: string;
  team_graph_id: string;
  idea: string;
  // pending | running | awaiting_human | completed | failed | rejected | cancelled | over_budget
  status: string;
  pm_document_id: string | null;
  ship_commit_sha: string | null;
  ship_tag: string | null;
  cost_total_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface CostRow {
  id: number;
  idempotency_key: string;
  model_used: string;
  total_tokens: number;
  cost_usd: number;
}

export interface RunStatus {
  run_id: string;
  workflow_status: string;
  run: RunRow | null;
  costs: CostRow[];
}

export interface Health {
  status: string;
  db: string;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

// Clone-on-launch (P1.8b): "Run this team" launches a run on a fresh deep-clone of the persistent
// authored team (the user's edited prompts/models), not a throwaway builder graph. The backend
// clones the team, seeds the run, and starts the workflow — the existing live run view then takes
// over via the returned run_id (the same poll surface as before).
export async function runTeam(teamGraphId: string): Promise<string> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ team_graph_id: teamGraphId }),
  });
  if (!res.ok) throw new Error(`POST /api/runs -> ${res.status}`);
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

export const getGraph = (runId: string): Promise<GraphData> =>
  getJSON<GraphData>(`/api/runs/${runId}/graph`);

// ---- The persistent authored team (P1.8b: render + edit on the canvas) ----

// One node of the persistent team — the canvas/edit shape (the team is NOT running, so no live
// status/iteration/invocations). `prompt`/`model` are the two editable fields this slice.
export interface TeamGraphNode {
  id: string;
  role_name: string;
  kind: string; // completion | agent | gate | terminal
  model: string | null; // null for gate/terminal control primitives
  engine: string | null;
  prompt: string | null; // null for gate/terminal control primitives
  position: NodePosition;
  config: NodeConfig | null;
}

export interface TeamGraphData {
  team_graph_id: string;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
}

// A TINY static list of proven, in-repo model slugs offered as datalist quick-picks under the
// free-text model field — NOT a maintained registry. The field accepts any provider/model string.
export const MODEL_PRESETS = [
  "openai/gpt-4o-mini",
  "nvidia_nim/meta/llama-3.3-70b-instruct",
  "openrouter/openai/gpt-4o-mini",
  "openrouter/meta-llama/llama-3.1-8b-instruct",
  "openrouter/google/gemini-flash-1.5",
] as const;

export const getTeamGraph = (): Promise<TeamGraphData> => getJSON<TeamGraphData>("/api/team/graph");

// Persist an edited persistent-team node's prompt + model (the only two editable fields this
// slice). Returns the updated node; the caller refetches the team to refresh the canvas.
export async function updateTeamNode(
  nodeId: string,
  prompt: string,
  model: string,
): Promise<TeamGraphNode> {
  const res = await fetch(`/api/team/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, model }),
  });
  if (!res.ok) throw new Error(`PATCH /api/team/nodes/${nodeId} -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}

export const getRunStatus = (runId: string): Promise<RunStatus> =>
  getJSON<RunStatus>(`/api/runs/${runId}`);

export const getHealth = (): Promise<Health> => getJSON<Health>("/health");

// ---- A/B comparison (§14.3 — the "which team config ships better" read surface) ----

// One reviewer round on the review_loop side: the verdict label + the persisted reasons.
export interface ABReviewRound {
  iteration: number;
  outcome: string | null; // approved | changes_requested
  outcome_detail: string | null; // the reasons (on changes_requested), else null
}

// One side of an A/B pair (A = two_node / no review, B = review_loop / agent-Reviewer).
export interface ABSide {
  pair_label: string; // "A" | "B"
  team_shape: string; // "two_node" | "review_loop" (derived from the run's graph)
  run_id: string;
  status: string; // run.status (completed | failed | rejected | cancelled | over_budget | running…)
  workflow_status: string; // DBOS workflow status, or "NOT_FOUND"
  ship_tag: string | null;
  ship_commit_sha: string | null;
  cost_total_usd: number | null;
  idea: string;
  review_rounds: ABReviewRound[]; // [] for the two_node side
}

export interface ABComparison {
  pair_id: string;
  sides: ABSide[]; // ordered A then B; may be a single side (a partial-launch / failed pair, §15)
}

// Launch an A/B pair on the default idea (empty body → the cheap pinned skeleton). Returns the
// pair_id the comparison view then polls. Mirrors the single-run launch POST shape.
export async function startABRuns(): Promise<string> {
  const res = await fetch("/api/ab-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`POST /api/ab-runs -> ${res.status}`);
  const data = (await res.json()) as { pair_id: string };
  return data.pair_id;
}

export const getABComparison = (pairId: string): Promise<ABComparison> =>
  getJSON<ABComparison>(`/api/ab-runs/${pairId}`);

// ---- Tasks-for-Human (the gate: approve / reject / cancel) ----

export interface HumanTask {
  id: number;
  run_id: string;
  kind: string; // e.g. "gate_approval"
  priority: string; // "high_blocker" | "low_nudge"
  blocking: boolean;
  topic: string | null;
  title: string;
  description: string;
  status: string; // "pending" | "resolved"
  resolution: string | null; // "approved" | "rejected" | "cancelled"
  resolution_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface RunTasksResponse {
  run_id: string;
  tasks: HumanTask[]; // oldest first
}

export type TaskDecision = "approve" | "reject";

interface ResolveResponse {
  run_id: string;
  task_id: number;
  decision: TaskDecision;
  resolution: string;
  signaled: boolean;
}

interface CancelResponse {
  run_id: string;
  status: string | null;
  workflow_status: string;
}

export const getRunTasks = (runId: string): Promise<RunTasksResponse> =>
  getJSON<RunTasksResponse>(`/api/runs/${runId}/tasks`);

export async function resolveTask(
  runId: string,
  taskId: number,
  decision: TaskDecision,
  note?: string | null,
): Promise<ResolveResponse> {
  const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision, note: note ?? null }),
  });
  if (!res.ok) throw new Error(`POST resolve ${taskId} -> ${res.status}`);
  return (await res.json()) as ResolveResponse;
}

interface AcknowledgeResponse {
  run_id: string;
  task_id: number;
  resolution: string;
}

// Dismiss the topic-less, non-blocking `low_nudge` (e.g. the budget threshold). Marks it
// resolved directly server-side (no DBOS.send) — gate blockers go through `resolveTask`.
export async function acknowledgeTask(runId: string, taskId: number): Promise<AcknowledgeResponse> {
  const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/acknowledge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`POST acknowledge ${taskId} -> ${res.status}`);
  return (await res.json()) as AcknowledgeResponse;
}

export async function cancelRun(runId: string): Promise<CancelResponse> {
  const res = await fetch(`/api/runs/${runId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`POST cancel -> ${res.status}`);
  return (await res.json()) as CancelResponse;
}

// ---- Documents (the PM panel) ----

export interface DocumentVersion {
  id: string;
  version_no: number;
  content: string;
  created_by: string;
  created_at: string;
}

export interface DocumentDetail {
  id: string;
  title: string;
  doc_type: string;
  created_at: string;
  updated_at: string;
  versions: DocumentVersion[]; // ascending by version_no
}

// ---- Run events (the Engineer panel) ----

export interface RunEvent {
  seq: number;
  kind: string; // action | observation | message | error
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RunEventsResponse {
  run_id: string;
  events: RunEvent[]; // ascending by seq
}

export const getDocument = (documentId: string): Promise<DocumentDetail> =>
  getJSON<DocumentDetail>(`/api/documents/${documentId}`);

// P1.7b live steering: append a human edit as a NEW version (the server stamps
// created_by="human" + a fresh idempotency key per POST, so every Save is a new version the
// running agents re-source on their next node entry). The response is a PARTIAL shape (no
// version `id`, no `created_by`) — refetch via `getDocument` after a save to refresh the panel.
export interface AddedDocumentVersion {
  document_id: string;
  version_no: number;
  content: string;
  created_at: string;
}

export async function addDocumentVersion(
  documentId: string,
  content: string,
): Promise<AddedDocumentVersion> {
  const res = await fetch(`/api/documents/${documentId}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`POST /api/documents/${documentId}/versions -> ${res.status}`);
  return (await res.json()) as AddedDocumentVersion;
}

export const getRunEvents = (runId: string): Promise<RunEventsResponse> =>
  getJSON<RunEventsResponse>(`/api/spike/run-events/${runId}`);
