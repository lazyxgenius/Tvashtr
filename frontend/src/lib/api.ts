// Typed client for the Tvashtr control-plane HTTP surface (proxied to :8000 by Vite).

// Absolute API origin when set at build time. Empty = same-origin relative paths (preferred).
// Desktop v1 leaves this empty and reverse-proxies /api → https://tvashtr.fly.dev from localhost
// so session cookies stay first-party. See docs/desktop-v1.md.
export const API_BASE = String(import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");
export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}


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
  // M-rails C9: parameterized guardrail configs. `forbidden_paths` drives
  // `diff_touches_forbidden_paths`; `output_file` + `schema` drive `output_schema_check` (stored
  // under the config key `schema`, which is what the executor reads).
  forbidden_paths?: string[];
  output_file?: string;
  schema?: Record<string, unknown>;
}
export interface TerminalConfig {
  terminal_kind: "ship" | "stop";
}
export type NodeConfig = GateConfig | TerminalConfig | Record<string, unknown>;

// M-ledger C6: the per-round context-budget snapshot for a worker round — each context part with
// its token size, the round total, the budget, and whether the spec was offloaded to a doc handle
// (SPEC.md). The backend emits `null` for thinker / gate / terminal rounds.
export interface ContextManifest {
  parts: { name: string; tokens: number }[];
  total_tokens: number;
  budget: number;
  handle_used: boolean;
  // M-memory S3/S5b (additive): the memory facts injected into THIS round's context — id + polarity
  // stubs only (resolve id→content client-side against the store). Absent (key omitted) when no
  // memory was injected, byte-identical to the pre-S3 manifest. Backs the run-inspector "Used this
  // run" zone (S5b).
  memory?: { id: string; polarity: string }[];
}

// M-ledger C6: the token/$ cost of one invocation. `null` when no cost row is linked (gates /
// terminals; a zero-usage reviewer round).
export interface InvocationCost {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

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
  // M-ledger C6 (additive): the round's context-budget snapshot (worker rounds) + its token/$ cost.
  // Both `null` for rounds the backend links no ledger row to (thinker / gate / terminal / a
  // zero-usage reviewer round).
  context_manifest: ContextManifest | null;
  cost: InvocationCost | null;
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
  // M-unify U1/U3: the ONE capability distinction — true ⇒ this node's file edits ship; false ⇒
  // report-only (runs the full loop, only REPORT.md + the verdict leave the sandbox). The run graph
  // returns it too, so the node card labels off the edits capability in both views.
  edits_allowed?: boolean;
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
  // M-tools C7.A (SHARED CONTRACT S1): tools/skills that failed to resolve at run time and were
  // SKIPPED (the run continued). [] when none — drives the run-inspector warning banner.
  resolution_warnings?: ResolutionWarning[];
}

// M-tools C7.A: one run-scoped resolution warning (a skipped tool/skill source).
export interface ResolutionWarning {
  source_kind: string;
  name: string;
  reason: string;
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
  // M-h1b: the hosted run target + deliverable. `github_repo` (owner/name) is set when the run was
  // launched against a GitHub App repo (null for a local/greenfield run); `pr_url` is the opened
  // pull request — the hosted user's deliverable — set once the run pushes + opens it (null until
  // then / for a non-hosted run). Optional so existing greenfield/brownfield fixtures stay valid.
  github_repo?: string | null;
  pr_url?: string | null;
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

// ---- Auth (M-accounts Slice A) ----

// The minimal identity the auth endpoints return + the FE carries while logged in.
export interface AuthUser {
  id: string;
  email: string;
}

// M-h1a: the PUBLIC client bootstrap (GET /api/config) — the posture the AuthWizard needs BEFORE
// login. Only public fields (never a client secret / private key). Self-hosted default: hosted_mode
// false + an empty install URL, so the wizard stays the email/password flow.
// M-runnable: one served catalogue entry — provider + model SLUGS only (never keys). The FE holds NO
// hardcoded model/provider list; it DERIVES its quick-picks + provider suggestions from these.
// M-seat: split by SEAT. A thinker makes one completion; a worker drives the agent loop, and a model
// can be good at the first and unable to do the second — so the picker must offer a worker node only
// what the backend probed as worker-capable. `worker_default: null` means "this provider cannot
// serve a worker seat" and its `worker_presets` are then empty.
export interface ProviderCatalogueEntry {
  provider: string;
  thinker_default: string | null;
  worker_default: string | null;
  thinker_presets: string[];
  worker_presets: string[];
}

export interface Config {
  hosted_mode: boolean;
  github_install_url: string;
  // M-h1b: the "add repositories" GitHub App install URL — the hosted launch panel's escape hatch
  // when the account has the app installed on NO repo (the repo dropdown is then empty). Empty when
  // unset server-side; never a session signal (this endpoint is public).
  github_manage_url: string;
  // M-runnable: the backend-owned provider catalogue (slugs only). The picker derives from it.
  provider_catalogue: ProviderCatalogueEntry[];
}

// An error that preserves the HTTP status so the login screen can branch on 401 / 409 / 422.
// M-live: it also carries `missingNodes` — the role names the launch pre-flight named as offending
// (either providers the owner has no key for, or models their provider no longer serves). Both
// refusals use the SAME contract, so the canvas can highlight the nodes to fix without caring which
// of the two fired. Defaults to `[]`, so every existing throw site is unchanged.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly missingNodes: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The `detail.missing_nodes` role names, or `[]`. Never throws — a refusal we cannot parse still
 *  has to surface its message, so a bad shape degrades to "no highlight", never to a crash. */
function missingNodesOf(body: unknown): string[] {
  const detail = (body as { detail?: unknown })?.detail;
  const raw = (detail as { missing_nodes?: unknown })?.missing_nodes;
  return Array.isArray(raw) ? raw.filter((n): n is string => typeof n === "string") : [];
}

// M-legible: FastAPI's error `detail` is sometimes a string, sometimes a `{message}` object (and a
// few endpoints put the human text at a top-level `message`). Read whichever is present so a failed
// call can surface the backend's REAL reason — a 422/429 means it answered, not that it is down —
// falling back to the caller's generic text when the body is absent or unparseable.
/** A Response body can be consumed ONCE, so the message and the nodes must come out of a single
 *  `.json()` — a second call would throw. */
async function errorDetailFromBody(
  res: Response,
  fallback: string,
): Promise<{ message: string; missingNodes: string[] }> {
  try {
    const body: unknown = await res.json();
    const nodes = missingNodesOf(body);
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim())
      return { message: detail, missingNodes: nodes };
    if (detail && typeof detail === "object") {
      const nested = (detail as { message?: unknown }).message;
      if (typeof nested === "string" && nested.trim())
        return { message: nested, missingNodes: nodes };
    }
    const top = (body as { message?: unknown }).message;
    if (typeof top === "string" && top.trim()) return { message: top, missingNodes: nodes };
    return { message: fallback, missingNodes: nodes };
  } catch {
    // a non-JSON / empty body → the generic fallback
  }
  return { message: fallback, missingNodes: [] };
}

