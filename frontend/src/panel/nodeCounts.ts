import { connectorsOf } from "./tools/nodeTools";

/** The Skills & tools tab count (spec Q1): skill sources + tool servers (inline and library) +
 *  connector grants (the ones the checklist reads). The rules-files and Domains switches don't
 *  count. */
export function skillsAndToolsCount(
  skills: unknown[] | null,
  toolConfig: Record<string, unknown> | null,
): number {
  const rec = (v: unknown): Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const skillCount = (skills ?? []).filter(
    (s) => rec(s).type !== "project_rules" && rec(s).type !== undefined,
  ).length;
  const inline = Object.keys(rec(rec(toolConfig).mcpServers)).length;
  const { library } = rec(rec(toolConfig).tvashtr);
  const libraryCount = Array.isArray(library) ? library.length : 0;
  return skillCount + inline + libraryCount + connectorsOf(toolConfig).length;
}
