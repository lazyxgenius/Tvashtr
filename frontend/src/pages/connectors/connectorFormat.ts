/** Copy helpers for the Connectors screens (labels, tiles, the "sign-in expired" banner). */
import type {
  Connection,
  ConnectionDetail,
  ConnectorAccess,
  ConnectorUsageRow,
  ReadOnlyBy,
  RecentUse,
} from "../../lib/api/connectors";
import { titleCase } from "../../lib/text";
import { joinNames } from "../secrets/secretFormat";
import { agentNames, plural, usedByLabel } from "../tools/toolFormat";
import type { StatusFilter } from "../tools/toolsState";

// The design's tiles where they aren't the name's first two letters.
const TILE: Record<string, string> = {
  supabase: "Sb",
  "google-drive": "Dr",
  "google-docs": "Dc",
  "google-sheets": "Sh",
  posthog: "Ph",
  mixpanel: "Mx",
  hubspot: "Hs",
};

/** The two letters on a connector's tile: "Sb" for Supabase, else the name's first two ("No"). */
export function tileLetters(key: string, name: string): string {
  if (TILE[key]) return TILE[key];
  const letters = name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return letters ? letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase() : "?";
}

const CATEGORY: Record<string, string> = {
  databases: "Databases",
  docs: "Docs & files",
  analytics: "Analytics",
  crm: "CRM & support",
  work: "Work tracking",
};

export function categoryLabel(category: string): string {
  return CATEGORY[category] ?? titleCase(category);
}

export function accessLabel(access: ConnectorAccess): string {
  return access === "write" ? "Read & write" : "Read only";
}

/** Under a connection's name: its project (or that none is picked), else who makes it. */
export function connectionSubline(c: Connection): string {
  if (c.scope) return `${c.scope_picker?.label ?? "Project"} ${c.scope.label.split(" · ")[0]}`;
  if (c.scope_picker) return "The whole account";
  return c.publisher ? `By ${c.publisher}` : c.host;
}

/** The rows the search words (name, maker, host) and the Status filter keep, in order. */
export function filterConnections(
  rows: Connection[],
  query: string,
  status: StatusFilter,
): Connection[] {
  const q = query.trim().toLowerCase();
  const want = status === "ready" ? "connected" : "needs_signin";
  return rows.filter(
    (c) =>
      (status === "all" || c.status === want) &&
      (q === "" || [c.name, c.publisher ?? "", c.host].some((s) => s.toLowerCase().includes(q))),
  );
}

/** A key connection doesn't sign in: it needs its key replaced. */
export function usesKey(c: Pick<Connection, "auth_kind">): boolean {
  return c.auth_kind === "api_key";
}

/**
 * The "sign-in expired" banner after the bold "<Name>’s": what happened and which agents run
 * without it (the row's `used_by_agents`).
 */
export function expiredSentence(c: Connection): string {
  const fix = usesKey(c) ? "replace the key" : "sign in again";
  const what = usesKey(c) ? "key stopped working" : "sign-in expired";
  const names = agentNames(c.used_by_agents ?? []);
  const who =
    names.length === 0
      ? `No agent can use it until you ${fix}.`
      : `${joinNames(names)} ${names.length === 1 ? "runs" : "run"} without it until you ${fix}.`;
  return ` ${what}. ${who}`;
}

/** "Search 15,000+ connectors" once the catalog's size is known. */
export function searchPlaceholder(catalogSize: number | null): string {
  if (catalogSize === null || catalogSize < 1000) return "Search connectors";
  return `Search ${(Math.floor(catalogSize / 1000) * 1000).toLocaleString("en-US")}+ connectors`;
}

/** Beside "From the MCP Registry": how many servers, or how many the search found. */
export function registryCount(count: number, searching: boolean): string {
  const n = count.toLocaleString("en-US");
  const what = searching
    ? count === 1
      ? "result"
      : "results"
    : count === 1
      ? "server"
      : "servers";
  return `${n} ${what} · listed by their makers · not reviewed by Tvashtr`;
}

/** Under "What agents may do": what keeps a read-only connection read only. */
export function readOnlyHint(by: ReadOnlyBy): string {
  // The provider's own flag (Supabase, the only one in v1).
  if (by === "provider") {
    return "Read only runs SQL as a read-only database user, so a query can’t change data.";
  }
  if (by === "scopes") {
    return "Read only asks the provider for read-only access, so it refuses a write itself.";
  }
  return "Read only lets agents call only the tools this server marks as read-only. A tool it doesn’t mark counts as a write.";
}

/** "You didn’t allow access on Supabase." → the sentence without its full stop (a panel title). */
export function firstSentence(message: string): string {
  return message.split(/\.(?:\s|$)/)[0];
}

/** The toast after a connector is connected (CnF-Sign-5, CnF-Desk-4). */
export function connectedToast(name: string, desktop: boolean): string {
  return desktop
    ? `${name} is connected. It works for runs from the website and from Desktop.`
    : `${name} is connected. No agent can use it until you turn it on.`;
}

/** Under "What agents can call" on a connector's page. */
export function toolsHint(c: Pick<Connection, "access" | "read_only_by">): string {
  if (c.access === "write") {
    return "An agent can call the write tools only when its own access is Read & write too.";
  }
  // The provider's own flag (Supabase, the only one in v1).
  return c.read_only_by === "provider"
    ? "Write tools stay off while access is read only. execute_sql runs as a read-only database user."
    : "Write tools stay off while access is read only. A tool the server doesn’t mark as read-only counts as a write.";
}

/** "Reviewer · 6 reads", "Engineer · 3 reads, 1 write". */
export function recentUseLine(r: RecentUse): string {
  const counts = [
    (r.reads > 0 || r.writes === 0) && plural(r.reads, "read"),
    r.writes > 0 && plural(r.writes, "write"),
  ].filter(Boolean);
  return `${r.agent} · ${counts.join(", ")}`;
}

/** "Engineer and Reviewer in Indicator sprint team, Writer in Docs team": teams in order met. */
function agentsByTeam(rows: ConnectorUsageRow[]): string {
  const teams = new Map<string, { name: string; rows: ConnectorUsageRow[] }>();
  for (const row of rows) {
    const team = teams.get(row.team_id) ?? { name: row.team_name, rows: [] };
    team.rows.push(row);
    teams.set(row.team_id, team);
  }
  return [...teams.values()].map((t) => `${joinNames(agentNames(t.rows))} in ${t.name}`).join(", ");
}

/**
 * The Disconnect confirmation (CnF-Disc-2): who loses access, what Tvashtr deletes and how to
 * revoke it at the provider. `detail` null = the page data couldn't load: the row's counts stand in.
 */
export function disconnectImpact(c: Connection, detail: ConnectionDetail | null): string {
  const count = detail ? detail.used_by_agents.length : c.used_by.agent_count;
  const who = detail
    ? agentsByTeam(detail.used_by_agents)
    : usedByLabel(c.used_by).replace(" · ", " in ");
  const lose =
    count === 0
      ? "No agent uses it."
      : `${who} ${count === 1 ? "uses" : "use"} it. ${count === 1 ? "It loses" : "They lose"} access now, and a run that’s going finishes without it.`;
  const kept = `Tvashtr deletes its copy of your ${usesKey(c) || (detail && usesKey(detail)) ? "key" : "sign-in"}.`;
  return [lose, kept, detail?.revoke_hint].filter(Boolean).join(" ");
}

/** After "Give agents access" (CnF-Page-2): "Engineer can now use Supabase (read only)." */
export function accessGivenToast(names: string[], connector: string): string {
  return `${joinNames(names)} can now use ${connector} (read only).`;
}