// A single 401 seam: AuthGate registers a handler here; the GET helpers below invoke it when the
// server rejects an absent/expired session, so a mid-session expiry drops the whole app back to the
// login screen on the next poll. Set to null on unmount.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

// On 401 the session is gone → notify the gate and resolve null (so AuthGate shows the login
// screen); any other non-OK status is a real error and throws.
export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) {
    unauthorizedHandler?.();
    return null;
  }
  if (!res.ok) throw new ApiError(res.status, `GET /api/auth/me -> ${res.status}`);
  return (await res.json()) as AuthUser;
}

// The public posture bootstrap. Resilient by design — the login screen must render even if this
// fails: any non-OK response or network error falls back to the self-hosted default (email/password),
// and it NEVER trips the 401 seam (the endpoint is public, so a 401 here is not a session signal).
export async function getConfig(): Promise<Config> {
  const fallback: Config = {
    hosted_mode: false,
    github_install_url: "",
    github_manage_url: "",
    provider_catalogue: [],
  };
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return fallback;
    const data = (await res.json()) as Partial<Config>;
    const catalogue = Array.isArray(data.provider_catalogue) ? data.provider_catalogue : [];
    // M-runnable: cache the catalogue for the synchronous picker helpers (presetsForProvider /
    // providerSuggestions) — this runs at app boot, before the node picker / dashboard are opened.
    setProviderCatalogue(catalogue);
    return {
      hosted_mode: data.hosted_mode === true,
      github_install_url: data.github_install_url ?? "",
      github_manage_url: data.github_manage_url ?? "",
      provider_catalogue: catalogue,
    };
  } catch {
    return fallback;
  }
}

async function postAuth(
  path: string,
  body: { email: string; password: string },
): Promise<AuthUser> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError(res.status, `POST ${path} -> ${res.status}`);
  return (await res.json()) as AuthUser;
}

export const login = (email: string, password: string): Promise<AuthUser> =>
  postAuth("/api/auth/login", { email, password });

export const register = (email: string, password: string): Promise<AuthUser> =>
  postAuth("/api/auth/register", { email, password });

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, `POST /api/auth/logout -> ${res.status}`);
}

// ---- Provider credentials (M-accounts Slice B: the account's BYOK keys) ----

// One configured provider as the dashboard shows it — `provider · •••• last4`. The secret is NEVER
// returned by the server, so it is not on this shape.
export interface ProviderCredential {
  provider: string;
  key_last4: string;
  created_at: string;
}

// The account's configured providers (oldest first). Empty for a fresh account.
export async function listProviders(): Promise<ProviderCredential[]> {
  const data = await getJSON<{ providers: ProviderCredential[] }>("/api/providers");
  return data.providers;
}

