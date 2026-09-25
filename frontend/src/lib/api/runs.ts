/**
 * Runs API for Home (B-RUNS contract, `docs/superpowers/plans/api/runs.md`): the paged runs list
 * with progress, one run's launch target (Retry / Start again prefill), launching with budget /
 * retry / branch / scope, and the GitHub branch + folder lists behind the Options popover.
 *
 * Every call reports its outcome to the header's backend status (`reportFetchOk` when the server
 * answered, `reportFetchFailed` when it could not be reached), and a 401 hands the session back to
 * the sign-in gate.
 */
import { ApiError, apiUrl, getMe } from "../api";
import { reportFetchFailed, reportFetchOk } from "../backendStatus";

/** An ApiError that keeps the parsed `detail` so callers can read structured refusals
 *  (`missing_providers`, `code: "unknown_base_ref"`, `errors[]`, …). */
export class ApiDetailError extends ApiError {
  constructor(
    status: number,
    message: string,
    public readonly detail: unknown,
    missingNodes: string[] = [],
  ) {
    super(status, message, missingNodes);
    this.name = "ApiDetailError";
  }
}

function messageOf(body: unknown, fallback: string): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === "string" && m.trim()) return m;
  }
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined;
    if (typeof first?.msg === "string") return first.msg;
  }
  const top = (body as { message?: unknown } | null)?.message;
  if (typeof top === "string" && top.trim()) return top;
  return fallback;
}

/** fetch + backend-status reporting + error parsing. Returns the parsed JSON (or null for 204). */
export async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    reportFetchFailed();
    throw e;
  }
  reportFetchOk();
  if (res.status === 401) void getMe().catch(() => undefined);
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail: unknown = parsed?.detail ?? null;
    const nodes: unknown =
      detail && typeof detail === "object"
        ? (detail as { missing_nodes?: unknown }).missing_nodes
        : null;
    throw new ApiDetailError(
      res.status,
      messageOf(parsed, `${method} ${path} -> ${res.status}`),
      detail,
      Array.isArray(nodes) ? nodes.filter((n): n is string => typeof n === "string") : [],
    );
  }
  if (res.status === 204) return null as T;
  return (await res.json()) as T;
}

// ---- Shared shapes ----

export type StatusGroup = "running" | "needs_you" | "completed" | "failed" | "stopped";

export interface RunTarget {
  kind: "github" | "desktop_folder" | "local" | "none";
  label: string | null;
  base_ref: string | null;
  subpath: string | null;
}

export interface RunAwaiting {
  task_id: number;
  kind: string;
  title: string;
  gate_node_id: string | null;
  gate_role: string;
  next_role: string | null;
  since: string;
}

export interface RunFailure {
  code: string;
  message: string;
  node_id: string | null;
  origin_node_id: string | null;
  node_role: string | null;
  provider: string | null;
  target: "website" | "desktop";
}

export type ProgressState = "done" | "active" | "waiting" | "idle" | "failed" | "stopped";

export interface RunProgressChip {
  node_id: string;
  origin_node_id: string | null;
  role_name: string;
  label: string;
  kind: string;
  state: ProgressState;
  loops_with: string | null;
}

export interface RunListRow {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  repo_path: string | null;
  status_group: StatusGroup;
  updated_at: string;
  github_repo: string | null;
  base_ref: string | null;
  subpath: string | null;
  target: RunTarget | null;
  pr_url: string | null;
  pr_number: number | null;
  ship_branch: string | null;
  budget_cap_usd: number | null;
  desktop_target: boolean;
  library_team_id: string | null;
  retry_of_run_id: string | null;
  team: { id: string; name: string } | null;
  spent_usd: number;
  awaiting: RunAwaiting | null;
  failure: RunFailure | null;
  progress?: RunProgressChip[];
}

export type RunStatusFilter =
  | "all"
  | "active"
  | "running"
  | "needs_you"
  | "completed"
  | "failed"
  | "stopped";

export interface RunsPage {
  runs: RunListRow[];
  next_cursor: string | null;
}

export interface ListRunsQuery {
  status?: RunStatusFilter;
  teamId?: string | null;
  q?: string;
  limit?: number;
  cursor?: string | null;
  progress?: boolean;
}

