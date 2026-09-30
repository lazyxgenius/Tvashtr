/**
 * Connectors API (contract: `docs/superpowers/plans/api/connectors.md`): the catalog, connections
 * (connect, read, change, check, scope options, disconnect), the OAuth sign-in start, the agents
 * that have a connection, and the `connectors` block a run's round carries.
 *
 * Every answer is validated here, at the boundary. A list entry with an unexpected shape is
 * dropped or given a safe default; a call whose whole answer can't be read throws. Errors throw
 * `ApiDetailError` (`message` = the server's copy; `connectorRefusal` reads a `{code, …}` detail).
 */
import { reportFetchOk } from "../backendStatus";
import { count, httpsOrNull, isRecord, type Json, list, str, strOrNull } from "./roundConnectors";
import { ApiDetailError, apiRequest } from "./runs";

// The round block lives in a module that imports nothing, so `lib/api.ts` can use it (see there).
export { type ConnectorCall, parseRoundConnectors, type RoundConnectors } from "./roundConnectors";

// ---- Small validators (the rest are in `./roundConnectors`) ----

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return allowed.includes(v as T) ? (v as T) : null;
}
const enc = encodeURIComponent;
const unreadable = (what: string) => new Error(`The server sent ${what} we couldn’t read.`);

// ---- Shapes ----

export type ConnectorAccess = "read" | "write";
export type ConnectorAuth = "oauth" | "api_key" | "none";
export type ConnectionStatus = "connected" | "needs_signin" | "pending";
export type ReadOnlyBy = "provider" | "scopes" | "annotations";

const ACCESS = ["read", "write"] as const;
const AUTH_KINDS = ["oauth", "api_key", "none"] as const;
const STATUSES = ["connected", "needs_signin", "pending"] as const;
const READ_ONLY_BY = ["provider", "scopes", "annotations"] as const;

export interface KeyField {
  /** The header name. */
  id: string;
  label: string;
  hint: string;
  secret: boolean;
}

export interface ScopePicker {
  param: string;
  label: string;
}

export interface ConnectorScope {
  value: string;
  label: string;
}

/** Something you can connect: Featured, from the MCP Registry, or a custom address. */
export interface CatalogEntry {
  key: string;
  name: string;
  publisher: string | null;
  featured: boolean;
  /** `true` only for Featured; the rest are "From the MCP Registry · not reviewed by Tvashtr". */
  reviewed: boolean;
  category: string | null;
  description: string;
  website: string | null;
  host: string;
  auth: ConnectorAuth | "unknown";
  key_fields: KeyField[];
  access_modes: ConnectorAccess[];
  read_only_by: ReadOnlyBy;
  scope_picker: ScopePicker | null;
  available: boolean;
  unavailable_reason: string | null;
  /** This account's connection to it, if any (`pending` rows are reported as null). */
  connection_id: string | null;
  connection_status: ConnectionStatus | null;
}

export interface ConnectorTool {
  name: string;
  title: string | null;
  /** Tvashtr counts the tool as a write. */
  write: boolean;
  /** Agents can call it at this connection's access. */
  on: boolean;
}

/** One agent that has a connection, with its effective access. */
export interface ConnectorUsageRow {
  node_id: string;
  role_name: string;
  title: string | null;
  team_id: string;
  team_name: string;
  access: ConnectorAccess;
}