// Add (or REPLACE) the account's key for a provider. Returns `{provider, key_last4}` — never the
// secret (the plaintext is sent once, then only the last 4 are ever shown).
export async function addProvider(
  provider: string,
  apiKey: string,
): Promise<{ provider: string; key_last4: string }> {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /api/providers -> ${res.status}`);
  return (await res.json()) as { provider: string; key_last4: string };
}

// Remove the account's key for a provider (204, idempotent).
export async function removeProvider(provider: string): Promise<void> {
  const res = await fetch(`/api/providers/${encodeURIComponent(provider)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/providers/${provider} -> ${res.status}`);
}

// ---- MCP secrets (M-tools C7.A): the account's ${NAME} store for MCP tool_config ----

// A stored MCP secret as the shelf shows it — only the NAME is ever returned, never the value.
export interface McpSecretName {
  name: string;
}

// The NAMES of the account's MCP secrets (never the values). Empty for a fresh account.
export async function listSecrets(): Promise<McpSecretName[]> {
  const data = await getJSON<{ secrets: McpSecretName[] }>("/api/secrets");
  return data.secrets;
}

// Add (or REPLACE) an MCP ${NAME} secret. Returns `{name}` — never the value.
export async function addSecret(name: string, value: string): Promise<{ name: string }> {
  const res = await fetch("/api/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, value }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /api/secrets -> ${res.status}`);
  return (await res.json()) as { name: string };
}

// Remove the account's ${name} secret (204, idempotent).
export async function removeSecret(name: string): Promise<void> {
  const res = await fetch(`/api/secrets/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/secrets/${name} -> ${res.status}`);
}

// ---- The account's runs (the dashboard's "previous runs" list) ----

export interface RunSummary {
  run_id: string;
  idea: string;
  status: string;
  created_at: string;
  repo_path: string | null;
}

// The account's runs, newest first (owner-scoped server-side). Empty for a fresh account.
export async function listRuns(): Promise<RunSummary[]> {
  const data = await getJSON<{ runs: RunSummary[] }>("/api/runs");
  return data.runs;
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(apiUrl(url));
  // M-accounts Slice A: a 401 on any GET poll means the session expired — surface it to the gate.
  if (res.status === 401) unauthorizedHandler?.();
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
  // scoped-mount Slice 2: an optional package to scope a brownfield run to (the Scope picker's
  // choice — a tracked dir of the repo). Included in the POST body ONLY when set, so a whole-repo /
  // greenfield launch omits it entirely (the byte-for-byte contract is preserved).
  subpath?: string;
  // M-h1b: the hosted run target — a GitHub App repo `full_name` (owner/name), mutually exclusive
  // with `repo_path` server-side. Included in the POST body ONLY when set, so a self-hosted /
  // greenfield launch omits it entirely (the prior request contract is byte-for-byte preserved).
  github_repo?: string;
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
  const body: {
    team_graph_id: string;
    idea?: string;
    repo_path?: string;
    base_ref?: string;
    subpath?: string;
    github_repo?: string;
  } = {
    team_graph_id: teamGraphId,
  };
  if (opts.idea) body.idea = opts.idea;
  if (opts.repo_path) body.repo_path = opts.repo_path;
  if (opts.base_ref) body.base_ref = opts.base_ref;
  // scoped-mount Slice 2: only a picked package threads through — whole-repo/greenfield omits it.
  if (opts.subpath) body.subpath = opts.subpath;
  // M-h1b: the hosted GitHub repo target threads through ONLY when set — a self-hosted/greenfield
  // launch omits it, so its request body is byte-for-byte the prior contract.
  if (opts.github_repo) body.github_repo = opts.github_repo;
  const res = await fetch("/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // M-legible: carry the backend's real reason (422 invalid graph, 429 ceiling, …) on an ApiError
    // so App.tsx renders it instead of the misleading "is the backend running?" guess.
    const { message, missingNodes } = await errorDetailFromBody(
      res,
      `POST /api/runs -> ${res.status}`,
    );
    throw new ApiError(res.status, message, missingNodes);
  }
  const data = (await res.json()) as { run_id: string };
  return data.run_id;
}

// ---- Hosted-mode GitHub repos (M-h1b): the account's GitHub App repos the launch panel offers ----

// One repo the account's GitHub App installation can see, as `GET /api/github/repos` serializes it.
// `full_name` (owner/name) is what a hosted launch threads as `github_repo`; `private` marks the
// dropdown label; `default_branch` is the read-only base the run's PR is opened against.
export interface GithubRepo {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
}

// The owner-scoped repo list + how many app installations back it (0 ⇒ the app is installed nowhere;
// an empty `repos` with a non-zero count ⇒ installed but on no repo — both drive the panel's
// "Add repositories on GitHub" escape hatch).
export interface GithubReposResponse {
  repos: GithubRepo[];
  installation_count: number;
}

// The account's GitHub App repos (owner-scoped server-side, like every other session read). Only
// meaningful in hosted mode; the launch panel calls it when the user opts to work on a repo.
export const getGithubRepos = (): Promise<GithubReposResponse> =>
  getJSON<GithubReposResponse>("/api/github/repos");

// scoped-mount Slice 2: one top-level tracked package directory the Scope picker offers.
// `file_count` = tracked files anywhere under it (recursive), so a user can size a package before
// scoping the run to it. Every one satisfies the backend's subpath validation (≥1 file under it).
export interface RepoSubpath {
  path: string;
  file_count: number;
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
      // scoped-mount Slice 2 (additive/optional): the repo's top-level tracked package dirs the
      // launch panel's Scope picker offers. The backend endpoint always returns it for a git repo;
      // optional so a client/fixture predating the field is still a valid `RepoInspect` (⇒ no
      // packages ⇒ whole-repo only).
      subpaths?: RepoSubpath[];
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

// ---- Run diff (M-changes — the run-view "Changes" tab): the files the run changed on its ship
// branch, so a reviewer can SEE the shipped change before accepting it. ----

// One changed file in a run's diff. `status` is git's change class; `additions`/`deletions` are the
// ±line counts; `patch` is the unified-diff hunk text the Changes tab renders line-by-line.
export interface RunDiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  patch: string;
}

