/** Copy helpers for the Tools screens (plurals, "Used by", status labels, agent names, sorting). */
import type { ToolItem, UsageRow } from "../../lib/api/tools";
import { titleCase } from "../../lib/text";
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
