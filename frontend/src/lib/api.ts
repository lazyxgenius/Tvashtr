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
  // P1.5a: edge routing condition — null = unconditional. A `{when}` keys a branch
  // (e.g. the gate's `rejected` route). P1.8a retopologized the Reviewer->Engineer
  // loop-back to the no-`when` catch-all `{loop_limit: N}` (the review-loop cap; the
  // same key the backend's `loop_limit_for` reads).
  conditions: { when?: string; loop_limit?: number } | null;
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
  // M-brownfield: the brownfield run target — all null for a greenfield run. The backend
  // `_run_to_dict` already returns these three; declaring them here is what lets the polling FE
  // (and the run banner) read them. Optional so existing greenfield fixtures stay valid.
  repo_path?: string | null;
  base_ref?: string | null;
  ship_branch?: string | null;
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

// The launch options the launch panel collects (M-brownfield Slice 2). All optional: an `idea`
// (the feature request — empty ⇒ the server default), and a brownfield run target (`repo_path` +
// `base_ref`). Each field is included in the POST body ONLY when set, so a no-opts call is
// byte-for-byte the prior greenfield launch.
export interface RunTeamOptions {
  idea?: string;
  repo_path?: string;
  base_ref?: string;
}

// Clone-on-launch (P1.8b): "Run this team" launches a run on a fresh deep-clone of the persistent
// authored team (the user's edited prompts/models), not a throwaway builder graph. The backend
// clones the team, seeds the run, and starts the workflow — the existing live run view then takes
// over via the returned run_id (the same poll surface as before).
//
// M-brownfield Slice 2: `opts` carries the launch panel's idea + optional brownfield target. Each
// field is added to the body ONLY when non-empty, so `runTeam(id)` (or `runTeam(id, {})`) posts
// exactly `{ team_graph_id }` — the greenfield launch is byte-for-byte unchanged.
export async function runTeam(teamGraphId: string, opts: RunTeamOptions = {}): Promise<string> {
  const body: { team_graph_id: string; idea?: string; repo_path?: string; base_ref?: string } = {
    team_graph_id: teamGraphId,
  };
  if (opts.idea) body.idea = opts.idea;
  if (opts.repo_path) body.repo_path = opts.repo_path;
  if (opts.base_ref) body.base_ref = opts.base_ref;
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/runs -> ${res.status}`);
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

// M-brownfield Slice 2: the discriminated result of `POST /api/repo/inspect` (the backend returns a
// 200 in BOTH cases — never an exception — so the FE renders it inline). `is_git: true` carries the
// branch list + the current branch (the default base) + the tracked-file count (drives the
// large-repo model hint); `is_git: false` carries a human-readable `error`.
export type RepoInspect =
  | {
      is_git: true;
      current_branch: string | null;
      branches: string[];
      tracked_file_count: number;
    }
  | { is_git: false; error: string };

export async function inspectRepo(path: string): Promise<RepoInspect> {
  const res = await fetch("/api/repo/inspect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`POST /api/repo/inspect -> ${res.status}`);
  return (await res.json()) as RepoInspect;
}

export const getGraph = (runId: string): Promise<GraphData> =>
  getJSON<GraphData>(`/api/runs/${runId}/graph`);

// ---- The team library (P1.8b: multiple persistent teams + a drop-and-edit template library) ----

// One node of a library team — the canvas/edit shape (the team is NOT running, so no live
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
  // M2: the authoring "last run" brief — the latest invocation of any CLONE of this authored node,
  // across all the team's runs (null if it never ran). Read-only; the run-view endpoint has none.
  last_run?: {
    outcome: string | null;
    outcome_detail: string | null;
    run_id: string;
    iteration: number;
    started_at: string;
  } | null;
}

export interface TeamGraphData {
  team_graph_id: string;
  nodes: TeamGraphNode[];
  edges: GraphEdge[];
}

// One row in the teams rail — a library team summary (the rail lists these; the canvas loads the
// selected one's full graph separately via `getTeamGraph`).
export interface TeamSummary {
  team_graph_id: string;
  name: string;
  created_at: string;
  node_count: number;
}

// One starter preset in the New-team picker (the curated, code-resident template library).
export interface Template {
  template: string; // the stable key passed to createTeam
  name: string;
  description: string;
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

// M-brownfield Slice 2 (D4): above this many tracked files the launch panel surfaces a dismissible
// "consider a stronger worker model" advisory. A recommendation, never enforced. (Lives here, a
// non-component module, so the component file exports only components — Fast Refresh stays happy.)
export const LARGE_REPO_FILE_THRESHOLD = 300;

// The user's library teams (the rail). Seeded server-side so it is never empty.
export async function getTeams(): Promise<TeamSummary[]> {
  const data = await getJSON<{ teams: TeamSummary[] }>("/api/teams");
  return data.teams;
}

// The curated starter templates the New-team picker offers (the FE renders from this list).
export async function getTemplates(): Promise<Template[]> {
  const data = await getJSON<{ templates: Template[] }>("/api/templates");
  return data.templates;
}

// Create a new library team from a starter template (drop-and-edit). Returns the new team's
// summary; the caller makes it current + loads its graph.
export async function createTeam(template: string, name: string): Promise<TeamSummary> {
  const res = await fetch("/api/teams", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template, name }),
  });
  if (!res.ok) throw new Error(`POST /api/teams -> ${res.status}`);
  return (await res.json()) as TeamSummary;
}

// Delete a library team. The backend cascades its nodes/edges; runs are unaffected (they point at
// immutable clone snapshots, never the library team).
export async function deleteTeam(teamId: string): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/teams/${teamId} -> ${res.status}`);
}