// A run's full change set. Brownfield diffs `base_ref`..`ship_branch` (both mirror RunRow); a
// greenfield run reports its produced workspace files as additions (base_ref/ship_branch null). A
// run with nothing to diff yet -> an empty `files` list (never an error).
export interface RunDiff {
  run_id: string;
  base_ref: string | null;
  ship_branch: string | null;
  files: RunDiffFile[];
  total: number;
}

// The run's changed files (owner-scoped server-side, like every other run read). Mirrors getGraph.
export const getRunDiff = (runId: string): Promise<RunDiff> =>
  getJSON<RunDiff>(`/api/runs/${runId}/diff`);

// M-memory S5b: the durable memory facts THIS run taught (`active` + `pending_review`), owner-scoped
// server-side like every run read. Backs the run-inspector "Learned this run" zone. Unwraps the
// `{ memories }` envelope like listMemories; the rows are full `NodeMemoryRow`s (content/polarity/
// status/tier + source linkage). Read-only — the existing GET endpoint (no backend change for S5b).
export const getRunMemories = (runId: string): Promise<NodeMemoryRow[]> =>
  getJSON<{ memories: NodeMemoryRow[] }>(`/api/runs/${runId}/memories`).then((d) => d.memories);

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AskAnswer {
  answer: string;
}

// Mode A ("Ask the node"): a stateless chat about what ONE node did during a run. The client holds
// the whole history and sends it each turn; the server assembles the node's recorded trail into a
// system message and answers ONLY from it. Owner-scoped server-side (404 on a foreign/absent run),
// and NOT attributed to the run's cost. Mirrors resolveTask's POST-with-path-ids shape.
export async function askNode(
  runId: string,
  nodeId: string,
  messages: AskMessage[],
): Promise<AskAnswer> {
  const res = await fetch(`/api/runs/${runId}/nodes/${nodeId}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error(`POST ask ${nodeId} -> ${res.status}`);
  return (await res.json()) as AskAnswer;
}

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
  // M-unify U1/U3: the ONE capability distinction the drawer's Edits toggle drives — true ⇒ the
  // node's file edits ship; false ⇒ report-only (runs the full agent loop, read-only + MCP tools,
  // but only REPORT.md + the verdict leave the sandbox). Returned by _node_base_dict on every node.
  edits_allowed?: boolean;
  config: NodeConfig | null;
  // M-tools C7.0: per-node inline tools (raw MCP config object) + skills (inline sources array).
  // NULL until a later milestone's UI sets them; the drawer round-trips them via updateTeamNode.
  tool_config?: Record<string, unknown> | null;
  skills?: unknown[] | null;
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

// ===== M-tools C7.B (Skills) — skill-source union (OWNED BY C7.B; keep in this region) =========
// One element of `AgentNode.skills`. Resolved server-side by control_plane/node_skills.py into SDK
// Skill objects; a WORKER gets them via AgentContext, a THINKER gets them folded into its prompt.
// Extend additively only.

// An inline SKILL.md authored on the node. `mode` picks the disclosure behavior:
//  - "always"  → always active (full content in every prompt / the SDK's <REPO_CONTEXT>)
//  - "trigger" → surfaced when the conversation matches `triggers`
//  - "agent"   → exposed as an invokable skill the agent chooses (progressive disclosure)
export interface InlineSkillSource {
  type: "inline";
  name: string;
  content: string;
  mode: "always" | "trigger" | "agent";
  triggers?: string[];
}

// A GitHub repo cloned at the PINNED `ref` (a living reference; the ref pins reproducibility).
// `filter` selects a subset of the repo's skills. Subsumes marketplaces (a marketplace is a
// repo + manifest).
export interface RepoSkillSource {
  type: "repo";
  url: string;
  ref: string;
  filter?: string | null;
}

// Adopt the rules of the repo the run OPERATES ON — its own CLAUDE.md / .cursorrules / AGENTS.md /
// GEMINI.md / .agents/skills PLUS the modern .cursor/rules/*.mdc. No URL — it's the run's workspace.
export interface ProjectRulesSkillSource {
  type: "project_rules";
}

// M-tools C7.C: a LIVE reference to an account-library skill. No content on the node — the resolver
// (control_plane/node_skills.py) fetches the referenced library skill's SOURCE fresh each run and
// resolves it one level. Appended to the node's `skills` list; de-duped by name (first-in-list wins).
export interface LibrarySkillSource {
  type: "library";
  id: string;
}

export type SkillSource =
  | InlineSkillSource
  | RepoSkillSource
  | ProjectRulesSkillSource
  | LibrarySkillSource;
// ===== end M-tools C7.B / C7.C skill-source block ==============================================

// ===== M-tools C7.C — the account Tool + Skill LIBRARY (reusable items a node references) =======
// UNLIKE a secret, a library item's content IS returned (it is editable, not a credential). A node
// stores only the id (tools: in `tool_config.tvashtr.library`; skills: a {type:"library",id} source);
// the run-time resolver merges the referenced content with the node's inline config (inline wins).

// A library skill's stored source is one of the non-reference sources (never nests another library).
export type LibrarySkillItemSource = InlineSkillSource | RepoSkillSource | ProjectRulesSkillSource;

export interface ToolLibraryItem {
  id: string;
  name: string;
  server_config: Record<string, unknown>;
  created_at: string;
}

export interface SkillLibraryItem {
  id: string;
  name: string;
  source: LibrarySkillItemSource;
  created_at: string;
}

// The account's library tools (oldest first). Empty for a fresh account.
export async function listToolLibrary(): Promise<ToolLibraryItem[]> {
  const data = await getJSON<{ tools: ToolLibraryItem[] }>("/api/tool-library");
  return data.tools;
}

// Add (or REPLACE, upsert on name) a library tool. Returns `{id, name}` — never the whole row.
export async function createToolLibraryItem(
  name: string,
  serverConfig: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  const res = await fetch("/api/tool-library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, server_config: serverConfig }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /api/tool-library -> ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

// Edit a library tool by id (propagates LIVE to every referencing node's next run).
export async function updateToolLibraryItem(
  id: string,
  name: string,
  serverConfig: Record<string, unknown>,
): Promise<{ id: string; name: string }> {
  const res = await fetch(`/api/tool-library/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, server_config: serverConfig }),
  });
  if (!res.ok) throw new ApiError(res.status, `PATCH /api/tool-library/${id} -> ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

export async function deleteToolLibraryItem(id: string): Promise<void> {
  const res = await fetch(`/api/tool-library/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/tool-library/${id} -> ${res.status}`);
}

// The account's library skills (oldest first).
export async function listSkillLibrary(): Promise<SkillLibraryItem[]> {
  const data = await getJSON<{ skills: SkillLibraryItem[] }>("/api/skill-library");
  return data.skills;
}

export async function createSkillLibraryItem(
  name: string,
  source: LibrarySkillItemSource,
): Promise<{ id: string; name: string }> {
  const res = await fetch("/api/skill-library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, source }),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /api/skill-library -> ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

export async function updateSkillLibraryItem(
  id: string,
  name: string,
  source: LibrarySkillItemSource,
): Promise<{ id: string; name: string }> {
  const res = await fetch(`/api/skill-library/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, source }),
  });
  if (!res.ok) throw new ApiError(res.status, `PATCH /api/skill-library/${id} -> ${res.status}`);
  return (await res.json()) as { id: string; name: string };
}