export interface Connection {
  id: string;
  connector_key: string;
  name: string;
  slug: string;
  publisher: string | null;
  featured: boolean;
  reviewed: boolean;
  category: string | null;
  host: string;
  auth_kind: ConnectorAuth;
  /** What "Replace key" asks for (empty unless it takes a key). */
  key_fields: KeyField[];
  /** Where the browser is sent to sign in (null for a key or no sign-in). */
  signin_host: string | null;
  signin_host_differs: boolean;
  access: ConnectorAccess;
  access_modes: ConnectorAccess[];
  read_only_by: ReadOnlyBy;
  scope: ConnectorScope | null;
  scope_picker: ScopePicker | null;
  status: ConnectionStatus;
  /** A sign-in was started and hasn't finished or timed out. Poll until it turns false. */
  signin_pending: boolean;
  last_error: string | null;
  /** Null until the first successful tool listing. */
  tools: ConnectorTool[] | null;
  used_by: { agent_count: number; team_count: number };
  /** On list rows only when `status` is `needs_signin`; always on one connection. */
  used_by_agents: ConnectorUsageRow[] | null;
  connected_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecentUse {
  run_id: string;
  run_number: number | null;
  agent: string;
  reads: number;
  writes: number;
  at: string | null;
}

export interface ConnectionDetail extends Connection {
  used_by_agents: ConnectorUsageRow[];
  recent_use: RecentUse[];
  revoke_hint: string | null;
}

export interface CatalogPage {
  items: CatalogEntry[];
  total: number;
  next_offset: number | null;
  categories: string[];
}

export interface ScopeOption {
  value: string;
  label: string;
  detail: string | null;
}

export interface ScopeOptions {
  param: string;
  label: string;
  /** The provider's list couldn't be read: ask for the id in a text field. */
  manual: boolean;
  options: ScopeOption[];
}

export interface SignInStart {
  authorize_url: string;
  signin_host: string;
  expires_in: number;
}

export interface ConnectorAgent {
  node_id: string;
  role_name: string;
  title: string | null;
  kind: string;
  edits_allowed: boolean;
  /** Has the grant. */
  enabled: boolean;
  /** The grant's access (null when not enabled). */
  access: ConnectorAccess | null;
  /** Runs on a connected Desktop plan (connectors don't reach it yet). */
  subscription: "claude" | "grok" | null;
}

export interface ConnectorAgentsByTeam {
  team_id: string;
  team_name: string;
  agents: ConnectorAgent[];
}

export interface ConnectorAgentsSaved {
  agents: ConnectorUsageRow[];
  agent_count: number;
  team_count: number;
}

/** A `{code, message, …}` refusal from a connectors route. */
export interface ConnectorRefusal {
  code: string;
  message: string;
  /** `already_connected`: the connection that exists. */
  connection_id: string | null;
  /** `key_required`: the fields to ask for. */
  fields: KeyField[];
}

// ---- Parsers ----

function parseKeyField(raw: unknown): KeyField | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    label: str(raw.label, raw.id),
    hint: str(raw.hint),
    secret: raw.secret !== false,
  };
}

function parsePicker(raw: unknown): ScopePicker | null {
  if (!isRecord(raw) || typeof raw.param !== "string") return null;
  return { param: raw.param, label: str(raw.label, "Project") };
}

function parseAccessModes(raw: unknown): ConnectorAccess[] {
  const modes = strings(raw).filter((m): m is ConnectorAccess => oneOf(m, ACCESS) !== null);
  return modes.length > 0 ? modes : ["read", "write"];
}

export function parseCatalogEntry(raw: unknown): CatalogEntry | null {
  if (!isRecord(raw) || typeof raw.key !== "string" || typeof raw.name !== "string") return null;
  return {
    key: raw.key,
    name: raw.name,
    publisher: strOrNull(raw.publisher),
    featured: raw.featured === true,
    reviewed: raw.reviewed === true,
    category: strOrNull(raw.category),
    description: str(raw.description),
    website: httpsOrNull(raw.website),
    host: str(raw.host),
    auth: oneOf(raw.auth, AUTH_KINDS) ?? "unknown",
    key_fields: list(raw.key_fields, parseKeyField),
    access_modes: parseAccessModes(raw.access_modes),
    read_only_by: oneOf(raw.read_only_by, READ_ONLY_BY) ?? "annotations",
    scope_picker: parsePicker(raw.scope_picker),
    available: raw.available !== false,
    unavailable_reason: strOrNull(raw.unavailable_reason),
    connection_id: strOrNull(raw.connection_id),
    connection_status: oneOf(raw.connection_status, STATUSES),
  };
}

function parseUsageRow(raw: unknown): ConnectorUsageRow | null {
  if (!isRecord(raw) || typeof raw.node_id !== "string") return null;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name, "Agent"),
    title: strOrNull(raw.title),
    team_id: str(raw.team_id),
    team_name: str(raw.team_name),
    access: oneOf(raw.access, ACCESS) ?? "read",
  };
}

function parseTool(raw: unknown): ConnectorTool | null {
  if (!isRecord(raw) || typeof raw.name !== "string") return null;
  // An unreadable flag counts as a write that is off: never show a tool as safer than it is.
  return {
    name: raw.name,
    title: strOrNull(raw.title),
    write: raw.write !== false,
    on: raw.on === true,
  };
}

