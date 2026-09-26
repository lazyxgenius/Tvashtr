/**
 * An agent's `tool_config` (moved from the old ToolsSection): its inline MCP servers
 * (`mcpServers`), the Tvashtr metadata beside them (`tvashtr.servers.<name>.enabled`,
 * `tvashtr.library` ids, `tvashtr.domains`) and the rows the Tools list shows (PANEL-94). The run
 * resolves it in control_plane/node_tools.py. Every edit returns a new config, or null when nothing
 * is left.
 */
import type { ToolLibraryItem } from "../../lib/api";

export type ToolConfig = Record<string, unknown> | null;
type Rec = Record<string, unknown>;

/** `${NAME}`: a secret reference, filled in at run time from Toolkit › Secrets. */
const REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** The Web fetch server (tool_skill_catalog "fetch"), added inline (spec Q15). */
export const FETCH_SERVER = { command: "uvx", args: ["mcp-server-fetch"] };

export function asRecord(v: unknown): Rec {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
}

export const serversOf = (cfg: ToolConfig): Rec => asRecord(asRecord(cfg).mcpServers);
const metaOf = (cfg: ToolConfig): Rec => asRecord(asRecord(cfg).tvashtr);

export function transportOf(server: unknown): "stdio" | "http" | "sse" {
  const s = asRecord(server);
  if (typeof s.url === "string") return s.type === "sse" ? "sse" : "http";
  return "stdio";
}

/** Servers are on unless `tvashtr.servers.<name>.enabled` is false. */
export function enabledOf(cfg: ToolConfig, name: string): boolean {
  return asRecord(asRecord(metaOf(cfg).servers)[name]).enabled !== false;
}

/** The `${NAME}`s a server uses — only `env` and `headers` values are filled in (node_tools). */
export function refsOf(server: unknown): string[] {
  const names = new Set<string>();
  for (const block of ["env", "headers"]) {
    for (const val of Object.values(asRecord(asRecord(server)[block]))) {
      if (typeof val === "string") for (const m of val.matchAll(REF)) names.add(m[1]);
    }
  }
  return [...names];
}

export const domainsOf = (cfg: ToolConfig): boolean => metaOf(cfg).domains === true;

export function librariesOf(cfg: ToolConfig): string[] {
  const lib = metaOf(cfg).library;
  return Array.isArray(lib) ? lib.filter((x): x is string => typeof x === "string") : [];
}

/** Drop the empty containers an edit leaves behind; null when nothing is left. */
function tidy(cfg: Rec): ToolConfig {
  const out = { ...cfg };
  const meta = { ...asRecord(out.tvashtr) };
  if (Object.keys(asRecord(meta.servers)).length === 0) delete meta.servers;
  if (Array.isArray(meta.library) && meta.library.length === 0) delete meta.library;
  if (Object.keys(meta).length === 0) delete out.tvashtr;
  else out.tvashtr = meta;
  if (Object.keys(serversOf(out)).length === 0) delete out.mcpServers;
  return Object.keys(out).length === 0 ? null : out;
}

export function setDomains(cfg: ToolConfig, on: boolean): ToolConfig {
  const meta = { ...metaOf(cfg) };
  if (on) meta.domains = true;
  else delete meta.domains;
  return tidy({ ...asRecord(cfg), tvashtr: meta });
}

export function setEnabled(cfg: ToolConfig, name: string, on: boolean): ToolConfig {
  const meta = metaOf(cfg);
  const servers = { ...asRecord(meta.servers) };
  const entry = { ...asRecord(servers[name]) };
  if (on) delete entry.enabled;
  else entry.enabled = false;
  if (Object.keys(entry).length > 0) servers[name] = entry;
  else delete servers[name];
  return tidy({ ...asRecord(cfg), tvashtr: { ...meta, servers } });
}

export function addServer(cfg: ToolConfig, name: string, server: Rec): ToolConfig {
  return tidy({ ...asRecord(cfg), mcpServers: { ...serversOf(cfg), [name]: server } });
}

/** Add library tools by id (ones already referenced stay once). */
export function addLibrary(cfg: ToolConfig, ids: readonly string[]): ToolConfig {
  const lib = librariesOf(cfg);
  return tidy({
    ...asRecord(cfg),
    tvashtr: { ...metaOf(cfg), library: [...lib, ...ids.filter((id) => !lib.includes(id))] },
  });
}

/** Edit an inline server in place (a rename keeps its place and its Enable switch). */
export function replaceServer(
  cfg: ToolConfig,
  name: string,
  next: string,
  server: Rec,
): ToolConfig {
  const servers = Object.fromEntries(
    Object.entries(serversOf(cfg)).map(([k, v]) => (k === name ? [next, server] : [k, v])),
  );
  const meta = metaOf(cfg);
  const flags = { ...asRecord(meta.servers) };
  if (next !== name && name in flags) {
    flags[next] = flags[name];
    delete flags[name];
  }
  return tidy({ ...asRecord(cfg), mcpServers: servers, tvashtr: { ...meta, servers: flags } });
}

export interface KeyValue {
  key: string;
  value: string;
}

/**
 * The add-server form's fields → a server: Remote `{url, headers?}`, Local `{command, args, env?}`
 * (the command line split on spaces; "quote" an argument that has spaces). Rows with a blank name
 * are dropped. `base` is the server being edited: keys the form doesn't own stay.
 */