export async function deleteSkillLibraryItem(id: string): Promise<void> {
  const res = await fetch(`/api/skill-library/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/skill-library/${id} -> ${res.status}`);
}
// ===== end M-tools C7.C library block ==========================================================

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
  last_run: { status: string; at: string; run_id: string } | null;
  spend_usd: number;
}

// One row in a team's run-history drill-down (`GET /api/teams/{id}/runs`) — every run the team has
// ever had, newest first, where `TeamSummary.last_run` carries only the most recent one. `run_id`
// is what the run view opens.
export interface TeamRunRow {
  run_id: string;
  status: string;
  idea: string;
  created_at: string;
  cost_total_usd: number;
}

// One starter preset in the New-team picker (the curated, code-resident template library).
export interface Template {
  template: string; // the stable key passed to createTeam
  name: string;
  description: string;
}

// M-runnable: the provider catalogue is BACKEND-OWNED (control_plane.teams.PROVIDER_CATALOGUE) and
// served on GET /api/config; the FE declares NO model/provider list. It is cached here at boot
// (getConfig) so the SYNCHRONOUS picker helpers below can read it without threading it through every
// component. Empty until getConfig resolves — the model field still accepts free text, so a
// not-yet-loaded catalogue degrades to "no quick-picks", never a wrong hardcoded list. The catalogue
// is static per deployment and getConfig runs at app boot, so it is populated well before the node
// picker / dashboard are opened.
let providerCatalogue: ProviderCatalogueEntry[] = [];

export function setProviderCatalogue(entries: ProviderCatalogueEntry[]): void {
  providerCatalogue = entries;
}

export function getProviderCatalogue(): ProviderCatalogueEntry[] {
  return providerCatalogue;
}

// The provider slugs offered as quick-adds (dashboard datalist + node picker) — DERIVED from the
// served catalogue in its own order, never a hardcoded list.
export function providerSuggestions(): string[] {
  return providerCatalogue.map((e) => e.provider);
}

// M-accounts Slice C: the ONE provider-canonicalization rule — the leading ``provider/`` slug
// segment, lower-cased + trimmed. This MUST match the backend ``credentials.provider_for_model``
// EXACTLY (a parity unit test pins it); the per-node picker derives a model's provider with this.
export function providerOf(model: string): string {
  return model.split("/")[0].trim().toLowerCase();
}