export function parseConnection(raw: unknown): Connection | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const status = oneOf(raw.status, STATUSES);
  if (status === null) return null;
  const usedBy = isRecord(raw.used_by) ? raw.used_by : {};
  const scope = isRecord(raw.scope) && typeof raw.scope.value === "string" ? raw.scope : null;
  return {
    id: raw.id,
    connector_key: str(raw.connector_key),
    name: str(raw.name, "Connector"),
    slug: str(raw.slug),
    publisher: strOrNull(raw.publisher),
    featured: raw.featured === true,
    reviewed: raw.reviewed === true,
    category: strOrNull(raw.category),
    host: str(raw.host),
    auth_kind: oneOf(raw.auth_kind, AUTH_KINDS) ?? "none",
    key_fields: list(raw.key_fields, parseKeyField),
    signin_host: strOrNull(raw.signin_host),
    signin_host_differs: raw.signin_host_differs === true,
    access: oneOf(raw.access, ACCESS) ?? "read",
    access_modes: parseAccessModes(raw.access_modes),
    read_only_by: oneOf(raw.read_only_by, READ_ONLY_BY) ?? "annotations",
    scope: scope
      ? { value: scope.value as string, label: str(scope.label, scope.value as string) }
      : null,
    scope_picker: parsePicker(raw.scope_picker),
    status,
    signin_pending: raw.signin_pending === true,
    last_error: strOrNull(raw.last_error),
    tools: Array.isArray(raw.tools) ? list(raw.tools, parseTool) : null,
    used_by: { agent_count: count(usedBy.agent_count), team_count: count(usedBy.team_count) },
    used_by_agents: Array.isArray(raw.used_by_agents)
      ? list(raw.used_by_agents, parseUsageRow)
      : null,
    connected_at: strOrNull(raw.connected_at),
    created_at: strOrNull(raw.created_at),
    updated_at: strOrNull(raw.updated_at),
  };
}

function connectionOrThrow(raw: unknown): Connection {
  const parsed = parseConnection(raw);
  if (!parsed) throw unreadable("a connector");
  return parsed;
}

function parseRecentUse(raw: unknown): RecentUse | null {
  if (!isRecord(raw) || typeof raw.run_id !== "string") return null;
  return {
    run_id: raw.run_id,
    run_number: typeof raw.run_number === "number" ? raw.run_number : null,
    agent: str(raw.agent, "Agent"),
    reads: count(raw.reads),
    writes: count(raw.writes),
    at: strOrNull(raw.at),
  };
}

function parseAgent(raw: unknown): ConnectorAgent | null {
  if (!isRecord(raw) || typeof raw.node_id !== "string") return null;
  const enabled = raw.enabled === true;
  return {
    node_id: raw.node_id,
    role_name: str(raw.role_name, "Agent"),
    title: strOrNull(raw.title),
    kind: str(raw.kind, "agent"),
    edits_allowed: raw.edits_allowed === true,
    enabled,
    access: enabled ? (oneOf(raw.access, ACCESS) ?? "read") : null,
    subscription: oneOf(raw.subscription, ["claude", "grok"] as const),
  };
}

/** The `{code, message, …}` detail of a connectors refusal, or null for any other error. */
export function connectorRefusal(e: unknown): ConnectorRefusal | null {
  if (!(e instanceof ApiDetailError) || !isRecord(e.detail)) return null;
  const detail = e.detail;
  if (typeof detail.code !== "string") return null;
  return {
    code: detail.code,
    message: str(detail.message, e.message),
    connection_id: strOrNull(detail.connection_id),
    fields: list(detail.fields, parseKeyField),
  };
}

// ---- Calls ----

/**
 * `apiRequest`, except that the app's own 502 (`unreachable`, `refused`: it answered, the provider
 * didn't) is not reported as "can't reach the backend". A bare gateway 502 still is.
 */
async function request(method: string, path: string, body?: unknown): Promise<unknown> {
  try {
    return await apiRequest<unknown>(method, path, body);
  } catch (e) {
    if (e instanceof ApiDetailError && e.status === 502 && connectorRefusal(e)) reportFetchOk();
    throw e;
  }
}

/** GET /api/connectors/catalog — Featured first, then registry entries by name. */
export async function listCatalog(
  query: { q?: string; category?: string; offset?: number; limit?: number } = {},
): Promise<CatalogPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.offset) params.set("offset", String(query.offset));
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  const data = await request("GET", `/api/connectors/catalog${qs ? `?${qs}` : ""}`);
  if (!isRecord(data)) throw unreadable("a catalog");
  const items = list(data.items, parseCatalogEntry);
  return {
    items,
    total: Math.max(count(data.total), items.length),
    next_offset: typeof data.next_offset === "number" ? data.next_offset : null,
    categories: strings(data.categories),
  };
}

/** GET /api/connectors — oldest first; `pending` rows are left out. */
export async function listConnections(): Promise<Connection[]> {
  const data = await request("GET", "/api/connectors");
  return list(isRecord(data) ? data.connections : null, parseConnection);
}

export type NewConnection =
  | { key: string; access?: ConnectorAccess; credentials?: Record<string, string> }
  | { url: string; name: string; access?: ConnectorAccess };