// One library team's nodes + edges (the canvas/edit shape, no run state).
export const getTeamGraph = (teamId: string): Promise<TeamGraphData> =>
  getJSON<TeamGraphData>(`/api/teams/${teamId}/graph`);

// A node's authorable capability (P1.8c): a "thinker" is a direct-LLM completion (like the PM); a
// "worker" is an engine-backed sandboxed run (like the Engineer). Maps server-side to kind+engine.
export type Capability = "thinker" | "worker";

// Persist an edited library-team node's prompt + model, and (P1.8c) optionally its capability. The
// `capability` is included in the PATCH body ONLY when provided, so existing 4-arg call sites still
// post `{prompt, model}` unchanged (back-compat). Returns the updated node; the caller refetches the
// team to refresh the canvas.
export async function updateTeamNode(
  teamId: string,
  nodeId: string,
  prompt: string,
  model: string,
  capability?: Capability,
): Promise<TeamGraphNode> {
  const body: { prompt: string; model: string; capability?: Capability } = { prompt, model };
  if (capability !== undefined) body.capability = capability;
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /api/teams/${teamId}/nodes/${nodeId} -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}

// ---- Topology editing (P1.8d): node/edge CRUD + position persistence + the validity verdict ----

// The canvas vocabulary the palette drops + the four edge roles the inline editor offers. Each maps
// server-side onto the (kind, engine) / (edge_type, conditions) the executor routes on.
export type NodeKind = "thinker" | "worker" | "gate" | "terminal";
export type EdgeRole = "forward" | "branch" | "loop_back" | "escalation";
export type RolePreset = "pm" | "architect" | "engineer" | "reviewer";

export interface CreateNodeBody {
  node_kind: NodeKind;
  preset?: RolePreset; // thinker/worker only — pre-fills the prompt from the teams.py constants
  prompt?: string;
  model?: string;
  position?: NodePosition;
  title?: string; // gate
  description?: string; // gate
  terminal_kind?: "ship" | "stop"; // terminal (required)
}

// One holistic-validity finding (mirrors the backend `validate_graph` shape exactly). `node_id` /
// `edge_id` point at the offending element so the canvas can red-flag it; the `message` is shown.
export interface ValidityIssue {
  code: string;
  message: string;
  node_id: string | null;
  edge_id: string | null;
}
export interface GraphValidity {
  errors: ValidityIssue[];
  warnings: ValidityIssue[];
  runnable: boolean;
}

export async function createTeamNode(teamId: string, body: CreateNodeBody): Promise<TeamGraphNode> {
  const res = await fetch(`/api/teams/${teamId}/nodes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/teams/${teamId}/nodes -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}

export async function deleteTeamNode(teamId: string, nodeId: string): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE node ${nodeId} -> ${res.status}`);
}

export interface CreateEdgeBody {
  source_node_id: string;
  target_node_id: string;
  role: EdgeRole;
  label?: string; // branch
  loop_limit?: number; // loop_back (defaults to 3 server-side)
}

export async function createTeamEdge(teamId: string, body: CreateEdgeBody): Promise<GraphEdge> {
  const res = await fetch(`/api/teams/${teamId}/edges`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST /api/teams/${teamId}/edges -> ${res.status}`);
  return (await res.json()) as GraphEdge;
}

export async function deleteTeamEdge(teamId: string, edgeId: string): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/edges/${edgeId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE edge ${edgeId} -> ${res.status}`);
}

// Batch-persist canvas layout after a drag settles ({node_id: {x, y}}). Best-effort — off-team ids
// are ignored server-side, so a stale id never fails the whole save.
export async function saveTeamPositions(
  teamId: string,
  positions: Record<string, NodePosition>,
): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/positions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ positions }),
  });
  if (!res.ok) throw new Error(`POST /api/teams/${teamId}/positions -> ${res.status}`);
}

// The holistic-validity verdict for a team — the SAME `validate_graph` the create_run guard refuses
// an invalid launch with, so the canvas's Run-disabled UX never disagrees with the server.
export const getTeamValidity = (teamId: string): Promise<GraphValidity> =>
  getJSON<GraphValidity>(`/api/teams/${teamId}/validate`);

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