// The catalogue quick-picks for one provider IN ONE SEAT — what the Model field offers once a
// provider is chosen. Reads the served catalogue (matched by the canonical provider key); empty for
// an unknown or not-yet-loaded provider, and empty for a provider that cannot serve this seat at all
// (the free-text field still accepts any slug, so this narrows guidance, never the user's choice).
export function presetsForProvider(provider: string, capability: Capability): string[] {
  const entry = providerCatalogue.find((e) => e.provider === provider);
  if (!entry) return [];
  return (capability === "worker" ? entry.worker_presets : entry.thinker_presets) ?? [];
}

// One provider's catalogued default for a seat, or null when it cannot serve that seat. The picker
// uses it to land on a sensible slug when the user switches provider.
export function defaultForProvider(provider: string, capability: Capability): string | null {
  const entry = providerCatalogue.find((e) => e.provider === provider);
  if (!entry) return null;
  return (capability === "worker" ? entry.worker_default : entry.thinker_default) ?? null;
}

// The providers that can serve this seat at all — the ones the picker should offer for this node.
export function providersForCapability(capability: Capability): string[] {
  return providerCatalogue
    .filter((e) => (capability === "worker" ? e.worker_default : e.thinker_default))
    .map((e) => e.provider);
}

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

// Rename a library team. Returns the UPDATED SUMMARY, so the caller can swap the row in place
// rather than re-derive it. The backend trims the name and rejects a blank one (422).
export async function renameTeam(teamId: string, name: string): Promise<TeamSummary> {
  const res = await fetch(`/api/teams/${teamId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`PATCH /api/teams/${teamId} -> ${res.status}`);
  return (await res.json()) as TeamSummary;
}

// A team's full run history, newest first (the dashboard drill-down). `[]` for a team that exists
// but has never run; a team that is not yours is a 404, which throws.
export async function getTeamRuns(teamId: string): Promise<TeamRunRow[]> {
  const data = await getJSON<{ runs: TeamRunRow[] }>(`/api/teams/${teamId}/runs`);
  return data.runs;
}

// One library team's nodes + edges (the canvas/edit shape, no run state).
export const getTeamGraph = (teamId: string): Promise<TeamGraphData> =>
  getJSON<TeamGraphData>(`/api/teams/${teamId}/graph`);

// A node's authorable capability (P1.8c): a "thinker" is a direct-LLM completion (like the PM); a
// "worker" is an engine-backed sandboxed run (like the Engineer). Maps server-side to kind+engine.
// M-seat reuses this same type as the catalogue's SEAT name (it mirrors the backend
// `teams.CAPABILITIES`), so the client has exactly one definition of the seat vocabulary.
export type Capability = "thinker" | "worker";

// Persist an edited library-team node's prompt + model, and (P1.8c) optionally its capability,
// (M-tools C7.0) optionally its inline tools/skills, and (M-unify U3) optionally its edits_allowed —
// the ONE capability distinction the drawer's Edits toggle now drives (the backend NodeUpdate accepts
// it; an EXPLICIT value wins over the capability→kind sync). Each optional field is included in the
// PATCH body ONLY when provided, so existing call sites stay back-compatible and an omitted field
// leaves the stored value unchanged. Returns the updated node; the caller refetches the team.
export async function updateTeamNode(
  teamId: string,
  nodeId: string,
  prompt: string,
  model: string,
  capability?: Capability,
  toolConfig?: Record<string, unknown> | null,
  skills?: unknown[] | null,
  editsAllowed?: boolean,
  memoryRememberEnabled?: boolean,
  writesTo?: string,
  readsFrom?: string[],
  // Per-node capabilities (Session A): the three additive drawer settings, GROUPED into one optional
  // trailing object (the `updateGateNode` precedent) rather than three more positional args. Each key
  // is independent and follows the same rule as every field above — it reaches the PATCH body ONLY
  // when the caller provides it, so an omitted key leaves the stored value untouched, and an EXPLICIT
  // null clears it. A caller that omits the whole object produces a byte-identical PATCH body.
  capabilities?: {
    fallback_model?: string | null;
    output_schema?: Record<string, unknown> | null;
    multimodal?: boolean;
  },
): Promise<TeamGraphNode> {
  const body: {
    prompt: string;
    model: string;
    capability?: Capability;
    tool_config?: Record<string, unknown> | null;
    skills?: unknown[] | null;
    edits_allowed?: boolean;
    memory_remember_enabled?: boolean;
    writes_to?: string;
    reads_from?: string[];
    fallback_model?: string | null;
    output_schema?: Record<string, unknown> | null;
    multimodal?: boolean;
  } = { prompt, model };
  if (capability !== undefined) body.capability = capability;
  // M-unify U3: the Edits toggle's source of truth. Sent whenever the caller passes it; the backend's
  // ``model_fields_set`` guard makes an explicit value win over the legacy capability→kind sync.
  if (editsAllowed !== undefined) body.edits_allowed = editsAllowed;
  // M-memory: the per-node "Remember what I learn" toggle — sent ONLY when the caller passes it (the
  // backend's model_fields_set guard leaves config untouched when omitted). Mirrors editsAllowed.
  if (memoryRememberEnabled !== undefined) body.memory_remember_enabled = memoryRememberEnabled;
  // M-docs: per-node document routing — writes_to (one doc name) + reads_from (a list of names) in
  // the node's config JSONB. Sent ONLY when the caller passes it (the backend's model_fields_set
  // guard leaves config untouched when omitted). Mirrors memoryRememberEnabled.
  if (writesTo !== undefined) body.writes_to = writesTo;
  if (readsFrom !== undefined) body.reads_from = readsFrom;
  // M-tools C7.A (SHARED CONTRACT S2): ALWAYS send tools/skills when the caller passed a value (even
  // an explicit null → clear to NULL). Only a caller that OMITS the arg (undefined) leaves the stored
  // value unchanged — the backend distinguishes the two via `model_fields_set`. A caller that omits
  // both still produces a PATCH body byte-identical to before this milestone.
  if (toolConfig !== undefined) body.tool_config = toolConfig;
  if (skills !== undefined) body.skills = skills;
  // Session A: fallback_model / output_schema / multimodal — same per-key rule as everything above.
  if (capabilities?.fallback_model !== undefined) body.fallback_model = capabilities.fallback_model;
  if (capabilities?.output_schema !== undefined) body.output_schema = capabilities.output_schema;
  if (capabilities?.multimodal !== undefined) body.multimodal = capabilities.multimodal;
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /api/teams/${teamId}/nodes/${nodeId} -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}

// M-rails C8: persist an edited GATE node's config — its `gate_kind` (`gate_approval` human vs the
// `secret_leak_scan` guardrail) + human-facing `title`/`description`. A SEPARATE fn from
// `updateTeamNode` (which owns the agent prompt/model/capability editor): the same node-update
// endpoint accepts EITHER shape, and the backend branches on the node's kind. Returns the updated node.
export async function updateGateNode(
  teamId: string,
  nodeId: string,
  gateKind: string,
  title: string,
  description: string,
  // M-rails C9: the parameterized guardrail configs, sent ONLY for the kind that uses them (so a
  // human / secret_leak_scan save keeps the byte-identical `{gate_kind, title, description}` body).
  config?: {
    forbidden_paths?: string[];
    output_file?: string;
    output_schema?: Record<string, unknown>;
  },
): Promise<TeamGraphNode> {
  const body: Record<string, unknown> = { gate_kind: gateKind, title, description };
  if (config?.forbidden_paths !== undefined) body.forbidden_paths = config.forbidden_paths;
  if (config?.output_file !== undefined) body.output_file = config.output_file;
  if (config?.output_schema !== undefined) body.output_schema = config.output_schema;
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH gate /api/teams/${teamId}/nodes/${nodeId} -> ${res.status}`);
  return (await res.json()) as TeamGraphNode;
}

