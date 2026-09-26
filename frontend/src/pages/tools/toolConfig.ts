/**
 * Pure helpers over an MCP server config (`{command,args,env}` = Local, `{url,headers,type?}` =
 * Remote): which kind it is, the "Runs" line the list shows, the `${NAME}` secret references, and
 * the guided form → config builder the wizard and detail page share (moved from the old
 * ToolsShelf with its tests).
 */
import type { ServerConfig } from "../../lib/api/tools";

/** A `${NAME}` secret reference (the runtime substitutes these in env / headers values only). */
export const SECRET_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export type Transport = "local" | "remote";

/** Local when the config has a command, Remote when it has a URL (null when it has neither). */
export function transportOf(config: ServerConfig): Transport | null {
  if (typeof config.command === "string" && config.command.trim()) return "local";
  if (typeof config.url === "string" && config.url.trim()) return "remote";
  return null;
}

/**
 * The list's "Runs" cell: a Local tool's command and arguments (`uvx mcp-server-fetch`), a Remote
 * tool's URL without its scheme and trailing slash (`api.githubcopilot.com/mcp`).
 */
export function runsLabel(config: ServerConfig): string {
  const kind = transportOf(config);
  if (kind === "local") {
    const args = Array.isArray(config.args)
      ? config.args.filter((a): a is string => typeof a === "string")
      : [];
    return [String(config.command).trim(), ...args].join(" ");
  }
  if (kind === "remote") {
    return String(config.url)
      .trim()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/+$/, "");
  }
  return "";
}

/** Every `${NAME}` in the config's env / headers values, sorted and de-duplicated. */
export function secretRefsOf(config: ServerConfig): string[] {
  const names = new Set<string>();
  for (const block of [config.env, config.headers]) {
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    for (const value of Object.values(block as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      for (const m of value.matchAll(SECRET_REF)) names.add(m[1]);
    }
  }
  return [...names].sort();
}

export type KeyValueRow = { key: string; value: string };

/**
 * The guided form's fields → the INNER `server_config` (never mcpServers-wrapped).
 * Local → `{ command, args, env? }` (args split on whitespace); Remote → `{ url, headers? }`.
 * Blank-key rows are dropped; an empty env/headers map is omitted.
 */
export function buildServerConfig(
  transport: Transport,
  target: string,
  argsText: string,
  rows: KeyValueRow[],
): ServerConfig {
  const map: Record<string, string> = {};
  for (const { key, value } of rows) {
    const k = key.trim();
    if (k !== "") map[k] = value;
  }
  if (transport === "remote") {
    const cfg: ServerConfig = { url: target.trim() };
    if (Object.keys(map).length > 0) cfg.headers = map;
    return cfg;
  }
  const a = argsText.trim();
  const cfg: ServerConfig = { command: target.trim(), args: a === "" ? [] : a.split(/\s+/) };
  if (Object.keys(map).length > 0) cfg.env = map;
  return cfg;
}

/** An env / headers block back into editable rows. */
export function rowsOfBlock(block: unknown): KeyValueRow[] {
  if (block === null || typeof block !== "object" || Array.isArray(block)) return [];
  return Object.entries(block as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}
