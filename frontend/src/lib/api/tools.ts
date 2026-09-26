/**
 * Toolkit API for Tools and Secrets (B-TOOLKIT contract, `docs/superpowers/plans/api/toolkit.md`):
 * the tool library (list, one tool with who uses it, create / patch / delete / duplicate / bulk
 * import, turn on for agents), the agents picker, secrets (list with `missing[]`, create-only POST,
 * replace, delete), the Toolkit nav-badge summary, the GitHub App status and the public catalog.
 *
 * Every answer is validated here, at the boundary: an entry with an unexpected shape is dropped or
 * given a safe default, so one odd answer never blanks a page. Errors throw `ApiDetailError`
 * (`message` = the server's `detail` copy, `detail` = the raw body for the `{code, …}` refusals of
 * import). `apiRequest` reports the backend status for the header.
 */
import { apiRequest } from "./runs";

// ---- Small validators ----

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}
function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}
function list<T>(v: unknown, parse: (raw: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const raw of v) {
    const item = parse(raw);
    if (item !== null) out.push(item);
  }
  return out;
}
const enc = encodeURIComponent;

// ---- Tools ----

/** An MCP server's config: `{command,args,env}` (Local) or `{url,headers,type?}` (Remote). */
export type ServerConfig = Record<string, unknown>;

export type ToolStatus = "ready" | "needs_attention";

export interface ToolItem {
  id: string;
  name: string;
  server_config: ServerConfig;
  created_at: string | null;
  updated_at: string | null;
  /** Every `${NAME}` in the config's env / headers values. */
  secret_refs: string[];
  /** The referenced names with no stored value. */
  missing_secrets: string[];
  status: ToolStatus;
  used_by: { agent_count: number; team_count: number };
}

/** Who uses a tool or skill: one agent in one team. */
export interface UsageRow {
  node_id: string;
  role_name: string;
  title: string | null;
  team_id: string;
  team_name: string;
}

export interface ToolDetail extends ToolItem {
  used_by_agents: UsageRow[];
}

function parseUsageRow(raw: unknown): UsageRow | null {
  if (!isRecord(raw) || typeof raw.node_id !== "string") return null;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name, "Agent"),
    title: strOrNull(raw.title),
    team_id: str(raw.team_id),
    team_name: str(raw.team_name),
  };
}

export function parseTool(raw: unknown): ToolItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const missing = strings(raw.missing_secrets);
  const status: ToolStatus =
    raw.status === "ready" || raw.status === "needs_attention"
      ? raw.status
      : missing.length > 0
        ? "needs_attention"
        : "ready";
  const usedBy = isRecord(raw.used_by) ? raw.used_by : {};
  return {
    id: raw.id,
    name: raw.name,
    server_config: isRecord(raw.server_config) ? raw.server_config : {},
    created_at: strOrNull(raw.created_at),
    updated_at: strOrNull(raw.updated_at),
    secret_refs: strings(raw.secret_refs),
    missing_secrets: missing,
    status,
    used_by: { agent_count: count(usedBy.agent_count), team_count: count(usedBy.team_count) },
  };
}

function toolOrThrow(raw: unknown): ToolItem {
  const tool = parseTool(raw);
  if (!tool) throw new Error("The server sent a tool we couldn’t read.");
  return tool;
}

/** GET /api/tool-library — oldest first (sort by name at the call site). */
export async function listTools(): Promise<ToolItem[]> {
  const data = await apiRequest<unknown>("GET", "/api/tool-library");
  return list(isRecord(data) ? data.tools : null, parseTool);
}

/** GET /api/tool-library/{id} — the tool plus who uses it. 404 `tool not found in your library`. */
export async function getTool(id: string): Promise<ToolDetail> {
  const data = await apiRequest<unknown>("GET", `/api/tool-library/${enc(id)}`);
  const tool = toolOrThrow(data);
  return {
    ...tool,
    used_by_agents: list(isRecord(data) ? data.used_by_agents : null, parseUsageRow),
  };
}

/** POST /api/tool-library — create-only (409 `You already have a tool named <name>.`). */
export async function createTool(body: {
  name: string;
  server_config: ServerConfig;
}): Promise<ToolItem> {
  return toolOrThrow(await apiRequest<unknown>("POST", "/api/tool-library", body));
}

/** PATCH /api/tool-library/{id} — partial; a rename carries each agent's on/off switch. */
export async function patchTool(
  id: string,
  body: { name?: string; server_config?: ServerConfig },
): Promise<ToolItem> {
  return toolOrThrow(await apiRequest<unknown>("PATCH", `/api/tool-library/${enc(id)}`, body));
}

