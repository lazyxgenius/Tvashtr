/** Copy helpers for the Tools screens (plurals, "Used by", status labels, sorting). */
import type { ToolItem } from "../../lib/api/tools";
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