export function serverFrom(
  transport: "local" | "remote",
  target: string,
  rows: readonly KeyValue[],
  base: unknown = {},
): Rec {
  const keep = { ...asRecord(base) };
  for (const k of ["url", "command", "args", "headers", "env"]) delete keep[k];
  if (transport === "local") delete keep.type;
  const map = Object.fromEntries(
    rows.filter((r) => r.key.trim() !== "").map((r) => [r.key.trim(), r.value]),
  );
  const extra = Object.keys(map).length > 0;
  if (transport === "remote")
    return { ...keep, url: target.trim(), ...(extra && { headers: map }) };
  const [command = "", ...args] = (target.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) =>
    /^(["']).*\1$/.test(w) ? w.slice(1, -1) : w,
  );
  return { ...keep, command, args, ...(extra && { env: map }) };
}

/** What the add form shows for a server: its transport, target line and headers/env rows. */
export function formOf(server: unknown): {
  transport: "local" | "remote";
  target: string;
  rows: KeyValue[];
} {
  const s = asRecord(server);
  const remote = transportOf(s) !== "stdio";
  const rows = Object.entries(asRecord(remote ? s.headers : s.env)).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
  const words = [s.command, ...(Array.isArray(s.args) ? (s.args as unknown[]) : [])]
    .filter((w): w is string => typeof w === "string" && w !== "")
    .map((w) => (/\s/.test(w) ? `"${w}"` : w));
  const target = remote ? String(s.url) : words.join(" ");
  return { transport: remote ? "remote" : "local", target, rows };
}

/** Why the URL (Remote) or command (Local) can't be used, or null (`${NAME}` isn't filled in there). */
export function targetProblem(transport: "local" | "remote", target: string): string | null {
  if (target.includes("${")) {
    return `Secrets aren’t filled in here. Put them in ${transport === "remote" ? "a header" : "Env"}.`;
  }
  if (transport === "local") return null;
  try {
    const { protocol } = new URL(target.trim());
    if (protocol === "http:" || protocol === "https:") return null;
  } catch {
    // falls through
  }
  return "Use a URL that starts with https:// or http://.";
}

/** The secret the form's hint names: "linear" → LINEAR_TOKEN. */
export function secretName(server: string): string {
  const base = server
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${/^[A-Z]/.test(base) ? base : `MCP${base ? `_${base}` : ""}`}_TOKEN`;
}

export function removeServer(cfg: ToolConfig, name: string): ToolConfig {
  const servers = { ...serversOf(cfg) };
  delete servers[name];
  const meta = metaOf(cfg);
  const flags = { ...asRecord(meta.servers) };
  delete flags[name];
  return tidy({ ...asRecord(cfg), mcpServers: servers, tvashtr: { ...meta, servers: flags } });
}

export function removeLibrary(cfg: ToolConfig, id: string): ToolConfig {
  const meta = metaOf(cfg);
  return tidy({
    ...asRecord(cfg),
    tvashtr: { ...meta, library: librariesOf(cfg).filter((x) => x !== id) },
  });
}

export interface ToolRowData {
  key: string;
  name: string;
  source: "inline" | "library";
  /** The library item's id (library rows). */
  id?: string;
  badge: {
    label: "Needs secret" | "Library" | "Local" | "Remote";
    variant: "warning" | "info" | "outline";
  };
  /** The command, or the URL, then the `${NAME}`s it uses. */
  target: string;
  enabled: boolean;
  /** `${NAME}`s it uses that aren't in Secrets. */
  missing: string[];
}

export function targetOf(server: unknown, refs: readonly string[]): string {
  const s = asRecord(server);
  const base =
    typeof s.url === "string"
      ? s.url
      : [s.command, ...(Array.isArray(s.args) ? (s.args as unknown[]) : [])]
          .filter((x) => typeof x === "string" && x !== "")
          .join(" ");
  return [base, ...refs.map((r) => `\${${r}}`)].filter(Boolean).join(" · ");
}

/**
 * The Tools list (PANEL-94): inline servers, then library references. `library` / `secrets` are
 * null while unknown (a library row is then named "Library tool", and no secret is flagged).
 */
export function toolRows(
  cfg: ToolConfig,
  library: readonly ToolLibraryItem[] | null,
  secrets: readonly string[] | null,
): ToolRowData[] {
  const row = (
    key: string,
    name: string,
    server: unknown,
    source: ToolRowData["source"],
    id?: string,
  ): ToolRowData => {
    const refs = refsOf(server);
    const missing = secrets ? refs.filter((r) => !secrets.includes(r)) : [];
    const badge: ToolRowData["badge"] =
      missing.length > 0
        ? { label: "Needs secret", variant: "warning" }
        : source === "library"
          ? { label: "Library", variant: "info" }
          : transportOf(server) === "stdio"
            ? { label: "Local", variant: "outline" }
            : { label: "Remote", variant: "outline" };
    return {
      key,
      name,
      source,
      id,
      badge,
      target: targetOf(server, refs),
      enabled: enabledOf(cfg, name),
      missing,
    };
  };
  const inline = Object.entries(serversOf(cfg)).map(([name, server]) =>
    row(`inline:${name}`, name, server, "inline"),
  );
  const refs = librariesOf(cfg).map((id) => {
    const item = library?.find((t) => t.id === id);
    const name = item?.name ?? (library ? "Removed from your library" : "Library tool");
    return row(`library:${id}`, name, item?.server_config ?? null, "library", id);
  });
  return [...inline, ...refs];
}