/** DELETE /api/tool-library/{id} — strips it from every agent; idempotent. */
export async function deleteTool(id: string): Promise<{ removed_from_agents: number }> {
  const data = await apiRequest<unknown>("DELETE", `/api/tool-library/${enc(id)}`);
  return { removed_from_agents: count(isRecord(data) ? data.removed_from_agents : 0) };
}

/** POST /api/tool-library/{id}/duplicate — a copy named `<name>-copy` (no agents). */
export async function duplicateTool(id: string): Promise<ToolItem> {
  return toolOrThrow(await apiRequest<unknown>("POST", `/api/tool-library/${enc(id)}/duplicate`));
}

export type ImportConflictMode = "error" | "replace" | "rename";

/**
 * POST /api/tool-library/import — all or nothing. A 409 carries `detail`
 * `{code:"name_taken", message, conflicts}`; a 422 `{code, server, message}` (read `err.detail`).
 */
export async function importTools(
  servers: Record<string, ServerConfig>,
  onConflict: ImportConflictMode = "error",
): Promise<{ added: ToolItem[]; conflicts: string[] }> {
  const data = await apiRequest<unknown>("POST", "/api/tool-library/import", {
    servers,
    on_conflict: onConflict,
  });
  return {
    added: list(isRecord(data) ? data.added : null, parseTool),
    conflicts: strings(isRecord(data) ? data.conflicts : null),
  };
}

export interface SetAgentsResult {
  agents: UsageRow[];
  agent_count: number;
  team_count: number;
  skipped: { node_id: string; reason: string }[];
}

/** PUT /api/tool-library/{id}/agents — the full desired set; unchecking removes the reference. */
export async function setToolAgents(id: string, nodeIds: string[]): Promise<SetAgentsResult> {
  const data = await apiRequest<unknown>("PUT", `/api/tool-library/${enc(id)}/agents`, {
    node_ids: nodeIds,
  });
  const d = isRecord(data) ? data : {};
  return {
    agents: list(d.agents, parseUsageRow),
    agent_count: count(d.agent_count),
    team_count: count(d.team_count),
    skipped: list(d.skipped, (raw) =>
      isRecord(raw) && typeof raw.node_id === "string"
        ? { node_id: raw.node_id, reason: str(raw.reason) }
        : null,
    ),
  };
}

// ---- Agents (the "Turn on for…" picker) ----

export interface AgentChoice {
  node_id: string;
  role_name: string;
  title: string | null;
  kind: string;
  /** false = a thinker (the `thinker` tag). */
  edits_allowed: boolean;
  /** For a tool query: this agent effectively uses it. */
  enabled: boolean;
  /** An inline server (or skill) of the same name wins over the library one. */
  overridden: boolean;
}

export interface AgentTeam {
  team_id: string;
  team_name: string;
  agents: AgentChoice[];
}

function parseAgent(raw: unknown): AgentChoice | null {
  if (!isRecord(raw) || typeof raw.node_id !== "string") return null;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name, "Agent"),
    title: strOrNull(raw.title),
    kind: str(raw.kind, "agent"),
    edits_allowed: raw.edits_allowed !== false,
    enabled: raw.enabled === true,
    overridden: raw.overridden === true,
  };
}

/** GET /api/agents?tool_id= — teams oldest first, agents left → right. */
export async function listAgents(filter: { toolId?: string } = {}): Promise<AgentTeam[]> {
  const qs = filter.toolId ? `?tool_id=${enc(filter.toolId)}` : "";
  const data = await apiRequest<unknown>("GET", `/api/agents${qs}`);
  return list(isRecord(data) ? data.teams : null, (raw) =>
    isRecord(raw) && typeof raw.team_id === "string"
      ? {
          team_id: raw.team_id,
          team_name: str(raw.team_name),
          agents: list(raw.agents, parseAgent),
        }
      : null,
  );
}

// ---- Secrets ----

export interface SecretRef {
  id: string;
  name: string;
}

export interface SecretItem {
  name: string;
  created_at: string | null;
  updated_at: string | null;
  used_by_tools: SecretRef[];
}

export interface MissingSecret {
  name: string;
  used_by_tools: SecretRef[];
}

export interface SecretsList {
  secrets: SecretItem[];
  /** Names library tools reference with no stored value (a deleted-but-used secret too). */
  missing: MissingSecret[];
}