/** POST /api/connectors — a `pending` answer means: call `startSignIn` next. */
export async function createConnection(body: NewConnection): Promise<Connection> {
  return connectionOrThrow(await request("POST", "/api/connectors", body));
}

/** GET /api/connectors/{id} — the connection plus who uses it. 404 `Connector not found.` */
export async function getConnection(id: string): Promise<ConnectionDetail> {
  const data = await request("GET", `/api/connectors/${enc(id)}`);
  const base = connectionOrThrow(data);
  const d = data as Json;
  return {
    ...base,
    used_by_agents: base.used_by_agents ?? [],
    recent_use: list(d.recent_use, parseRecentUse),
    revoke_hint: strOrNull(d.revoke_hint),
  };
}

export interface ConnectionPatch {
  access?: ConnectorAccess;
  /** `null` = the whole account. */
  scope?: ConnectorScope | null;
  name?: string;
  /** `api_key` connections only: replaces the key. */
  credentials?: Record<string, string>;
}

/** PATCH /api/connectors/{id}. */
export async function updateConnection(id: string, patch: ConnectionPatch): Promise<Connection> {
  return connectionOrThrow(await request("PATCH", `/api/connectors/${enc(id)}`, patch));
}

/** DELETE /api/connectors/{id} — also removes it from every agent that had it. */
export async function deleteConnection(
  id: string,
): Promise<{ removed_from_agents: number; revoked: boolean }> {
  const data = await request("DELETE", `/api/connectors/${enc(id)}`);
  if (!isRecord(data)) throw unreadable("an answer");
  return { removed_from_agents: count(data.removed_from_agents), revoked: data.revoked === true };
}

/** POST /api/connectors/{id}/check — re-lists the tools; an expired sign-in answers
 *  `needs_signin` (200), a provider that didn't answer throws (502 `unreachable` | `refused`). */
export async function checkConnection(id: string): Promise<Connection> {
  return connectionOrThrow(await request("POST", `/api/connectors/${enc(id)}/check`));
}

/** GET /api/connectors/{id}/scope-options — the provider's projects to pick from. */
export async function getScopeOptions(id: string): Promise<ScopeOptions> {
  const data = await request("GET", `/api/connectors/${enc(id)}/scope-options`);
  if (!isRecord(data)) throw unreadable("a project list");
  return {
    param: str(data.param),
    label: str(data.label, "Project"),
    manual: data.manual === true,
    options: list(data.options, (raw) =>
      isRecord(raw) && typeof raw.value === "string"
        ? { value: raw.value, label: str(raw.label, raw.value), detail: strOrNull(raw.detail) }
        : null,
    ),
  };
}

/** POST /api/connectors/{id}/oauth/start — where to send the browser to sign in. */
export async function startSignIn(id: string): Promise<SignInStart> {
  const data = await request("POST", `/api/connectors/${enc(id)}/oauth/start`);
  const url = isRecord(data) ? data.authorize_url : null;
  const unusable = new Error("The server sent a sign-in address we couldn’t use.");
  // The address is opened in a window: anything but http(s) is refused here, at the boundary.
  if (typeof url !== "string" || !/^https?:\/\/[^\s/]+/i.test(url)) throw unusable;
  // The host that is shown must be the host the window opens, and that is what the browser
  // reads out of the address, not what the server says (the two differ on `https://a\@b/`).
  let opened: URL;
  try {
    opened = new URL(url);
  } catch {
    throw unusable;
  }
  const host = opened.hostname.replace(/^\[|\]$/g, ""); // an IPv6 host, without its brackets
  const d = data as Json;
  const signinHost = str(d.signin_host, host).toLowerCase();
  if (opened.username || opened.password || signinHost !== host) throw unusable;
  return { authorize_url: url, signin_host: host, expires_in: count(d.expires_in) };
}

/** GET /api/connectors/{id}/agents — library teams oldest first, agents left to right. */
export async function listConnectorAgents(id: string): Promise<ConnectorAgentsByTeam[]> {
  const data = await request("GET", `/api/connectors/${enc(id)}/agents`);
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

/** PUT /api/connectors/{id}/agents — `nodeIds` is the full set that should have it afterwards. */
export async function setConnectorAgents(
  id: string,
  nodeIds: string[],
): Promise<ConnectorAgentsSaved> {
  const data = await request("PUT", `/api/connectors/${enc(id)}/agents`, { node_ids: nodeIds });
  if (!isRecord(data)) throw unreadable("an answer");
  const agents = list(data.agents, parseUsageRow);
  return {
    agents,
    agent_count: Math.max(count(data.agent_count), agents.length),
    team_count: count(data.team_count),
  };
}
