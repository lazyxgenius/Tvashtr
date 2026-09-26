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

// ---- Add tool wizard (TkF-AddTool-*) ----

/** The sheet's subtitle: "Step 1 of 3", then "linear · step 2 of 3" (TOOL-30). */
export function wizardSubtitle(step: number, name: string): string {
  return step === 0 || !name ? `Step ${step + 1} of 3` : `${name} · step ${step + 1} of 3`;
}

/** Step 3's opening line (TOOL-41, spec Q14 for names that already have a value). */
export function secretsLede(toolName: string, total: number, unset: number): string {
  if (total === 0) return `${toolName} uses no secrets.`;
  const uses = total === 1 ? "one secret" : `${total} secrets`;
  if (unset === 0) return `${toolName} uses ${uses} (${total === 1 ? "already set" : "all set"}).`;
  const what =
    unset < total
      ? unset === 1
        ? "the missing value"
        : "the missing values"
      : total === 1
        ? "its value"
        : "their values";
  return `${toolName} uses ${uses}. Add ${what} now or later in Secrets.`;
}

/** The "Switch it on for agents now" row's sub-line once agents are chosen (held until Add tool). */
export function heldAgentsLine(names: string[]): string {
  if (names.length === 0) return "You can also do this later, per agent.";
  const who = names.length <= 2 ? joinNames(names) : plural(names.length, "agent");
  return `Turns on for ${who} when you add it.`;
}

/**
 * TOOL-44: "linear added and turned on for Reviewer." (one agent: its row, for the "Open Reviewer"
 * action), "… for N agents.", or "linear added." when none were chosen.
 */
export function toolAddedToast(
  toolName: string,
  turnedOn: { agents: UsageRow[]; agent_count: number; skipped: unknown[] } | null,
): { message: string; agent: UsageRow | null } {
  if (!turnedOn || turnedOn.agent_count === 0) {
    const skipped = turnedOn?.skipped.length ?? 0;
    const tail = skipped
      ? ` ${plural(skipped, "agent")} kept ${skipped === 1 ? "its" : "their"} own ${toolName} server.`
      : "";
    return { message: `${toolName} added.${tail}`, agent: null };
  }
  if (turnedOn.agent_count === 1 && turnedOn.agents.length === 1) {
    const agent = turnedOn.agents[0];
    return { message: `${toolName} added and turned on for ${agentName(agent)}.`, agent };
  }
  return {
    message: `${toolName} added and turned on for ${plural(turnedOn.agent_count, "agent")}.`,
    agent: null,
  };
}

/** Which submit step failed (TOOL-43): a secret, or the tool itself; `saved` = secrets already stored. */
export function addFailedMessage(
  failed: { secret: string } | { tool: string },
  reason: string | null,
  saved: string[],
): string {
  const head =
    "secret" in failed
      ? reason
        ? `Couldn’t save ${failed.secret}: ${reason}`
        : `Couldn’t save ${failed.secret}. Try again.`
      : reason
        ? `Couldn’t add ${failed.tool}: ${reason}`
        : `Couldn’t add ${failed.tool}. Try again.`;
  const kept = saved.length
    ? ` ${joinNames(saved)} ${saved.length === 1 ? "is" : "are"} saved.`
    : "";
  const notYet = "secret" in failed ? " The tool isn’t added yet." : "";
  return `${head}${kept}${notYet}`;
}

/** The tool was created but PUT …/agents failed (TOOL-43, step 3 of the submit). */
export function agentsFailedToast(toolName: string): string {
  return `${toolName} added, but it couldn’t be turned on for your agents. Use Turn on for agents… in its ⋯ menu.`;
}

// ---- Paste mcp.json (TOOL-62..65) ----

/** The primary button: "Add 2 servers", "Add 1 server", or "Add servers" when none is chosen. */
export function addServersLabel(checked: number): string {
  return checked === 0 ? "Add servers" : `Add ${plural(checked, "server")}`;
}

/** The checklist's heading: "2 servers found". */
export function serversFoundLabel(found: number): string {
  return `${plural(found, "server")} found`;
}

/**
 * The toast after adding: "2 servers added. linear needs a secret." (TOOL-65). `needs` are the
 * added tools still missing a secret: one gets its "Add secret" action; more send you to Secrets.
 */
export function pastedToast(added: ToolItem[]): { message: string; needs: ToolItem[] } {
  const needs = added.filter((t) => t.missing_secrets.length > 0);
  let message = `${plural(added.length, "server")} added.`;
  if (needs.length === 1) {
    const [tool] = needs;
    const n = tool.missing_secrets.length;
    message += ` ${tool.name} needs ${n === 1 ? "a secret" : `${n} secrets`}.`;
  } else if (needs.length > 1) {
    message += ` ${joinNames(needs.map((t) => t.name))} need secrets.`;
  }
  return { message, needs };
}

// ---- The tool page (Toolkit-ToolDetail, TkF-Detail-*) ----

/** "Used by 3 agents in 2 teams" (TOOL-59), or "Not used yet". */
export function usedByTitle(agents: UsageRow[]): string {
  if (agents.length === 0) return "Not used yet";
  const teams = new Set(agents.map((a) => a.team_id)).size;
  return `Used by ${plural(agents.length, "agent")} in ${plural(teams, "team")}`;
}

/** TOOL-57: "Saved. 3 agents use the new settings on their next run.", or "Saved." when none do. */
export function savedToast(agentCount: number): string {
  if (agentCount === 0) return "Saved.";
  if (agentCount === 1) return "Saved. 1 agent uses the new settings on its next run.";
  return `Saved. ${agentCount} agents use the new settings on their next run.`;
}

/** TOOL-58, the Remove card: "The 3 agents above lose it on their next run." */
export function removeCardLine(agentCount: number): string {
  if (agentCount === 0) return "No agents use it.";
  if (agentCount === 1) return "The agent above loses it on its next run.";
  return `The ${agentCount} agents above lose it on their next run.`;
}

/**
 * TOOL-58, the tool page's Remove confirmation: "Engineer, Reviewer and Writer lose it on their next
 * run. You can add it again later." Agents that share a name are told apart by team.
 */
export function pageRemoveImpact(agents: UsageRow[]): string {
  const again = "You can add it again later.";
  if (agents.length === 0) return `No agents use it. ${again}`;
  const names = agents.map(agentName);
  const clash = new Set(names).size < names.length;
  const who = joinNames(clash ? agents.map((a) => `${agentName(a)} in ${a.team_name}`) : names);
  return agents.length === 1
    ? `${who} loses it on its next run. ${again}`
    : `${who} lose it on their next run. ${again}`;
}