function parseSecretRef(raw: unknown): SecretRef | null {
  return isRecord(raw) && typeof raw.id === "string" && typeof raw.name === "string"
    ? { id: raw.id, name: raw.name }
    : null;
}

/** GET /api/secrets — no endpoint ever returns a value. */
export async function listSecrets(): Promise<SecretsList> {
  const data = await apiRequest<unknown>("GET", "/api/secrets");
  const d = isRecord(data) ? data : {};
  return {
    secrets: list(d.secrets, (raw) =>
      isRecord(raw) && typeof raw.name === "string"
        ? {
            name: raw.name,
            created_at: strOrNull(raw.created_at),
            updated_at: strOrNull(raw.updated_at),
            used_by_tools: list(raw.used_by_tools, parseSecretRef),
          }
        : null,
    ),
    missing: list(d.missing, (raw) =>
      isRecord(raw) && typeof raw.name === "string"
        ? { name: raw.name, used_by_tools: list(raw.used_by_tools, parseSecretRef) }
        : null,
    ),
  };
}

export interface SavedSecret {
  name: string;
  created_at: string | null;
  updated_at: string | null;
}

function parseSaved(data: unknown, name: string): SavedSecret {
  const d = isRecord(data) ? data : {};
  return {
    name: str(d.name, name),
    created_at: strOrNull(d.created_at),
    updated_at: strOrNull(d.updated_at),
  };
}

/** POST /api/secrets — create-only: 422 name rule (with a suggestion), 409 already exists. */
export async function createSecret(name: string, value: string): Promise<SavedSecret> {
  return parseSaved(await apiRequest<unknown>("POST", "/api/secrets", { name, value }), name);
}

/** PUT /api/secrets/{name} — replace the value (404 `No secret named <NAME>.`). */
export async function replaceSecret(name: string, value: string): Promise<SavedSecret> {
  return parseSaved(await apiRequest<unknown>("PUT", `/api/secrets/${enc(name)}`, { value }), name);
}

/** DELETE /api/secrets/{name} — idempotent (204). */
export async function deleteSecret(name: string): Promise<void> {
  await apiRequest<unknown>("DELETE", `/api/secrets/${enc(name)}`);
}

// ---- Toolkit summary (nav badges) ----

export interface ToolkitSummary {
  tools: number;
  tools_needing_attention: number;
  skills: number;
  memory: { inbox: number; active: number; archive: number };
  secrets_missing: number;
}

/** GET /api/toolkit/summary — the counts behind the Toolkit nav badges. */
export async function getToolkitSummary(): Promise<ToolkitSummary> {
  const data = await apiRequest<unknown>("GET", "/api/toolkit/summary");
  const d = isRecord(data) ? data : {};
  const memory = isRecord(d.memory) ? d.memory : {};
  return {
    tools: count(d.tools),
    tools_needing_attention: count(d.tools_needing_attention),
    skills: count(d.skills),
    memory: {
      inbox: count(memory.inbox),
      active: count(memory.active),
      archive: count(memory.archive),
    },
    secrets_missing: count(d.secrets_missing),
  };
}

// ---- GitHub App status ----

export interface GithubStatus {
  hosted: boolean;
  installed: boolean;
  installation_count: number;
  repo_count: number;
}

/** GET /api/github/status — install state and how many repos the App can reach. */
export async function getGithubStatus(): Promise<GithubStatus> {
  const data = await apiRequest<unknown>("GET", "/api/github/status");
  const d = isRecord(data) ? data : {};
  return {
    hosted: d.hosted === true,
    installed: d.installed === true,
    installation_count: count(d.installation_count),
    repo_count: count(d.repo_count),
  };
}

// ---- Catalog ----

export interface CatalogEntry {
  key: string;
  name: string;
  title: string;
  description: string;
  access: string;
  secret_names: string[];
  badge: string;
  attachable: boolean;
  server_config: ServerConfig;
}

/** GET /api/tool-catalog — the public built-in catalog, in API order. */
export async function listToolCatalog(): Promise<CatalogEntry[]> {
  const data = await apiRequest<unknown>("GET", "/api/tool-catalog");
  return list(isRecord(data) ? data.tools : null, (raw) =>
    isRecord(raw) && typeof raw.key === "string"
      ? {
          key: raw.key,
          name: str(raw.name, raw.key),
          title: str(raw.title, raw.key),
          description: str(raw.description),
          access: str(raw.access, "free"),
          secret_names: strings(raw.secret_names),
          badge: str(raw.badge),
          attachable: raw.attachable === true,
          server_config: isRecord(raw.server_config) ? raw.server_config : {},
        }
      : null,
  );
}
