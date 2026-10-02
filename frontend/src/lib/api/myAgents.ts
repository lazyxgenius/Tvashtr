/**
 * M6 — my agents and recent tasks (`docs/superpowers/plans/api/my-agents.md`, ruling R4): save an
 * agent as my agent, use one on a node (with Undo), detach, update a team that is behind, and Home's
 * Recent tasks. Every word (the toasts' text) is made server-side.
 */
import type { TeamGraphNode } from "../api";
import { apiRequest } from "./runs";

/** The parts a saved version holds (memories only when asked). */
export type AgentPart = "instructions" | "model" | "skills_tools" | "file_access" | "memories";

export interface SavedAgentVersion {
  number: number;
  created_at: string;
  included: AgentPart[];
}

/** A team that uses a saved agent (with its lowest version there). */
export interface SavedAgentTeam {
  team_id: string;
  team_name: string;
  version: number;
  node_ids?: string[];
}

export interface SavedAgent {
  id: string;
  name: string;
  purpose: string;
  latest: number;
  updated_at: string;
  /** The role label of the agent it was saved from ("Reviewer"). */
  built_on: string;
  model: string | null;
  skills: number;
  tools: number;
  file_access: string | null;
  versions: SavedAgentVersion[];
  used_in: SavedAgentTeam[];
  /** Teams on an older version than `latest`. */
  behind: SavedAgentTeam[];
}

/** A node made from a saved agent carries this in its config. */
export interface BasedOn {
  id: string;
  name: string;
  version: number;
}

/** What use-agent / update-team replaced; Undo sends it back. */
export type AgentParts = Record<string, unknown>;

export interface RecentTask {
  task: string;
  team: { id: string; name: string };
  status: string;
  status_group: string;
  run_id: string;
  number: number | null;
  created_at: string;
}

const listOf = <T>(body: unknown, key: string): T[] => {
  const v = (body as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as T[]) : [];
};

/** The node's `config.based_on`, or null. */
export function basedOnOf(config: unknown): BasedOn | null {
  const b = (config as { based_on?: unknown } | null)?.based_on as Partial<BasedOn> | undefined;
  if (!b || typeof b.name !== "string" || typeof b.version !== "number") return null;
  return { id: typeof b.id === "string" ? b.id : "", name: b.name, version: b.version };
}

/** The account's saved agents, newest first. */
export async function listMyAgents(): Promise<SavedAgent[]> {
  return listOf<SavedAgent>(await apiRequest("GET", "/api/my-agents"), "agents");
}

/** Save as my agent: a new name makes v1, a name the account has makes its next version. */
export function saveMyAgent(body: {
  team_id: string;
  node_id: string;
  name: string;
  purpose: string;
  include: AgentPart[];
}): Promise<{ agent: SavedAgent; version: number; created: boolean }> {
  return apiRequest("POST", "/api/my-agents", body);
}

const agent = (id: string) => `/api/my-agents/${encodeURIComponent(id)}`;
const node = (teamId: string, nodeId: string) =>
  `/api/teams/${encodeURIComponent(teamId)}/nodes/${encodeURIComponent(nodeId)}`;

export function renameMyAgent(
  id: string,
  body: { name?: string; purpose?: string },
): Promise<SavedAgent> {
  return apiRequest("PATCH", agent(id), body);
}

export function deleteMyAgent(id: string): Promise<null> {
  return apiRequest("DELETE", agent(id));
}

/** R4: applies at once; `before` is what Undo puts back. */
export function applyAgentToNode(
  teamId: string,
  nodeId: string,
  agentId: string,
): Promise<{ node: TeamGraphNode; before: AgentParts; text: string }> {
  return apiRequest("POST", `${node(teamId, nodeId)}/use-agent`, { agent_id: agentId });
}

export function undoAgent(
  teamId: string,
  nodeId: string,
  before: AgentParts,
): Promise<TeamGraphNode> {
  return apiRequest("POST", `${node(teamId, nodeId)}/undo-agent`, { before });
}

export function detachAgent(teamId: string, nodeId: string): Promise<TeamGraphNode> {
  return apiRequest("POST", `${node(teamId, nodeId)}/detach-agent`);
}

/** "Update Bugfix squad": every agent of that team on an older version moves to the latest. */
export function updateTeamAgent(
  agentId: string,
  teamId: string,
): Promise<{ updated: { node_id: string; before: AgentParts }[]; text: string }> {
  return apiRequest("POST", `${agent(agentId)}/update-team`, { team_id: teamId });
}

/** "Use in a team": a new agent made from the latest version, placed on that team's canvas. */
export function addAgentToTeam(
  agentId: string,
  teamId: string,
): Promise<{ team_id: string; node_id: string }> {
  return apiRequest("POST", `${agent(agentId)}/use-in-team`, { team_id: teamId });
}

/** Home › Recent tasks: newest first, one per task text. */
export async function listRecentTasks(q: string, limit = 6): Promise<RecentTask[]> {
  const qs = new URLSearchParams({ q, limit: String(limit) });
  return listOf<RecentTask>(await apiRequest("GET", `/api/recent-tasks?${qs}`), "tasks");
}
