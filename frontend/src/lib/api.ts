// Typed client for the Tvashtr control-plane HTTP surface (proxied to :8000 by Vite).

export interface NodePosition {
  x: number;
  y: number;
}

export interface GraphNode {
  id: string;
  role_name: string;
  kind: string;
  model: string;
  engine: string | null;
  position: NodePosition;
}

export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
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
  status: string; // pending | running | completed | failed
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

export async function startRun(): Promise<string> {
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`POST /api/runs -> ${res.status}`);
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

export const getGraph = (runId: string): Promise<GraphData> =>
  getJSON<GraphData>(`/api/runs/${runId}/graph`);

export const getRunStatus = (runId: string): Promise<RunStatus> =>
  getJSON<RunStatus>(`/api/runs/${runId}`);

export const getHealth = (): Promise<Health> => getJSON<Health>("/health");

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

export const getRunEvents = (runId: string): Promise<RunEventsResponse> =>
  getJSON<RunEventsResponse>(`/api/spike/run-events/${runId}`);
