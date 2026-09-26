/** Copy helpers for the Tools screens (plurals, "Used by", status labels, agent names, sorting). */
import type { ToolItem, UsageRow } from "../../lib/api/tools";
import { titleCase } from "../../lib/text";
import { joinNames } from "../secrets/secretFormat";
import type { StatusFilter } from "./toolsState";

/** "1 agent", "3 agents". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "2 agents · 1 team", or "Not used yet". */
export function usedByLabel(usedBy: ToolItem["used_by"]): string {
  if (usedBy.agent_count === 0) return "Not used yet";
  return `${plural(usedBy.agent_count, "agent")} · ${plural(usedBy.team_count, "team")}`;
}

// The seeded roles' display names; any other role is title-cased ("prd_gate" → "Prd gate").
const ROLE_TITLES: Record<string, string> = { pm: "Product manager" };

/** An agent's display name: its own title when it has one, else its role ("Engineer"). */
export function agentName(row: Pick<UsageRow, "role_name" | "title">): string {
  const title = row.title?.trim();
  return title || ROLE_TITLES[row.role_name] || titleCase(row.role_name);
}

/** The distinct agent names of some usage rows, in order ("Engineer", "Reviewer", "Writer"). */
export function agentNames(rows: Pick<UsageRow, "role_name" | "title">[]): string[] {
  return [...new Set(rows.map(agentName))];
}

/**
 * A tool that needs attention: "Needs LINEAR_TOKEN" for one missing secret, "Needs 2 secrets" for
 * more (spec Q3), and "Needs a command or URL" when the config can't connect (Q15).
 */
export function needsLabel(tool: ToolItem): string {
  const missing = tool.missing_secrets;
  if (missing.length === 1) return `Needs ${missing[0]}`;
  if (missing.length > 1) return `Needs ${missing.length} secrets`;
  return "Needs a command or URL";
}

/** Rows created during this visit first (newest first), then A→Z by name. */
export function sortTools(tools: ToolItem[], freshIds: string[]): ToolItem[] {
  const rank = (t: ToolItem) => {
    const i = freshIds.indexOf(t.id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...tools].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** The rows the search words (name, case-insensitive) and the Status filter keep, in order. */
export function filterTools(tools: ToolItem[], query: string, status: StatusFilter): ToolItem[] {
  const q = query.trim().toLowerCase();
  return tools.filter(
    (t) =>
      (q === "" || t.name.toLowerCase().includes(q)) && (status === "all" || t.status === status),
  );
}

/** "Engineer and Reviewer in Indicator sprint team, Writer in Docs team" — teams in order met. */
function agentsByTeam(rows: UsageRow[]): string {
  const teams = new Map<string, { name: string; rows: UsageRow[] }>();
  for (const row of rows) {
    const team = teams.get(row.team_id) ?? { name: row.team_name, rows: [] };
    team.rows.push(row);
    teams.set(row.team_id, team);
  }
  return [...teams.values()].map((t) => `${joinNames(agentNames(t.rows))} in ${t.name}`).join(", ");
}

/**
 * TOOL-49: the Remove confirmation's impact sentence, from the tool's `used_by_agents` — or, when
 * those couldn't load, from its counts alone.
 */
export function removeImpact(usedBy: ToolItem["used_by"], agents: UsageRow[] | null): string {
  const rows = agents ?? [];
  const agentCount = agents ? rows.length : usedBy.agent_count;
  const teamCount = agents ? new Set(rows.map((r) => r.team_id)).size : usedBy.team_count;
  if (agentCount === 0) return "No agents use it.";
  const who = `${plural(agentCount, "agent")} in ${plural(teamCount, "team")} ${agentCount === 1 ? "uses" : "use"} it`;
  const tail =
    agentCount === 1 ? "It loses it on its next run." : "They lose it on their next run.";
  return rows.length > 0 ? `${who}: ${agentsByTeam(rows)}. ${tail}` : `${who}. ${tail}`;
}

/**
 * TOOL-68: after a tool's missing secrets were saved from its row — "LINEAR_TOKEN saved. linear is
 * ready.", or what it still needs; just "<NAMES> saved." when the list couldn't be re-read.
 */
export function toolSecretsSavedToast(
  names: string[],
  toolName: string,
  after: ToolItem | null | undefined,
): string {
  const saved = `${joinNames(names)} saved.`;
  if (!after) return saved;
  if (after.status === "ready") return `${saved} ${toolName} is ready.`;
  const still = after.missing_secrets;
  if (still.length === 0) return saved;
  return `${saved} ${toolName} still needs ${joinNames(still)}.`;
}

/** The toast after "Turn on for N agents" from a row's ⋯ (not drawn). */
export function turnedOnToast(toolName: string, agentCount: number, skipped: number): string {
  const head =
    agentCount > 0
      ? `${toolName} is on for ${plural(agentCount, "agent")}.`
      : `${toolName} is off for every agent.`;
  if (skipped === 0) return head;
  return `${head} ${plural(skipped, "agent")} kept ${skipped === 1 ? "its" : "their"} own ${toolName} server.`;
}

/** TOOL-22: after "Add" on a catalog card (its title, e.g. "Web fetch"). */
export function catalogAddedToast(title: string): string {
  return `${title} added. Turn it on for an agent in its Skills & tools tab.`;
}

/** TOOL-25: back from GitHub with the App installed or its repos changed. */
export function githubInstalledToast(repoCount: number): string {
  return `GitHub App installed on ${plural(repoCount, "repo")}.`;
}