// M-endpoint-editable: persist an edited TERMINAL node's disposition (ship ↔ stop). Same endpoint
// as updateTeamNode / updateGateNode; the backend branches on node.kind and syncs role_name to
// terminal_kind. Returns the updated node.
export async function updateTerminalNode(
  teamId: string,
  nodeId: string,
  terminalKind: "ship" | "stop",
): Promise<TeamGraphNode> {
  const res = await fetch(`/api/teams/${teamId}/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ terminal_kind: terminalKind }),
  });
  if (!res.ok)
    throw new Error(`PATCH terminal /api/teams/${teamId}/nodes/${nodeId} -> ${res.status}`);
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

// M-docs: the run-view document PICKER's list-item shape (metadata only, no versions) — the backend
// `_document_meta`. Fetched via getRunDocuments; each item opens in the shared TipTap editor by id.
export interface DocumentMeta {
  id: string;
  title: string;
  doc_type: string;
  name: string | null; // the run-scoped name ("spec", "design", …); null for legacy docs
  created_at: string;
  updated_at: string;
}

// ---- Run events (the Engineer panel) ----

export interface RunEvent {
  seq: number;
  kind: string; // action | observation | message | error
  payload: Record<string, unknown>;
  created_at: string;
  // M-ledger C6 (additive): the invocation this event belongs to, the node that invocation ran on,
  // and that invocation's round number. All `null` for legacy rows written before the ledger. The
  // feed scopes by `node_id`, groups by `invocation_id`, and keys rows by `${invocation_id}:${seq}`.
  invocation_id: number | null;
  node_id: string | null;
  iteration: number | null;
}

export interface RunEventsResponse {
  run_id: string;
  events: RunEvent[]; // ascending by seq
}

export const getDocument = (documentId: string): Promise<DocumentDetail> =>
  getJSON<DocumentDetail>(`/api/documents/${documentId}`);

// M-docs: every document THIS run produced (metadata only, oldest first) — backs the run-view
// document picker. Owner-scoped server-side; the picker opens any one by id via getDocument.
export const getRunDocuments = (
  runId: string,
): Promise<{ run_id: string; documents: DocumentMeta[] }> =>
  getJSON<{ run_id: string; documents: DocumentMeta[] }>(`/api/runs/${runId}/documents`);

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

// ===== M-memory S5 — the owner-scoped agentic-memory client (the account Memory shelf + S5b) =====
// The store the shelf makes visible/controllable: facts the agents learned across runs, tier-scoped
// (account / repo / per-node), each with a directive `polarity`. Every fn is owner-scoped
// server-side (the session cookie), mirroring the providers / secrets / tool-library clients.

// The fact's directive FORCE (M-memory S1b) — the closed 6-value taxonomy the backend CHECK pins.
// RFC-2119: require=MUST, prefer=SHOULD, allow=MAY, context=neutral (the default), avoid=SHOULD NOT,
// forbid=MUST NOT.
export type MemoryPolarity = "require" | "prefer" | "allow" | "context" | "avoid" | "forbid";

// The tier is DERIVED server-side from the scoping columns (never stored): account = neither set,
// repo = repo_key only, node = both set.
export type MemoryTier = "account" | "repo" | "node";

// One memory row exactly as the API serializes it (control_plane/memory.py `_to_dict`). The server
// OMITS owner_id, the raw embedding vector, and superseded_by; `tier` is derived at serialization.
export interface NodeMemoryRow {
  id: string;
  content: string;
  polarity: MemoryPolarity;
  repo_key: string | null;
  node_id: string | null;
  tier: MemoryTier;
  pinned: boolean;
  status: string; // active | pending_review | rejected | superseded
  confirmation_count: number;
  source_run_id: string | null;
  source_invocation_id: number | null;
  embedding_dim: number | null;
  valid_from: string | null;
  invalid_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

// GET /api/memories — the owner's memories (oldest first), optionally filtered. Excludes non-active
// rows unless include_superseded; an explicit `status` returns EXACTLY that status (the review UI
// fetches pending_review / rejected / superseded through it). Returns the bare row list.
export async function listMemories(
  params: {
    repo_key?: string;
    node_id?: string;
    status?: string;
    include_superseded?: boolean;
  } = {},
): Promise<NodeMemoryRow[]> {
  const q = new URLSearchParams();
  if (params.repo_key !== undefined) q.set("repo_key", params.repo_key);
  if (params.node_id !== undefined) q.set("node_id", params.node_id);
  if (params.status !== undefined) q.set("status", params.status);
  if (params.include_superseded) q.set("include_superseded", "true");
  const qs = q.toString();
  const data = await getJSON<{ memories: NodeMemoryRow[] }>(`/api/memories${qs ? `?${qs}` : ""}`);
  return data.memories;
}

// POST /api/memories — author a fact. The TIER is encoded by which scoping fields are set (account =
// neither, repo = repo_key only). Returns the created row (422 on empty content / an invalid tier /
// a bad polarity; 502 if the embedding provider call fails).
export async function createMemory(input: {
  content: string;
  repo_key?: string | null;
  node_id?: string | null;
  pinned?: boolean;
  polarity?: MemoryPolarity;
}): Promise<NodeMemoryRow> {
  const res = await fetch("/api/memories", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new ApiError(res.status, `POST /api/memories -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

// PATCH /api/memories/{id} — edit content (re-embeds on a real change), pinned, and/or polarity.
// Omitted fields are left unchanged. Returns the updated row.
export async function updateMemory(
  id: string,
  patch: { content?: string; pinned?: boolean; polarity?: MemoryPolarity },
): Promise<NodeMemoryRow> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new ApiError(res.status, `PATCH /api/memories/${id} -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

// DELETE /api/memories/{id} — hard-delete (204, idempotent + owner-scoped).
export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`DELETE /api/memories/${id} -> ${res.status}`);
}

// POST /api/memories/{id}/pin | /unpin — a pinned fact is "hot" (always injected later). Returns row.
export async function pinMemory(id: string): Promise<NodeMemoryRow> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}/pin`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, `POST pin ${id} -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

export async function unpinMemory(id: string): Promise<NodeMemoryRow> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}/unpin`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, `POST unpin ${id} -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

// POST /api/memories/{id}/promote | /reject (M-memory S4) — the pending-review queue's two actions.
// promote → active VIA Consolidate (dedup / supersede-the-contradicted-active / activate). reject →
// a TOMBSTONE (status rejected + invalid_at) that also suppresses re-proposal. Both return the row.
export async function promoteMemory(id: string): Promise<NodeMemoryRow> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}/promote`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, `POST promote ${id} -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

export async function rejectMemory(id: string): Promise<NodeMemoryRow> {
  const res = await fetch(`/api/memories/${encodeURIComponent(id)}/reject`, { method: "POST" });
  if (!res.ok) throw new ApiError(res.status, `POST reject ${id} -> ${res.status}`);
  return (await res.json()) as NodeMemoryRow;
}

// GET / PATCH /api/memory/review-mode (M-memory S5a — the ONE new endpoint) — the per-owner
// review-before-persist toggle (users.memory_review_mode). ON routes every otherwise-active memory
// write to pending_review until the owner confirms it. Singular /api/memory/ path — never collides
// with /api/memories/{id}.
export async function getReviewMode(): Promise<boolean> {
  const data = await getJSON<{ review_mode: boolean }>("/api/memory/review-mode");
  return data.review_mode;
}

export async function setReviewMode(reviewMode: boolean): Promise<boolean> {
  const res = await fetch("/api/memory/review-mode", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ review_mode: reviewMode }),
  });
  if (!res.ok) throw new ApiError(res.status, `PATCH /api/memory/review-mode -> ${res.status}`);
  const data = (await res.json()) as { review_mode: boolean };
  return data.review_mode;
}
// ===== end M-memory S5 client block ============================================================