/** One page of the caller's runs, newest first. */
export async function listRunsPage(query: ListRunsQuery = {}): Promise<RunsPage> {
  const p = new URLSearchParams();
  if (query.status && query.status !== "all") p.set("status", query.status);
  if (query.teamId) p.set("team_id", query.teamId);
  if (query.q) p.set("q", query.q);
  if (query.limit) p.set("limit", String(query.limit));
  if (query.cursor) p.set("cursor", query.cursor);
  if (query.progress) p.set("include", "progress");
  const qs = p.toString();
  const data = await apiRequest<Partial<RunsPage>>("GET", `/api/runs${qs ? `?${qs}` : ""}`);
  return { runs: data.runs ?? [], next_cursor: data.next_cursor ?? null };
}

/** One run with the fields Retry / Start again prefill from (the `run` of GET /api/runs/{id}). */
export interface RunDetail {
  id: string;
  idea: string;
  status: string;
  github_repo: string | null;
  repo_path: string | null;
  base_ref: string | null;
  subpath: string | null;
  budget_cap_usd: number | null;
  desktop_target: boolean;
  library_team_id: string | null;
  team: { id: string; name: string } | null;
  target: RunTarget | null;
  pm_document_id: string | null;
  status_group?: StatusGroup;
  spent_usd?: number;
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const data = await apiRequest<{ run: RunDetail | null }>(
    "GET",
    `/api/runs/${encodeURIComponent(runId)}`,
  );
  return data.run;
}

// ---- Launch ----

export interface LocalRepoTarget {
  snapshot_id: string;
  label: string;
  base_ref: string;
  subpath?: string;
}

export interface LaunchBody {
  team_graph_id: string;
  idea: string;
  github_repo?: string;
  repo_path?: string;
  local_repo?: LocalRepoTarget;
  base_ref?: string;
  subpath?: string;
  budget_cap_usd?: number;
  desktop_target?: boolean;
  retry_of_run_id?: string;
}

/** POST /api/runs. Only set fields are sent. Refusals throw `ApiDetailError` with the detail. */
export async function launchRun(body: LaunchBody): Promise<string> {
  const payload: Record<string, unknown> = { team_graph_id: body.team_graph_id, idea: body.idea };
  if (body.github_repo) payload.github_repo = body.github_repo;
  if (body.repo_path) payload.repo_path = body.repo_path;
  if (body.local_repo) payload.local_repo = body.local_repo;
  if (body.base_ref) payload.base_ref = body.base_ref;
  if (body.subpath) payload.subpath = body.subpath;
  if (body.budget_cap_usd !== undefined) payload.budget_cap_usd = body.budget_cap_usd;
  if (body.desktop_target) payload.desktop_target = true;
  if (body.retry_of_run_id) payload.retry_of_run_id = body.retry_of_run_id;
  const data = await apiRequest<{ run_id: string }>("POST", "/api/runs", payload);
  return data.run_id;
}

/** POST /api/runs/{id}/cancel (Stop). */
export async function stopRun(runId: string): Promise<void> {
  await apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`);
}

/** Resolve a gate (approve / reject with a note). A lost race is a 409. */
export async function resolveGate(
  runId: string,
  taskId: number,
  decision: "approve" | "reject",
  note?: string,
): Promise<void> {
  await apiRequest("POST", `/api/runs/${encodeURIComponent(runId)}/tasks/${taskId}/resolve`, {
    decision,
    note: note ?? null,
  });
}

// ---- GitHub branches / folders (Options popover) ----

function repoPath(fullName: string): string {
  const [owner = "", repo = ""] = fullName.split("/");
  return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

export interface RepoBranches {
  default_branch: string;
  branches: string[];
  truncated: boolean;
}

export function getRepoBranches(fullName: string): Promise<RepoBranches> {
  return apiRequest<RepoBranches>("GET", `/api/github/repos/${repoPath(fullName)}/branches`);
}

export interface RepoSubpaths {
  ref: string;
  subpaths: { path: string; file_count: number }[];
  truncated: boolean;
}

export function getRepoSubpaths(fullName: string, ref?: string): Promise<RepoSubpaths> {
  const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return apiRequest<RepoSubpaths>("GET", `/api/github/repos/${repoPath(fullName)}/subpaths${qs}`);
}
